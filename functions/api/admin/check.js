/**
 * POST /api/admin/check   -> { authenticated: bool }
 *
 * 注意响应字段是 authenticated 而不是 success —— admin.js:264 读的是 json.authenticated。
 */
import { json } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const session = await requireAdmin(request, env);
  return json({ authenticated: !!session }, session ? 200 : 401);
}
