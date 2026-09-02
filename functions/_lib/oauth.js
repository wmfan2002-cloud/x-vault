/**
 * GitHub / Google 登录（OAuth 2.0 授权码流程）。
 *
 * 为什么不再有邮箱注册：站长要求只能用 GitHub 或 Google 进来，不允许随意注册。
 * /api/auth/register 与 /api/auth/login 已双双关停（返回 410）。
 *
 * ── 三个必须做对的地方 ────────────────────────────────────────
 *
 * 1. **身份用 provider + sub，不能用邮箱**
 *    用户能在 GitHub 后台改邮箱。拿邮箱当身份键的话，改完再登录就变成另一个人，
 *    原来的收录和收藏全部失联。sub 是提供方分配的、永不变的数字/字符串 ID。
 *    反过来说：同一个人用 GitHub 和 Google 登录会是两个账号（邮箱相同也一样），
 *    这是有意的 —— 靠邮箱自动合并账号是经典的账号接管漏洞（在一方注册一个
 *    与受害者同邮箱的账号即可登进对方账号）。
 *
 * 2. **state 存库、用一次即删**
 *    只放 Cookie 的话没法保证一次性（同一个 Cookie 能重放多次）。存库
 *    DELETE ... RETURNING 拿到才算有效，天然防重放 + 防 CSRF。
 *
 * 3. **GitHub API 不带 User-Agent 直接 403**
 *    Workers 的 fetch 默认不发 UA。这个坑在 X 那边已经踩过一次（表现为 404），
 *    所以这里所有出站请求都写死 UA。
 *
 * ── 需要配置的环境变量 ───────────────────────────────────────
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET      （缺则 GitHub 按钮不可用）
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET      （缺则 Google 按钮不可用）
 *   SITE_ORIGIN         可选，形如 https://flj.wmxs.cloud。
 *                       不填就按 Host + X-Forwarded-Proto 推断；
 *                       但 redirect_uri 必须与提供方后台登记的**逐字一致**，
 *                       所以线上建议显式填死。
 *   ADMIN_EMAILS        可选，逗号分隔。命中的 OAuth 邮箱登录后 role=admin。
 *   ALLOWED_EMAILS      可选，逗号分隔。填了就是白名单，只有名单里的能登录。
 *   ALLOWED_EMAIL_DOMAINS 可选，逗号分隔（如 example.com）。与上一条是「或」关系。
 */
import { nowIso } from './http.js';

const UA = 'x-vault/1.0 (+https://github.com/)';
const STATE_TTL_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const PROVIDERS = ['github', 'google'];

export const providerLabel = (p) => ({ github: 'GitHub', google: 'Google' }[p] || p);

/** 该提供方是否配好了 client id/secret */
export function isConfigured(env, provider) {
  if (provider === 'github') return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  if (provider === 'google') return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  return false;
}

/**
 * 站点根地址。redirect_uri 必须与提供方后台登记的完全一致，
 * 所以优先用显式配置；推断路径要读 X-Forwarded-Proto —— nginx 反代过来是
 * 明文 HTTP，不读这个头就会推出 http:// 而与登记的 https:// 不匹配。
 */
export function siteOrigin(request, env) {
  if (env.SITE_ORIGIN) return String(env.SITE_ORIGIN).replace(/\/+$/, '');
  const u = new URL(request.url);
  const fwdProto = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const fwdHost = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const proto = fwdProto || u.protocol.replace(':', '');
  const host = fwdHost || request.headers.get('host') || u.host;
  return `${proto}://${host}`;
}

export const redirectUri = (request, env, provider) =>
  `${siteOrigin(request, env)}/api/auth/callback/${provider}`;

// ── state / PKCE ─────────────────────────────────────────────

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function createState(env, provider, redirectTo) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  // PKCE：Google 支持且推荐；GitHub 也已支持，一并带上没有坏处。
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await sha256(enc.encode(verifier)));

  await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?')
    .bind(new Date(Date.now() - STATE_TTL_MS).toISOString()).run();
  await env.DB.prepare(
    'INSERT INTO oauth_states (state, provider, code_verifier, redirect_to, created_at) VALUES (?,?,?,?,?)'
  ).bind(state, provider, verifier, redirectTo || '/', nowIso()).run();

  return { state, verifier, challenge };
}

/** 取用并销毁 state。返回 null = 无效/过期/已用过，调用方必须终止流程。 */
export async function consumeState(env, state, provider) {
  if (!state) return null;
  const row = await env.DB.prepare(
    'SELECT provider, code_verifier, redirect_to, created_at FROM oauth_states WHERE state = ?'
  ).bind(state).first();
  // 无论有效与否都删掉，保证一次性
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

  if (!row) return null;
  if (row.provider !== provider) return null;
  if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) return null;
  return { verifier: row.code_verifier, redirectTo: row.redirect_to || '/' };
}

// ── 各提供方 ─────────────────────────────────────────────────

export function authorizeUrl(env, provider, { state, challenge, redirect_uri }) {
  if (provider === 'github') {
    const p = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri,
      scope: 'read:user user:email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      allow_signup: 'true',
    });
    return `https://github.com/login/oauth/authorize?${p}`;
  }
  if (provider === 'google') {
    const p = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // consent 之后 Google 才稳定回 email；select_account 让多账号用户能挑
      prompt: 'select_account',
      access_type: 'online',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  throw new Error(`未知的提供方 ${provider}`);
}

