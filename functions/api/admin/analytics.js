/**
 * GET /api/admin/analytics
 *
 * 数据分析页的聚合数据。
 *
 * 为什么单独开一个端点，而不是继续让前端拉 /api/admin/bloggers?limit=1000 自己算:
 *   1. limit 上限是 1000（db.js:78），库里已经 708 条 —— 再涨就会**静默少算**，
 *      KPI 与三张图表全部偏低且不报错。这是最难发现的那种错。
 *   2. 传 708 条完整档案（含 bio）只为了算几个数字，浪费带宽。
 *   3. 聚合用 SQL 做，D1 一次算完，比前端遍历快得多。
 */
import { json, fail } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  try {
    const db = env.DB;

    const kpi = await db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(clicks_card), 0)     AS clicks_card,
              COALESCE(SUM(clicks_timeline), 0) AS clicks_timeline,
              COALESCE(SUM(clicks_roulette), 0) AS clicks_roulette,
              COALESCE(SUM(followers_count), 0) AS followers_sum,
              COALESCE(MAX(followers_count), 0) AS followers_max,
              SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END)      AS verified,
              SUM(CASE WHEN is_suspended = 1 THEN 1 ELSE 0 END)  AS suspended,
              SUM(CASE WHEN is_suspended = 2 THEN 1 ELSE 0 END)  AS deleted,
              SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END)    AS blocked,
              SUM(CASE WHEN avatar_key IS NULL AND (avatar_origin IS NULL OR avatar_origin = '')
                       THEN 1 ELSE 0 END)                        AS no_avatar
         FROM bloggers`
    ).first();

    // 粉丝量级分档。阈值与画廊筛选胶囊保持一致（50万 / 10万）
    const tiers = await db.prepare(
      `SELECT
         SUM(CASE WHEN followers_count >= 1000000 THEN 1 ELSE 0 END) AS t1m,
         SUM(CASE WHEN followers_count >= 500000  AND followers_count < 1000000 THEN 1 ELSE 0 END) AS t500k,
         SUM(CASE WHEN followers_count >= 100000  AND followers_count < 500000  THEN 1 ELSE 0 END) AS t100k,
         SUM(CASE WHEN followers_count >= 10000   AND followers_count < 100000  THEN 1 ELSE 0 END) AS t10k,
         SUM(CASE WHEN followers_count <  10000 THEN 1 ELSE 0 END) AS tsmall
       FROM bloggers`
    ).first();

    // 排行榜直接在 SQL 里取 Top 10，前端不必再拉全表
    const topClicked = await db.prepare(
      `SELECT screen_name, name, followers_count, verified, is_suspended,
              avatar_key, avatar_origin,
              clicks_card, clicks_timeline, clicks_roulette,
              clicks_card + clicks_timeline + clicks_roulette AS total_clicks
         FROM bloggers
        WHERE clicks_card + clicks_timeline + clicks_roulette > 0
        ORDER BY total_clicks DESC LIMIT 10`
    ).all();

    const topFollowers = await db.prepare(
      `SELECT screen_name, name, followers_count, verified, is_suspended,
              avatar_key, avatar_origin
         FROM bloggers ORDER BY followers_count DESC LIMIT 10`
    ).all();

    // 归档增长曲线：按天累计
    const growth = await db.prepare(
      `SELECT substr(backed_up_at, 1, 10) AS day, COUNT(*) AS n
         FROM bloggers GROUP BY day ORDER BY day`
    ).all();

    const recentChanges = await db.prepare(
      `SELECT screen_name, field, old_value, new_value, changed_at
         FROM blogger_history ORDER BY changed_at DESC LIMIT 20`
    ).all();

    const historyStats = await db.prepare(
      `SELECT field, COUNT(*) AS n FROM blogger_history GROUP BY field ORDER BY n DESC`
    ).all();

    const snapshots = await db.prepare('SELECT COUNT(*) AS n FROM follower_snapshots').first();

    return json({
      success: true,
      kpi: {
        ...kpi,
        total_clicks: (kpi.clicks_card || 0) + (kpi.clicks_timeline || 0) + (kpi.clicks_roulette || 0),
        followers_avg: kpi.total ? Math.round(kpi.followers_sum / kpi.total) : 0,
        verified_pct: kpi.total ? Math.round((kpi.verified / kpi.total) * 100) : 0,
        snapshots: snapshots?.n || 0,
      },
      tiers,
      topClicked: (topClicked.results || []).map(withMediaUrl),
      topFollowers: (topFollowers.results || []).map(withMediaUrl),
      growth: growth.results || [],
      recentChanges: recentChanges.results || [],
      historyStats: historyStats.results || [],
    }, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    return fail(`聚合失败: ${err.message}`, 500);
  }
}

/** 排行榜行也要能显示头像，所以补上和 toPublicShape 一致的 avatar_url */
function withMediaUrl(row) {
  const { avatar_key, avatar_origin, ...rest } = row;
  return {
    ...rest,
    avatar_url: avatar_key
      ? `/api/media?key=${encodeURIComponent(avatar_key)}`
      : (avatar_origin || ''),
    total_clicks: row.total_clicks
      ?? ((row.clicks_card || 0) + (row.clicks_timeline || 0) + (row.clicks_roulette || 0)),
  };
}
