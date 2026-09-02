/**
 * 用户账号认证。
 *
 * 参考 /home/fcs/stylekit：dual-mode identity（user_id / session_id 并存）、
 * 归属关系单独建表 + CASCADE。差异是它用 Supabase Auth，这里自建：
 *   · 密码 PBKDF2-SHA256 10 万轮（Workers 无法用 bcrypt/argon2 原生模块）
 *   · 会话用不透明令牌 + HttpOnly Cookie，库里只存 SHA-256，可即时吊销
 *     （比 JWT 好在这点：JWT 签发后无法单独作废）
 */
import { nowIso } from './http.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
export const USER_COOKIE = 'xv_user';

const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, iterations = 100000, salt) {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations }, key, 256
  );
  return `pbkdf2$${iterations}$${b64(s)}$${b64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iters, saltB64, hashB64] = String(stored || '').split('$');
  // 哨兵账号 password_hash 是 '!'，走不到这里就被挡掉 —— 它永远无法登录
  if (scheme !== 'pbkdf2') return false;
  const again = await hashPassword(password, parseInt(iters, 10), unb64(saltB64));
  return timingSafeEqual(again.split('$')[3], hashB64);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isHttps(request) {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch { /* ignore */ }
  return (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
}

/** Secure 必须按协议条件下发，否则纯 HTTP 下浏览器丢弃 Cookie → 登录死循环 */
export function userCookie(token, request, maxAgeSec = SESSION_TTL_MS / 1000) {
  const secure = isHttps(request) ? ' Secure;' : '';
  return `${USER_COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

export const clearUserCookie = (request) => {
  const secure = isHttps(request) ? ' Secure;' : '';
  return `${USER_COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`;
};

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// ── 注册 / 登录 / 会话 ────────────────────────────────────────

// ⚠️ 以下三个函数（validateCredentials / registerUser / authenticate）目前**没有调用方**：
// 站长要求只能 GitHub / Google 登录，/api/auth/register 与 /api/auth/login 都已返回 410。
// 保留它们只是为了将来若要开放密码登录时不必重写；verifyPassword 仍在用（它负责
// 拒绝 password_hash='!' 的 OAuth 账号与哨兵账号）。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateCredentials(email, password) {
  if (!email || !EMAIL_RE.test(email)) return '邮箱格式不正确';
  if (email.length > 254) return '邮箱过长';
  if (!password || password.length < 8) return '密码至少 8 位';
  if (password.length > 200) return '密码过长';
  return null;
}

export async function registerUser(env, { email, password, displayName }) {
  const norm = String(email).trim().toLowerCase();
  const exists = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(norm).first();
  if (exists) return { error: '该邮箱已注册' };

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at)
     VALUES (?,?,?,?,'user',1,?)`
  ).bind(id, norm, await hashPassword(password), String(displayName || '').trim().slice(0, 40) || norm.split('@')[0], now).run();

  return { user: { id, email: norm, display_name: displayName || norm.split('@')[0], role: 'user' } };
}

export async function authenticate(env, email, password) {
  const norm = String(email).trim().toLowerCase();
  const row = await env.DB.prepare(
    'SELECT id, email, password_hash, display_name, role, is_active FROM users WHERE LOWER(email) = ?'
  ).bind(norm).first();

  // 用户不存在时也跑一次哈希，避免用响应时间区分"邮箱未注册"与"密码错误"
  const ok = await verifyPassword(password, row?.password_hash || 'pbkdf2$100000$AAAA$AAAA');
  if (!row || !ok) return { error: '邮箱或密码错误' };
  if (!row.is_active) return { error: '该账号已被停用' };

  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  return { user: { id: row.id, email: row.email, display_name: row.display_name, role: row.role } };
}

export async function createUserSession(env, userId) {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    'INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)'
  ).bind(await sha256Hex(token), userId, nowIso(), expires).run();
  await env.DB.prepare('DELETE FROM user_sessions WHERE expires_at < ?').bind(nowIso()).run();
  return token;
}

/** 必须登录。返回 null 时调用方应回 401。 */
export async function requireUser(request, env) {
  const token = readCookie(request, USER_COOKIE) || request.headers.get('x-user-token');
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.display_name, u.role, u.is_active,
            u.avatar_url, u.oauth_provider
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(await sha256Hex(token)).first();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(row.token_hash).run();
    return null;
  }
  if (!row.is_active) return null;

  return {
    id: row.id, email: row.email, display_name: row.display_name, role: row.role,
    avatar_url: row.avatar_url || '', oauth_provider: row.oauth_provider || '',
  };
}

/** 可选登录：公开端点想区分"登录/未登录"时用，未登录返回 null 而不报错 */
export const optionalUser = (request, env) => requireUser(request, env).catch(() => null);

export async function destroyUserSession(request, env) {
  const token = readCookie(request, USER_COOKIE) || request.headers.get('x-user-token');
  if (!token) return;
  await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token)).run();
}