async function exchangeCode(env, provider, { code, verifier, redirect_uri }) {
  const url = provider === 'github'
    ? 'https://github.com/login/oauth/access_token'
    : 'https://oauth2.googleapis.com/token';

  const body = new URLSearchParams({
    code,
    redirect_uri,
    code_verifier: verifier,
    client_id: provider === 'github' ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID,
    client_secret: provider === 'github' ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET,
  });
  if (provider === 'google') body.set('grant_type', 'authorization_code');

  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`换取令牌失败：${text.slice(0, 200)}`); }
  // GitHub 用 HTTP 200 + error 字段报错，不看 body 会以为成功
  if (data.error) throw new Error(`${data.error}: ${data.error_description || ''}`.trim());
  if (!res.ok) throw new Error(`换取令牌失败 HTTP ${res.status}`);
  if (!data.access_token) throw new Error('提供方未返回 access_token');
  return data.access_token;
}

async function fetchProfile(provider, accessToken) {
  const h = { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'user-agent': UA };

  if (provider === 'github') {
    const res = await fetch('https://api.github.com/user', { headers: h });
    if (!res.ok) throw new Error(`读取 GitHub 资料失败 HTTP ${res.status}`);
    const u = await res.json();

    // 用户把邮箱设为私密时 /user 的 email 是 null，得再要一次邮箱列表
    let email = u.email || '';
    if (!email) {
      const r2 = await fetch('https://api.github.com/user/emails', { headers: h });
      if (r2.ok) {
        const list = await r2.json();
        email = (list.find((e) => e.primary && e.verified) || list.find((e) => e.verified) || list[0])?.email || '';
      }
    }
    return {
      sub: String(u.id),
      email: email.toLowerCase(),
      name: u.name || u.login || '',
      avatar: u.avatar_url || '',
      handle: u.login || '',
    };
  }

  if (provider === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: h });
    if (!res.ok) throw new Error(`读取 Google 资料失败 HTTP ${res.status}`);
    const u = await res.json();
    if (!u.email_verified) throw new Error('该 Google 账号邮箱未验证');
    return {
      sub: String(u.sub),
      email: String(u.email || '').toLowerCase(),
      name: u.name || u.given_name || '',
      avatar: u.picture || '',
      handle: '',
    };
  }
  throw new Error(`未知的提供方 ${provider}`);
}

/** 完成授权码换取 + 拉资料 */
export async function completeOAuth(env, provider, { code, verifier, redirect_uri }) {
  const token = await exchangeCode(env, provider, { code, verifier, redirect_uri });
  return fetchProfile(provider, token);
}

// ── 准入与落库 ───────────────────────────────────────────────

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** 白名单：两个变量都没配就是对所有人开放（只是必须走 GitHub/Google） */
export function isAllowed(env, email) {
  const emails = list(env.ALLOWED_EMAILS);
  const domains = list(env.ALLOWED_EMAIL_DOMAINS);
  if (!emails.length && !domains.length) return true;
  if (!email) return false;
  if (emails.includes(email)) return true;
  const at = email.lastIndexOf('@');
  return at > 0 && domains.includes(email.slice(at + 1));
}

export const isAdminEmail = (env, email) => !!email && list(env.ADMIN_EMAILS).includes(email);

/**
 * 按 (provider, sub) 找人，没有就建。
 *
 * 注意这里**不做跨提供方的邮箱合并** —— 见文件头第 1 条。
 * 但同一邮箱在不同提供方各建一个账号会撞上 users.email 的 UNIQUE 约束，
 * 所以第二个账号的 email 列存成 `邮箱+provider` 的形式保持唯一，
 * 展示用的真实邮箱另存一份在 display 里。
 */
export async function findOrCreateOAuthUser(env, provider, profile) {
  const now = nowIso();
  const wantAdmin = isAdminEmail(env, profile.email);

  const existing = await env.DB.prepare(
    `SELECT id, email, display_name, role, is_active FROM users
      WHERE oauth_provider = ? AND oauth_sub = ?`
  ).bind(provider, profile.sub).first();

  if (existing) {
    if (!existing.is_active) return { error: '该账号已被停用' };
    // 资料每次登录刷新（改了头像/昵称能跟上），role 只升不降，避免把手动设的管理员降级
    await env.DB.prepare(
      `UPDATE users SET display_name = ?, avatar_url = ?, last_login_at = ?
             ${wantAdmin ? ", role = 'admin'" : ''}
        WHERE id = ?`
    ).bind(profile.name || existing.display_name, profile.avatar || '', now, existing.id).run();

    return { user: { id: existing.id, email: existing.email, display_name: profile.name || existing.display_name,
                     role: wantAdmin ? 'admin' : existing.role, avatar_url: profile.avatar || '' } };
  }

  // 同邮箱已被另一个提供方占用 -> 给 email 列加后缀绕开 UNIQUE，不做自动合并
  let emailCol = profile.email || `${provider}_${profile.sub}@oauth.local`;
  const clash = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?')
    .bind(emailCol.toLowerCase()).first();
  if (clash) emailCol = `${emailCol}#${provider}`;

  const id = crypto.randomUUID();
  const display = profile.name || profile.handle || (profile.email || '').split('@')[0] || providerLabel(provider) + ' 用户';

  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, is_active,
                        created_at, last_login_at, oauth_provider, oauth_sub, avatar_url)
     VALUES (?,?,'!',?,?,1,?,?,?,?,?)`
     // password_hash 写 '!'：verifyPassword() 只认 'pbkdf2$' 前缀，
     // 所以这个账号永远无法用密码登录，只能走 OAuth
  ).bind(id, emailCol, display.slice(0, 40), wantAdmin ? 'admin' : 'user',
         now, now, provider, profile.sub, profile.avatar || '').run();

  return { user: { id, email: emailCol, display_name: display, role: wantAdmin ? 'admin' : 'user',
                   avatar_url: profile.avatar || '', is_new: true } };
}
