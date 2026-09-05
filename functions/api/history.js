/**
 * GET /api/history?id=<x-id>&screen_name=<handle>
 *
 * 字段变更时间线。
 *
 * 原站这张表有读取方却没有写入方, 所以线上时间线永远只显示"首次归档"兜底那一条。
 * 这里由同步管线真正写入 diff (见 functions/_lib/sync.js)。
 *
 * 同时收 id 和 screen_name: 博主改名后, 用旧 handle 也要能查到历史。
 */
import { json, fail } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '';
  const screenName = u.searchParams.get('screen_name') || '';

  if (!id && !screenName) return fail('需要 id 或 screen_name');

  try {
    const { results } = await env.DB.prepare(
      `SELECT field, old_value, new_value, changed_at
         FROM blogger_history
        WHERE (?1 != '' AND blogger_id = ?1)
           OR (?2 != '' AND screen_name = ?2)
        ORDER BY changed_at DESC
        LIMIT 200`
    ).bind(id, screenName).all();

    return json({ success: true, data: results || [] }, 200, {
      'cache-control': 'public, max-age=300',
    });
  } catch (err) {
    return fail(`读取时间线失败: ${err.message}`, 500);
  }
}
