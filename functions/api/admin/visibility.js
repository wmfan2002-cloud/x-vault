/**
 * POST /api/admin/visibility   改站长自己那条归属的可见性
 *   { screen_name, visibility }                单个
 *   { screen_names: [...], visibility }        批量
 *   { scope: 'blocked'|'all_private'|'all_public', visibility }   按范围批量
 *
 * GET  /api/admin/visibility   -> { default_visibility, counts }
 * PUT  /api/admin/visibility   { default_visibility }  改「同步默认可见性」
 *
 * ── 为什么要有这个端点（和「屏蔽」的区别）────────────────────────
 *
 * 站长手上其实有三种「不想让它出现」的操作，语义完全不同，别混用：
 *
 *   1. 私密（这里）  blogger_owners.visibility = 'private'
 *      只改**站长自己这一条归属**。档案还在，站长在管理台照常看得到。
 *      别人后来收录同一位博主并标记公开 -> 它会重新出现在公开画廊，且那个人看得见。
 *      —— 这才是「批量同步进来先不公开、慢慢挑」该用的操作。
 *
 *   2. 屏蔽        bloggers.is_blocked = 1
 *      **全局**，写在共享的 bloggers 行上。对所有人生效：无论谁把它收录成公开，
 *      都进不了公开画廊。用于「这个号的内容不该出现在本站」这种审核判断。
 *      代价就是站长担心的那个：会连带影响后来收录同一位博主的其他用户。
 *
 *   3. 删除        DELETE FROM bloggers
 *      整行没了，点击数、时间线、R2 媒体一并失去引用，不可恢复。
 *
 * 选择依据一句话：只关我自己 -> 私密；关所有人 -> 屏蔽；不要这条数据了 -> 删除。
 */
import { ok, fail, json, nowIso } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';
import { getSetting, setSetting } from '../../_lib/crypto.js';
import { countOrphans } from '../../_lib/db.js';

const ADMIN_OWNER = 'admin-legacy';
const MAX_BATCH = 500;

