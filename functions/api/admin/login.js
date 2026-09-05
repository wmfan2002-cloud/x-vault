/**
 * POST /api/admin/login   { username, password } -> { success, token }
 *
 *
 * 相对原站的改动: 除了照旧返回 token (沿用的 admin.js 需要它放 localStorage),
 * 同时下发 HttpOnly Cookie。服务端优先认 Cookie, 前端改造完成后可以把 token 停掉。
 */
import { json, fail } from '../../_lib/http.js';
import { verifyPassword, createSession, sessionCookie } from '../../_lib/auth.js';
import { rateLimit, clientIp } from '../../_lib/ratelimit.js';

export async function onRequestPost({ request, env }) {
  // 暴力破解防护。PBKDF2 10 万轮本身有 CPU 成本（变相限速），但 Workers 免费档
  // 是按请求计费而不是 CPU，光靠它挡不住脚本 —— 内存限流兜底。
  // isolate 级计数只是尽力而为，见 _lib/ratelimit.js 的说明。
  if (!rateLimit('admin-login', clientIp(request), 5, 60_000)) {
    return fail('尝试过于频繁，请一分钟后再试', 429);
  }

  if (!env.ADMIN_PASSWORD_HASH) {
    return fail('服务端未配置 ADMIN_PASSWORD_HASH, 请先运行 node scripts/gen-keys.mjs', 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password) return fail('账号或通行密码错误', 401);

  const expectedUser = env.ADMIN_USERNAME || 'admin';
  const userOk = username === expectedUser;
  // 无论用户名对不对都跑一次密码校验, 避免用响应时间区分"用户不存在"与"密码错误"
  const passOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);

  if (!userOk || !passOk) return fail('账号或通行密码错误', 401);

  const { token } = await createSession(env.DB);
  return json({ success: true, token }, 200, { 'set-cookie': sessionCookie(token, request) });
}
