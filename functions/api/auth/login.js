/**
 * POST /api/auth/login —— 已关停，改走 /api/auth/oauth/{github,google}。
 *
 * 注意：这只影响**普通用户账号**。管理台 /admin 的密码登录
 * （POST /api/admin/login）是另一套，仍然可用，作为 OAuth 挂掉时的兜底入口。
 *
 * 历史上用邮箱密码注册过的账号（库里那两个测试账号）数据都还在，
 * 但已无法再用密码登入 —— 要恢复访问得用同邮箱的 GitHub/Google 重新登录建号，
 * 或由站长在库里把 oauth_provider / oauth_sub 手动挂上去。
 */
import { json } from '../../_lib/http.js';

export const onRequest = () => json({
  success: false,
  error: '密码登录已停用，请用 GitHub 或 Google 登录。',
  oauth_only: true,
}, 410, { 'cache-control': 'no-store' });
