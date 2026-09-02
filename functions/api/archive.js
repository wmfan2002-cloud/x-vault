/**
 * GET  /api/archive  公开全量读 (静态快照失效时的降级源)
 * POST /api/archive  管理员从备份 JSON 覆盖导入
 *
 * 契约见 _reference/spec/03-api-contract.md §3.1
 * 注意两者响应形状不同: 静态快照是裸数组, 这里是 {success, data:[]}
 */
import { ok, fail, json, nowIso } from '../_lib/http.js';
import { listAll, ensureOwnership } from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';

export async function onRequestGet({ env }) {
  try {
    const data = await listAll(env.DB);
    return json({ success: true, data }, 200, {
      // 公开读, 允许边缘短缓存; 写入后由部署/快照重建来失效
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    });
  } catch (err) {
    return fail(`读取归档失败: ${err.message}`, 500);
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
  const rows = body?.data;
  if (!Array.isArray(rows)) return fail('data 必须是数组');
  if (rows.length > 20000) return fail('单次导入上限 20000 条');

  const now = nowIso();
  const stmts = [];

  for (const r of rows) {
    if (!r?.id || !r?.screen_name) continue;
    const av = splitMedia(r.avatar_url);
    const cv = splitMedia(r.cover_url);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO bloggers (id, screen_name, name, description, followers_count, verified,
           is_suspended, is_blocked, avatar_key, avatar_origin, cover_key, cover_origin,
           backed_up_at, last_synced_at, clicks_card, clicks_timeline, clicks_roulette)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
         ON CONFLICT(id) DO UPDATE SET
           screen_name=excluded.screen_name, name=excluded.name,
           description=excluded.description, followers_count=excluded.followers_count,
           verified=excluded.verified, is_suspended=excluded.is_suspended,
           is_blocked=excluded.is_blocked,
           avatar_key=COALESCE(excluded.avatar_key, bloggers.avatar_key),
           avatar_origin=COALESCE(excluded.avatar_origin, bloggers.avatar_origin),
           cover_key=COALESCE(excluded.cover_key, bloggers.cover_key),
           cover_origin=COALESCE(excluded.cover_origin, bloggers.cover_origin),
           last_synced_at=excluded.last_synced_at`
      ).bind(
        String(r.id), String(r.screen_name), r.name ?? '', r.description ?? '',
        int(r.followers_count), bit(r.verified), tri(r.is_suspended), bit(r.is_blocked),
        av.key, av.origin, cv.key, cv.origin,
        r.backed_up_at || now, r.last_synced_at ?? null,
        int(r.clicks_card), int(r.clicks_timeline), int(r.clicks_roulette)
      )
    );
  }

  if (!stmts.length) return fail('没有可导入的有效记录');

  try {
    await env.DB.batch(stmts);

    // ⚠️ 归属行必须一并建，否则导入进来的全是不可见的孤儿
    // （listAll() 要求至少一条 public 归属）。备份恢复时最容易在这里踩坑：
    // 数字对了、管理台看得到、画廊却是空的。
    //
    // 备份 JSON 里没有归属信息（它是公开形状，只有 16 个字段），所以统一挂到站长名下，
    // 可见性跟随 settings.sync_default_visibility；导入时可用 body.visibility 覆盖。
    let owned = 0;
    for (const r of rows) {
      if (!r?.id || !r?.screen_name) continue;
      await ensureOwnership(env.DB, String(r.id), { visibility: body?.visibility });
      owned++;
    }

    return ok({
      message: `已导入 ${stmts.length} 位博主（${owned} 条归属已挂到站长名下）`,
      count: stmts.length,
      owned,
    });
  } catch (err) {
    return fail(`导入失败: ${err.message}`, 500);
  }
}

const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const bit = (v) => (v ? 1 : 0);
/** is_suspended 是三态 0/1/2, 不能当布尔压平 */
const tri = (v) => (v === 1 || v === 2 ? v : 0);

function splitMedia(url) {
  if (!url) return { key: null, origin: null };
  if (String(url).startsWith('/api/media')) {
    const m = String(url).match(/[?&]key=([^&]+)/);
    return { key: m ? decodeURIComponent(m[1]) : null, origin: null };
  }
  if (/^https?:\/\//.test(url)) return { key: null, origin: String(url) };
  return { key: null, origin: null };
}
