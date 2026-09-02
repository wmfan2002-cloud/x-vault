/**
 * GET  /api/auth/me     -> { success, user } 或 { success:true, user:null }
 * POST /api/auth/logout -> 销毁服务端会话 + 清 Cookie
 *
 * me 用于页面加载时判断登录态；未登录返回 200 + user:null（不是 401），
 * 这样前端不必把"未登录"当错误处理。
 */
import { json } from '../../_lib/http.js';
import { optionalUser } from '../../_lib/user-auth.js';

export async function onRequestGet({ request, env }) {
  const user = await optionalUser(request, env);
  if (!user) return json({ success: true, user: null });

  // 顺带把这个人的统计带回去，省一次请求
  const stats = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM blogger_owners WHERE user_id = ?1) AS owned,
       (SELECT COUNT(*) FROM blogger_owners WHERE user_id = ?1 AND visibility='private') AS private_count,
       (SELECT COUNT(*) FROM favorites WHERE user_id = ?1) AS favorites,
       (SELECT COUNT(*) FROM user_x_credentials WHERE user_id = ?1) AS has_x_creds`
  ).bind(user.id).first();

  return json({
    success: true,
    // user 里已带 avatar_url / oauth_provider（requireUser 直接查出来的），
    // 前端用 avatar_url 渲染真头像，没有才回落首字母
    user: {
      ...user,
      owned: stats?.owned || 0,
      private_count: stats?.private_count || 0,
      favorites: stats?.favorites || 0,
      has_x_credentials: (stats?.has_x_creds || 0) > 0,
    },
  }, 200, { 'cache-control': 'no-store' });
}
