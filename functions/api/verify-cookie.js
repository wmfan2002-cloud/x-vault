/**
 * POST /api/verify-cookie   { ct0, authToken } -> { success, user }
 *
 * 契约见 _reference/spec/03-api-contract.md §3.5
 * 注意字段是驼峰 authToken, 不是 auth_token。
 *
 * 副作用: 验证成功时把凭据加密入库(替代原站的明文回传+localStorage),
 * 并缓存 @handle 供 UI 回显。
 */
import { json, fail } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { setXCredentials, setSetting, getXCredentials } from '../_lib/crypto.js';
import { verifyCredentials } from '../_lib/x-provider/graphql.js';

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body = {};
  try {
    body = await request.json();
  } catch { /* 允许空 body，下面回退到库里存的那份 */ }

  let ct0 = String(body?.ct0 || '').trim();
  let authToken = String(body?.authToken || '').trim();

  // 表单留空时用库里加密存的那份 —— 与 /api/sync-following 行为一致。
  // 没有这个回退的话，「重新验证」按钮每次都要求把 Cookie 再贴一遍，
  // 而凭据保存后前端只拿得到 hasCredentials，根本没有原文可填。
  if (!ct0 || !authToken) {
    const stored = await getXCredentials(env);
    if (stored) { ct0 = stored.ct0; authToken = stored.authToken; }
  }
  if (!ct0 || !authToken) return fail('请填写完整 ct0 与 auth_token（库里也没有已保存的凭据）');

  try {
    const user = await verifyCredentials({ ct0, authToken }, env);

    // 验证通过才落库, 避免存进一份已失效的凭据
    if (env.CREDENTIAL_ENC_KEY) {
      await setXCredentials(env, ct0, authToken);
      await setSetting(env.DB, 'x_account_handle', user.screen_name || '');
      await setSetting(env.DB, 'x_account_id', user.id || '');
    }

    return json({ success: true, user });
  } catch (err) {
    // 前端只看 success/user, 失效时展示"Cookie 已失效"
    return json({ success: false, error: err.message }, 200);
  }
}
