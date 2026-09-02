/**
 * POST /api/admin/logout
 *
 * 原站登出是纯客户端的(清 localStorage), 服务端会话永远留着直到过期。
 * 走 HttpOnly Cookie 后必须有服务端登出: 既删库里的会话, 也清 Cookie。
 */
import { json } from '../../_lib/http.js';
import { destroySession, clearCookie } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  await destroySession(request, env);
  return json({ success: true }, 200, { 'set-cookie': clearCookie(request) });
}
