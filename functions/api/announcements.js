/**
 * GET /api/announcements  -> 当前生效的公告（公开，无需登录）
 *
 * 只返回 is_active=1 且在生效时间窗内的。时间判定放在 SQL 里而不是后台任务：
 * 边缘环境没有常驻进程，定时下线会变成另一套要维护的东西。
 *
 * ⚠️ body 是**纯文本**。前端必须 escapeHtml 之后再渲染 ——
 * 公告会出现在每个访客的页面上，允许 HTML 等于给全站开一个存储型 XSS 面。
 */
import { json } from '../_lib/http.js';

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, body, level, pinned, created_at, updated_at
         FROM announcements
        -- ⚠️ 时间比较必须两边都套 datetime()，不能直接比字符串：
        -- 存的是 ISO 'YYYY-MM-DDTHH:MM:SS.sssZ'（T 分隔），而 datetime('now')
        -- 是 'YYYY-MM-DD HH:MM:SS'（空格分隔）。第 11 位 'T'(0x54) > ' '(0x20)，
        -- 于是**同一天内**任意 ISO 时间都会被判成"大于现在" —— 1 小时前的会被当未来。
        -- 跨天时碰巧能对，所以拿"明天/昨天"测发现不了。
        WHERE is_active = 1
          AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now'))
          AND (ends_at   IS NULL OR ends_at   = '' OR datetime(ends_at)   >  datetime('now'))
        ORDER BY pinned DESC, created_at DESC
        LIMIT 20`
    ).all();

    return json({ success: true, data: results || [] }, 200, {
      // 60s：公告发出去要尽快可见，但也不必每次访问都打 D1
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    });
  } catch (err) {
    // 公告读不到不该影响画廊 —— 回空数组而不是 500
    return json({ success: true, data: [], error: err.message }, 200);
  }
}
