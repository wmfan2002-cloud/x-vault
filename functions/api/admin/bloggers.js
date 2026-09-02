/**
 * GET  /api/admin/bloggers?keyword=&status=&sort=&page=&limit=
 * POST /api/admin/bloggers  { screen_name, is_blocked }
 *
 * 契约见 _reference/spec/03-api-contract.md §3.8
 *
 * GET 响应必须同时带 data / stats / total / page / limit / totalPages ——
 * admin.js:1191-1200 全部都读。stats 是全库统计, 不受筛选分页影响。
 */
import { ok, fail, json } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';
import { listPaged } from '../../_lib/db.js';

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  const p = new URL(request.url).searchParams;
  try {
    const result = await listPaged(env.DB, {
      keyword: p.get('keyword') || '',
      status: p.get('status') || 'all',
      sort: p.get('sort') || 'backed_up_at_desc',
      page: p.get('page') || 1,
      limit: p.get('limit') || 30,
    });
    return json({ success: true, ...result });
  } catch (err) {
    return fail(`查询失败: ${err.message}`, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const handle = String(body?.screen_name || '').trim();
  if (!handle) return fail('缺少 screen_name');

  // 目前唯一的写入语义是屏蔽/恢复 (admin.js:1402)
  if (body?.is_blocked === undefined) return fail('缺少 is_blocked');
  const blocked = body.is_blocked ? 1 : 0;

  try {
    const res = await env.DB.prepare(
      'UPDATE bloggers SET is_blocked = ? WHERE LOWER(screen_name) = ?'
    ).bind(blocked, handle.toLowerCase()).run();

    if (!res.meta?.changes) return fail(`未找到 @${handle}`, 404);

    return ok({ message: blocked ? `已屏蔽 @${handle}` : `已恢复 @${handle}` });
  } catch (err) {
    return fail(`操作失败: ${err.message}`, 500);
  }
}
