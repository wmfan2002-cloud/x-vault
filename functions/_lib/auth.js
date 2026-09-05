/**
 * 管理台鉴权。
 *
 * 相对被复刻站点的改动:
 *   - 令牌不再由前端存 localStorage, 改走 HttpOnly Cookie
 *   - 仍然兼容 x-admin-token 头, 因为沿用的 admin.js 是这么发请求的;
 *     两者都接受, Cookie 优先。前端改造完成后可以只留 Cookie。
 *   - 库里只存令牌的 SHA-256, 库泄露也无法冒用
 */
import { nowIso } from './http.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export const COOKIE_NAME = 'xv_session';

const enc = new TextEncoder();

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PBKDF2-SHA256, 100k 轮。格式: pbkdf2$<iters>$<saltB64>$<hashB64> */
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
  if (scheme !== 'pbkdf2') return false;
  const salt = unb64(saltB64);
  const again = await hashPassword(password, parseInt(iters, 10), salt);
  return timingSafeEqual(again.split('$')[3], hashB64);
}

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 签发会话: 返回明文令牌(只此一次), 库里只留哈希 */
export async function createSession(db) {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.prepare(
    'INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)'
  ).bind(await sha256Hex(token), nowIso(), expires).run();
  // 顺手清理过期会话
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(nowIso()).run();
  return { token, expires };
}

/**
 * 会话 Cookie。
 *
 * ⚠️ Secure 必须按协议条件下发, 不能无条件加:
 * 浏览器(和 curl)在**纯 HTTP** 下会直接丢弃带 Secure 的 Cookie —— 于是登录接口
 * 返回 200、前端以为成功、但 /admin 门禁拿不到 Cookie, 又把你弹回登录页, 形成死循环。
 * (localhost 例外: 浏览器把它当安全上下文, 所以本机测试看不出这个问题。)
 *
 * 生产部署在 Cloudflare Pages 上恒为 HTTPS, 会正常带上 Secure。
 * 纯 HTTP 只应出现在本地/临时调试 —— 那种场景下令牌本身就是明文传输的,
 * 少一个 Secure 不改变安全模型。
 */
function isHttps(request) {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch { /* ignore */ }
  return (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
}

export function sessionCookie(token, request, maxAgeSec = SESSION_TTL_MS / 1000) {
  const secure = isHttps(request) ? ' Secure;' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

export const clearCookie = (request) => {
  const secure = isHttps(request) ? ' Secure;' : '';
  return `${COOKIE_NAME}=; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=0`;
};

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * 校验请求是否已鉴权。
 * Cookie 优先; 回落到 x-admin-token 头以兼容沿用的 admin.js。
 */
export async function requireAdmin(request, env) {
  const token = readCookie(request, COOKIE_NAME) || request.headers.get('x-admin-token');
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ?'
  ).bind(await sha256Hex(token)).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(row.token_hash).run();
    return null;
  }
  return { token };
}

export async function destroySession(request, env) {
  const token = readCookie(request, COOKIE_NAME) || request.headers.get('x-admin-token');
  if (!token) return;
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token)).run();
}
