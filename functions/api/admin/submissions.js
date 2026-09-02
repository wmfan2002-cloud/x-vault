/**
 * GET /api/admin/submissions?status=&limit=&page=
 *
 * 公开投稿记录。**这个路由此前不存在** —— STATE.md 里把它列成"已完成"，
 * 但文件从来没建过，管理台也没有任何入口。
 *
 * 为什么必须有：首页的投稿是「无审核，提交即收录」。不审核是产品决定，
 * 但站长总得有个地方看见都进了什么、谁在刷、被拒的是哪些 —— 否则唯一的
 * 发现途径是有人投了脏东西之后自己在画廊里翻出来。
 *
 * status 取值（对齐 submit.js 里 record() 实际写入的值，别照文档猜）：
 *   accepted   核实通过并已入库
 *   duplicate  已在库中（登录用户会同时得到一条归属）
 *   rejected   账号不存在 / 已封号 / 取不到资料
 *   failed     服务端问题：未配 X 凭据、X 速率限制、其它异常
 *   register   借这张表记的注册限流打点，不是投稿 —— 默认过滤掉
 *
 * 注意**没有** throttled：撞 IP/全站限流时 submit.js 直接返回 429 且**不落库**
 * （见 submit.js:69-76）。所以这里统计不到被限流的次数 —— 那部分只能看
 * Cloudflare 的请求日志。
 */
import { json, fail } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

const STATUSES = ['accepted', 'duplicate', 'rejected', 'failed', 'register'];

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  const p = new URL(request.url).searchParams;
  const status = p.get('status') || '';
  const limit = Math.min(Math.max(parseInt(p.get('limit'), 10) || 30, 1), 200);
  const page = Math.max(parseInt(p.get('page'), 10) || 1, 1);

  const where = [];
  const bind = [];
  if (status && STATUSES.includes(status)) {
    where.push('s.status = ?');
    bind.push(status);
  } else {
    // register 是注册限流打点，混在投稿列表里只会干扰
    where.push("s.status != 'register'");
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  try {
    const rows = await env.DB.prepare(
      `SELECT s.screen_name, s.status, s.reason, s.created_at, s.visibility,
              u.display_name AS submitter, u.oauth_provider,
              -- ip_hash 只回前 8 位：足够看出"是不是同一个人在刷"，
              -- 又不把完整哈希暴露出去（完整哈希配合已知 IP 可反查）
              substr(s.ip_hash, 1, 8) AS ip_prefix,
              (SELECT 1 FROM bloggers b WHERE LOWER(b.screen_name) = LOWER(s.screen_name)) AS in_archive
         FROM submissions s
         LEFT JOIN users u ON u.id = s.user_id
         ${clause}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`
    ).bind(...bind, limit, (page - 1) * limit).all();

    const counted = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM submissions s ${clause}`
    ).bind(...bind).first();

    const stats = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status='accepted'  THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN status='duplicate' THEN 1 ELSE 0 END) AS duplicate,
         SUM(CASE WHEN status='rejected'  THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) AS failed,
         COUNT(DISTINCT ip_prefix_calc) AS submitters
       FROM (SELECT status, substr(ip_hash,1,8) AS ip_prefix_calc
               FROM submissions WHERE status != 'register')`
    ).first();

    const total = counted?.n || 0;
    return json({
      success: true,
      data: rows.results || [],
      stats: {
        accepted: stats?.accepted || 0,
        duplicate: stats?.duplicate || 0,
        rejected: stats?.rejected || 0,
        failed: stats?.failed || 0,
        submitters: stats?.submitters || 0,
      },
      total, page, limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    }, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    return fail(`读取投稿记录失败: ${err.message}`, 500);
  }
}
