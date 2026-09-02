/**
 * GET /api/auth/oauth/github
 * GET /api/auth/oauth/google
 *
 * 生成 state + PKCE 后 302 跳去提供方。可带 ?redirect_to=/ 指定登录完回哪。
 * 这是浏览器直接跳转（不是 fetch）—— 所以出错要给人能看懂的 HTML，不是 JSON。
 */
import { PROVIDERS, isConfigured, providerLabel, createState, authorizeUrl, redirectUri } from '../../../_lib/oauth.js';
import { errorPage } from '../../../_lib/oauth-page.js';

export async function onRequestGet({ request, env, params }) {
  const provider = String(params.provider || '').toLowerCase();
  if (!PROVIDERS.includes(provider)) return errorPage('不支持的登录方式', `未知的提供方 ${provider}`, 404);

  if (!isConfigured(env, provider)) {
    return errorPage(
      `${providerLabel(provider)} 登录尚未配置`,
      `站长需要在 Cloudflare Pages 的环境变量里配置 ${provider.toUpperCase()}_CLIENT_ID 与 ` +
      `${provider.toUpperCase()}_CLIENT_SECRET（本地则写在 .dev.vars）。`,
      503
    );
  }

  // 只接受站内相对路径，防开放重定向
  const raw = new URL(request.url).searchParams.get('redirect_to') || '/';
  const redirectTo = /^\/(?!\/)/.test(raw) ? raw : '/';

  try {
    const { state, challenge } = await createState(env, provider, redirectTo);
    const url = authorizeUrl(env, provider, {
      state, challenge, redirect_uri: redirectUri(request, env, provider),
    });
    return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
  } catch (err) {
    return errorPage('无法开始登录', err.message, 500);
  }
}
