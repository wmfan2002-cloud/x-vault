/** POST /api/auth/logout —— 服务端销毁会话，不只是清前端状态 */
import { json } from '../../_lib/http.js';
import { destroyUserSession, clearUserCookie } from '../../_lib/user-auth.js';

export async function onRequestPost({ request, env }) {
  await destroyUserSession(request, env);
  return json({ success: true }, 200, { 'set-cookie': clearUserCookie(request) });
}