async function counts(db) {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM blogger_owners WHERE user_id=?1 AND visibility='public')  AS mine_public,
       (SELECT COUNT(*) FROM blogger_owners WHERE user_id=?1 AND visibility='private') AS mine_private,
       (SELECT COUNT(*) FROM bloggers WHERE is_blocked=1) AS blocked,
       (SELECT COUNT(*) FROM bloggers b WHERE b.is_blocked=0
          AND EXISTS (SELECT 1 FROM blogger_owners o
                       WHERE o.blogger_id=b.id AND o.visibility='public')) AS gallery_visible`
  ).bind(ADMIN_OWNER).first();
  return {
    mine_public: row?.mine_public || 0,
    mine_private: row?.mine_private || 0,
    blocked: row?.blocked || 0,
    gallery_visible: row?.gallery_visible || 0,
    // >0 说明某个插入路径漏了建归属行 —— 那些记录是不可见的孤儿。
    // 这个数字在管理台会显示成告警条 + 一键修复，因为这个 bug 已经犯过三次。
    orphans: await countOrphans(db),
  };
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);
  const def = (await getSetting(env.DB, 'sync_default_visibility')) || 'private';
  return json({
    success: true,
    default_visibility: def === 'public' ? 'public' : 'private',
    counts: await counts(env.DB),
  }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestPut({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);
  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }

  const v = body?.default_visibility === 'public' ? 'public' : 'private';
  await setSetting(env.DB, 'sync_default_visibility', v);
  return ok({
    default_visibility: v,
    message: v === 'public'
      ? '同步进来的新博主将直接公开'
      : '同步进来的新博主将先设为仅站长可见',
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);
  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }

  if (body?.visibility !== 'public' && body?.visibility !== 'private') {
    return fail("visibility 只能是 'public' 或 'private'");
  }
  const visibility = body.visibility;

  // 1) 解析目标 blogger_id 列表
  let ids, label;  // 下面每个分支都会赋值（scope 或 handle 列表）

  if (body.scope) {
    // 按范围批量。scope='blocked' 是给站长把误用「屏蔽」做筛选的那批转成私密用的：
    // 转完 is_blocked 归 0，别人收录同一位博主就不再受影响。
    const scopeSql = {
      // orphans: 完全没有归属行的记录。它们既不在画廊、也不属于任何人，
      // 是某个插入路径漏建归属造成的。给它们挂上归属就恢复正常。
      orphans:      `SELECT id FROM bloggers b WHERE NOT EXISTS
                      (SELECT 1 FROM blogger_owners o WHERE o.blogger_id = b.id)`,
      blocked:      'SELECT id FROM bloggers WHERE is_blocked = 1',
      all_private:  `SELECT blogger_id AS id FROM blogger_owners WHERE user_id='${ADMIN_OWNER}' AND visibility='private'`,
      all_public:   `SELECT blogger_id AS id FROM blogger_owners WHERE user_id='${ADMIN_OWNER}' AND visibility='public'`,
    }[body.scope];
    if (!scopeSql) return fail('未知的 scope');
    const { results } = await env.DB.prepare(scopeSql).all();
    ids = (results || []).map((r) => r.id);
    label = `范围 ${body.scope}`;
  } else {
    const handles = Array.isArray(body.screen_names)
      ? body.screen_names
      : (body.screen_name ? [body.screen_name] : []);
    if (!handles.length) return fail('缺少 screen_name / screen_names / scope');
    if (handles.length > MAX_BATCH) return fail(`单次最多 ${MAX_BATCH} 个`);

    const norm = handles.map((h) => String(h).trim().toLowerCase()).filter(Boolean);
    const ph = norm.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, screen_name FROM bloggers WHERE LOWER(screen_name) IN (${ph})`
    ).bind(...norm).all();
    ids = (results || []).map((r) => r.id);
    if (!ids.length) return fail('未找到对应的博主档案', 404);
    label = norm.length === 1 ? `@${handles[0]}` : `${ids.length} 位博主`;
  }

  if (!ids.length) return ok({ changed: 0, message: '没有符合条件的记录', counts: await counts(env.DB) });

  // 2) 写归属。站长可能对某条博主根本没有归属行（例如是别人投稿进来的），
  //    所以用 upsert 而不是 UPDATE —— 否则「设为公开」对这类记录会静默无效。
  const now = nowIso();
  const stmts = ids.map((id) => env.DB.prepare(
    `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
     VALUES (?,?,?,?)
     ON CONFLICT(user_id, blogger_id) DO UPDATE SET visibility = excluded.visibility`
  ).bind(ADMIN_OWNER, id, visibility, now));

  // 3) 转私密时顺手解除全局屏蔽 —— 两者是替代关系，同时挂着只会让语义更糊：
  //    留着 is_blocked=1 的话，别人收录同一位博主依然进不了画廊，
  //    而「转私密」的全部意义就是把影响范围收回到站长自己。
  if (visibility === 'private' && (body.scope === 'blocked' || body.unblock !== false)) {
    const ph = ids.map(() => '?').join(',');
    stmts.push(env.DB.prepare(
      `UPDATE bloggers SET is_blocked = 0 WHERE id IN (${ph}) AND is_blocked = 1`
    ).bind(...ids));
  }

  // D1 batch 是单个事务，中途失败整批回滚 —— 不会留下改一半的状态
  await env.DB.batch(stmts);

  // ⚠️ 这里只改了 D1。`public/data/archive.json` 是构建产物，
  // Pages Functions 无法写静态资源，所以快照仍是旧的。
  // 前端已改成 stale-while-revalidate（先用快照出图、再向本接口核对），
  // 所以访客最迟 60s（/api/archive 的 max-age）就能看到改动，不需要重新部署。
  // 但**快照本身**要等下一次 `node scripts/generate-snapshot.mjs` 才更新 ——
  // 那关系到"后端全挂时画廊还剩多少内容"，所以建议随全量刷新一起跑。

  return ok({
    changed: ids.length,
    visibility,
    counts: await counts(env.DB),
    message: visibility === 'public'
      ? `已公开 ${label}（${ids.length} 条）`
      : `已设为仅站长可见 ${label}（${ids.length} 条）`,
  });
}
