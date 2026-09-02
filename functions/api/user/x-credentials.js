/**
 * GET    /api/user/x-credentials   -> { has_credentials, x_handle }
 * POST   /api/user/x-credentials   { ct0, authToken }  验证并加密保存
 * DELETE /api/user/x-credentials   清除
 *
 * ⚠️ 安全权衡（把这个功能开放给普通注册用户的代价）
 *
 * ct0 + auth_token 等同该用户 X 账号的**完全控制权**：能发推、能读私信、能改资料。
 * 把配置入口开放给所有注册用户，意味着本站要为每个人保管一份这样的密文。
 * 一旦 CREDENTIAL_ENC_KEY 泄露或 D1 被拖库，所有用户的 X 账号一起失守。
 *
 * 已做的缓解：
 *   · AES-GCM 加密，密钥走 Workers Secret（不在库里、不在仓库里）
 *   · 永不回传前端：GET 只回 has_credentials + handle，密文只在服务端调 X 时解开
 *   · 保存前先验证有效性，避免存进一份废凭据
 *   · 用户可随时 DELETE 清除
 *
 * 仍然存在、无法靠代码消除的风险：
 *   · 站长（能读 D1 + 能读 Secret）技术上可以解密任何用户的凭据
 *   · X 官方视 Cookie 自动化为违反 ToS，用户账号有被限制的风险
 * 所以前端必须明确告知用户这两点，让他们自己决定要不要填。
 */
import { json, ok, fail, nowIso } from '../../_lib/http.js';
import { requireUser } from '../../_lib/user-auth.js';
import { encryptSecret } from '../../_lib/crypto.js';
import { verifyCredentials } from '../../_lib/x-provider/graphql.js';

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  const row = await env.DB.prepare(
    'SELECT x_handle, updated_at FROM user_x_credentials WHERE user_id = ?'
  ).bind(user.id).first();

  return json({
    success: true,
    has_credentials: !!row,
    x_handle: row?.x_handle || '',
    updated_at: row?.updated_at || null,
    // 刻意不返回 ct0 / auth_token
  }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);
  if (!env.CREDENTIAL_ENC_KEY) return fail('服务端未配置加密密钥，无法安全保存凭据', 503);

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
    // 先验证再落库，避免存进一份已失效的凭据
    const xUser = await verifyCredentials({ ct0, authToken }, env);

    await env.DB.prepare(
      `INSERT INTO user_x_credentials (user_id, ct0_enc, auth_token_enc, x_handle, x_user_id, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         ct0_enc=excluded.ct0_enc, auth_token_enc=excluded.auth_token_enc,
         x_handle=excluded.x_handle, x_user_id=excluded.x_user_id,
         updated_at=excluded.updated_at`
    ).bind(
      user.id,
      await encryptSecret(ct0, env.CREDENTIAL_ENC_KEY),
      await encryptSecret(authToken, env.CREDENTIAL_ENC_KEY),
      xUser.screen_name || '',
      xUser.id || '',
      nowIso()
    ).run();

    return json({ success: true, x_handle: xUser.screen_name, user: xUser });
  } catch (err) {
    return json({ success: false, error: err.message }, 200);
  }
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  await env.DB.prepare('DELETE FROM user_x_credentials WHERE user_id = ?').bind(user.id).run();
  return ok({ message: 'X 凭据已清除' });
}
