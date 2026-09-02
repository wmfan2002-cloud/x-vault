/**
 * GET /api/auth/providers -> { oauth_only, providers: [{ id, label, ready }] }
 *
 * 前端据此决定按钮是可点还是显示「站长尚未配置」。
 * 没有这个端点的话，用户点下去只会跳到一个 503 错误页，看起来像站坏了。
 */
import { json } from '../../_lib/http.js';
import { PROVIDERS, isConfigured, providerLabel } from '../../_lib/oauth.js';

export const onRequestGet = ({ env }) => json({
  success: true,
  oauth_only: true,
  providers: PROVIDERS.map((id) => ({ id, label: providerLabel(id), ready: isConfigured(env, id) })),
  // 配了白名单就在前端提示一句，免得用户点完才知道自己没资格
  restricted: !!(env.ALLOWED_EMAILS || env.ALLOWED_EMAIL_DOMAINS),
}, 200, { 'cache-control': 'public, max-age=60' });
