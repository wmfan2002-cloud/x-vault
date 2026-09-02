/**
 * GET  /api/admin/credentials  -> { success, hasCredentials, screen_name }
 * POST /api/admin/credentials  { ct0, authToken } -> { success }
 *
 * 契约见 _reference/spec/03-api-contract.md §3.7
 *
 * ⚠️ 与原站的关键差异: 原站 GET 把 ct0 / authToken **明文回传**给前端 (admin.js:365-366),
 * 前端再写进 localStorage。这两个 Cookie 等同 X 账号完全控制权, 任何 XSS 都能拿走。
 * 这里只回 hasCredentials + 已验证的 @handle, 密文永不出服务端。
 *
 * 副作用: 沿用的 admin.js 期望能回填输入框, 拿不到值时它会回落到自己的 localStorage
 * (admin.js:373 起的 fallback 分支), 因此界面仍然可用 —— 只是不再由服务端泄露凭据。
 */
import { ok, fail } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';
import { getSetting, setSetting, setXCredentials } from '../../_lib/crypto.js';

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  const hasCt0 = await getSetting(env.DB, 'x_ct0_enc');
  const hasAuth = await getSetting(env.DB, 'x_auth_token_enc');
  const handle = await getSetting(env.DB, 'x_account_handle');

  return ok({
    hasCredentials: !!(hasCt0 && hasAuth),
    screen_name: handle || '',
    // 刻意不返回 ct0 / authToken
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);
  if (!env.CREDENTIAL_ENC_KEY) {
    return fail('服务端未配置 CREDENTIAL_ENC_KEY', 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const ct0 = String(body?.ct0 || '').trim();
  const authToken = String(body?.authToken || '').trim();
  if (!ct0 || !authToken) return fail('请填写完整 ct0 与 auth_token');

  try {
    await setXCredentials(env, ct0, authToken);
    if (body?.screen_name) {
      await setSetting(env.DB, 'x_account_handle', String(body.screen_name));
    }
    return ok({ message: '凭据已加密保存' });
  } catch (err) {
    return fail(`保存失败: ${err.message}`, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);
  await env.DB.prepare(
    "DELETE FROM settings WHERE key IN ('x_ct0_enc','x_auth_token_enc','x_account_handle')"
  ).run();
  return ok({ message: '凭据已清除' });
}
