/**
 * GET /api/auth/callback/github
 * GET /api/auth/callback/google
 *
 * 提供方跳回这里。校验 state -> 换令牌 -> 拉资料 -> 找人/建人 -> 发会话 Cookie -> 跳回首页。
 *
 * 这个地址必须与提供方后台登记的 Authorization callback URL 逐字一致，
 * 包括协议。nginx 反代过来是明文 HTTP，siteOrigin() 因此要读 X-Forwarded-Proto
 * （snippets/proxy-api.conf 提供）；线上更稳的做法是直接配 SITE_ORIGIN。
 */
import {
  PROVIDERS, isConfigured, providerLabel, consumeState, completeOAuth,
  redirectUri, findOrCreateOAuthUser, isAllowed,
} from '../../../_lib/oauth.js';
import { createUserSession, userCookie } from '../../../_lib/user-auth.js';
import { errorPage } from '../../../_lib/oauth-page.js';

export async function onRequestGet({ request, env, params }) {
  const provider = String(params.provider || '').toLowerCase();
  if (!PROVIDERS.includes(provider)) return errorPage('不支持的登录方式', `未知的提供方 ${provider}`, 404);
  if (!isConfigured(env, provider)) return errorPage('登录未配置', `${providerLabel(provider)} 的 client id/secret 未配置`, 503);

  const q = new URL(request.url).searchParams;

  // 用户在授权页点了「取消」
  if (q.get('error')) {
    return errorPage('已取消授权', q.get('error_description') || q.get('error'), 400);
  }

  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) return errorPage('回调参数不完整', '缺少 code 或 state', 400);

  // state 用一次即废：无效 / 过期 / 重放都走这里
  const st = await consumeState(env, state, provider);
  if (!st) return errorPage('登录链接已失效', '请回到首页重新点一次登录（state 只能使用一次，且 10 分钟内有效）', 400);

  try {
    const profile = await completeOAuth(env, provider, {
      code, verifier: st.verifier, redirect_uri: redirectUri(request, env, provider),
    });

    if (!profile.sub) return errorPage('登录失败', `${providerLabel(provider)} 未返回用户标识`, 502);

    if (!isAllowed(env, profile.email)) {
      return errorPage('这个账号不在允许名单内',
        `本站目前只对指定账号开放。你用的是 ${profile.email || '（未公开邮箱）'}。如需开通请联系站长。`, 403);
    }

    const { user, error } = await findOrCreateOAuthUser(env, provider, profile);
    if (error) return errorPage('登录失败', error, 403);

    const token = await createUserSession(env, user.id);
    return new Response(null, {
      status: 302,
      headers: {
        location: st.redirectTo || '/',
        'set-cookie': userCookie(token, request),
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return errorPage('登录失败', err.message, 502);
  }
}
