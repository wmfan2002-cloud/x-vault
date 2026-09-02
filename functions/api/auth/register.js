/**
 * POST /api/auth/register —— 已关停。
 *
 * 站长要求：不允许随意注册，只能用 GitHub 或 Google 登录。
 * 保留这个文件而不是删掉，是为了让**缓存了旧版 app.js 的浏览器**收到一句能看懂的
 * 说明，而不是 404 —— 前端把 404 当网络异常，用户只会看到「网络异常」四个字。
 *
 * 410 Gone 而非 403：语义上这个入口是永久移除，不是权限不够。
 */
import { json } from '../../_lib/http.js';

export const onRequest = () => json({
  success: false,
  error: '本站已改为仅支持 GitHub / Google 登录，邮箱注册入口已关闭。请回首页点「登录」。',
  oauth_only: true,
}, 410, { 'cache-control': 'no-store' });
