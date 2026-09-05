/**
 * POST /api/admin/reset-d1   { clearCredentials }
 *
 *
 * ⚠️ 破坏性操作。原站只有一个前端 confirm() 挡着。这里要求 body 里带上
 * confirm:"DELETE ALL BLOGGERS" 才真的执行 —— 前端沿用代码不带这个字段, 所以
 * 默认会被拒绝并提示。想启用就在 admin.js 的请求体里补上该字段。
 *
 * 归档记录一旦清空无法恢复(除非有备份 JSON)。这与产品目标直接冲突, 所以刻意设高门槛。
 */
import { ok, fail } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

const CONFIRM_PHRASE = 'DELETE ALL BLOGGERS';

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body = {};
  try {
    body = await request.json();
  } catch { /* 允许空 body */ }

  if (body?.confirm !== CONFIRM_PHRASE) {
    return fail(
      `破坏性操作已拦截。请在请求体加上 confirm: "${CONFIRM_PHRASE}" 以确认清空全部归档记录。` +
      '建议先用管理台的"导出备份"下载一份 JSON。',
      428
    );
  }

  try {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM bloggers').first();

    const stmts = [
      env.DB.prepare('DELETE FROM blogger_history'),
      env.DB.prepare('DELETE FROM follower_snapshots'),
      env.DB.prepare('DELETE FROM bloggers'),
      env.DB.prepare('UPDATE sync_state SET running=0, current=0, new_fetched=0, total=0, last_item=NULL, cursor=NULL, error=NULL WHERE id=1'),
    ];

    // 原站前端固定传 clearCredentials:false, 即"清博主但保留 X 登录凭据"
    if (body?.clearCredentials === true) {
      stmts.push(env.DB.prepare(
        "DELETE FROM settings WHERE key IN ('x_ct0_enc','x_auth_token_enc','x_account_handle')"
      ));
    }

    await env.DB.batch(stmts);
    return ok({
      message: `已清空 ${before?.n || 0} 位博主归档数据`,
      cleared: before?.n || 0,
      credentialsCleared: body?.clearCredentials === true,
    });
  } catch (err) {
    return fail(`清理失败: ${err.message}`, 500);
  }
}
