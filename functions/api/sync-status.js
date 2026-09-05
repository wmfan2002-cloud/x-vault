/**
 * GET /api/sync-status -> 进度轮询 (客户端 1500ms 一次)
 *
 * 注意: 这个响应**不是** {success,...} 形状 —— admin.js:598 直接读 status.running 等字段。
 */
import { json, fail, nowIso } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';

// 任务卡死保护: 超过这个时长仍标记 running 就当它已经死了
const STALE_MS = 10 * 60 * 1000;

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  const row = await env.DB.prepare('SELECT * FROM sync_state WHERE id = 1').first();
  if (!row) return json({ running: false, current: 0, total: 0 });

  let running = !!row.running;
  let error = row.error || null;

  // 边缘 Function 被中断时不会有机会把 running 置 0, 这里兜底
  if (running && row.started_at && Date.now() - new Date(row.started_at).getTime() > STALE_MS) {
    running = false;
    error = error || '任务超时未上报, 已自动标记结束';
    await env.DB.prepare('UPDATE sync_state SET running=0, error=? WHERE id=1')
      .bind(error).run();
  }

  let lastItem = null;
  if (row.last_item) {
    try { lastItem = JSON.parse(row.last_item); } catch { /* 忽略坏数据 */ }
  }

  return json({
    running,
    // 断点存在 = 还没走完，再点一次会从这里继续。
    // offset > 0 也算（停在第一页中间时 cursor 是 null）
    has_more: !!row.cursor || (row.cursor_offset || 0) > 0,
    passScanned: row.pass_scanned || 0,
    current: row.current || 0,
    newFetched: row.new_fetched || 0,
    total: row.total || 0,
    lastItem,
    error,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    checkedAt: nowIso(),
  });
}
