/**
 * POST /api/admin/refetch-avatar
 *   { screen_names: ["a","b"] }        指定博主
 *   { all_missing: true, limit: 25 }   自动挑"图取不回来"的记录
 *   { source: "x" | "unavatar" }       取图来源, 默认 x
 *
 * 解决的问题: 现有 324/332 条记录只存了指向原站已死 R2 桶的 key, 源 URL 被丢弃,
 * 所以图片取不回来。这个端点去博主主页重新取一张, 存进**你自己的** R2, 并且这次
 * 把 origin 一起落库, 不再重犯原站的错。
 *
 * 两种来源:
 *   x         用你存的 Cookie 调 X, 权威, 顺带能识别封号/注销 -> 落墓碑状态
 *   unavatar  第三方 unavatar.io, 不需要凭据。⚠️ 会把 handle 发给第三方,
 *             且对已消失的账号返回占位 SVG(实测 569B), 这里会拒收
 *
 * Workers 有 CPU/时长限额, 所以单次上限 25 个, 由调用方循环。
 */
import { json, fail, nowIso } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';
import { getXCredentials } from '../../_lib/crypto.js';
import { lookupUserByHandle } from '../../_lib/x-provider/graphql.js';
import { archiveMedia, markTombstone } from '../../_lib/sync.js';

// 单请求上限。每个博主要 1 次 GraphQL 查询 + 最多 2 次取图 + 2 次 R2 写入,
// 25 个会打爆 Workers 的 CPU/子请求限额(实测 wrangler pages dev 直接返回
// "Your worker exceeded ..." 的非 JSON 错误页)。8 个是实测稳的规模。
const MAX_BATCH = 8;

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);
  if (!env.MEDIA) return fail('R2 未绑定, 无法归档图片', 503);

  let body = {};
  try {
    body = await request.json();
  } catch { /* 允许空 body */ }

  const source = body?.source === 'unavatar' ? 'unavatar' : 'x';
  const limit = Math.min(Math.max(parseInt(body?.limit ?? MAX_BATCH, 10) || MAX_BATCH, 1), MAX_BATCH);

  // 选目标: 显式指定, 或自动挑"没有可用图片来源"的记录
  let targets;
  if (Array.isArray(body?.screen_names) && body.screen_names.length) {
    const names = body.screen_names.slice(0, limit).map((s) => String(s).trim()).filter(Boolean);
    if (!names.length) return fail('screen_names 为空');
    const ph = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, screen_name, avatar_key, avatar_origin, is_suspended
         FROM bloggers WHERE LOWER(screen_name) IN (${ph})`
    ).bind(...names.map((n) => n.toLowerCase())).all();
    targets = results || [];
  } else {
    // avatar_origin 为空 = 只剩一个死 R2 key, 图片实际取不回来
    const { results } = await env.DB.prepare(
      `SELECT id, screen_name, avatar_key, avatar_origin, is_suspended
         FROM bloggers
        WHERE avatar_origin IS NULL OR avatar_origin = ''
        ORDER BY followers_count DESC
        LIMIT ?`
    ).bind(limit).all();
    targets = results || [];
  }

  if (!targets.length) return json({ success: true, message: '没有需要补图的记录', results: [], remaining: 0 });

  let creds = null;
  if (source === 'x') {
    creds = await getXCredentials(env);
    if (!creds) return fail('尚未配置 X Cookie 凭据, 或改用 source:"unavatar"');
  }

  const results = [];
  let rateLimited = false;
  for (const row of targets) {
    const r = await refetchOne(env, row, source, creds);
    results.push(r);
    // 命中速率限制就整批中止 —— 继续打只会让限流窗口更长。
    // 调用方(scripts/refetch-avatars.mjs)看到 rate_limited 会长睡后再续。
    if (r.status === 'rate_limited') { rateLimited = true; break; }
  }

  const remainingRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM bloggers WHERE avatar_origin IS NULL OR avatar_origin = ''"
  ).first();

  const okCount = results.filter((r) => r.status === 'ok').length;
  return json({
    success: true,
    message: rateLimited
      ? `命中 X 速率限制，本批中止（已补回 ${okCount} 张）`
      : `成功补回 ${okCount}/${results.length} 张头像`,
    results,
    rate_limited: rateLimited,
    remaining: remainingRow?.n || 0,
  });
}

async function refetchOne(env, row, source, creds) {
  const handle = row.screen_name;
  const logs = [];
  const log = (m) => logs.push(m);

  try {
    let avatarOrigin = null;
    let coverOrigin = null;

    if (source === 'x') {
      const profile = await lookupUserByHandle(creds, env, handle);

      // 账号已消失: 落墓碑, 不删记录 —— 这正是产品存在的意义
      if (profile?.unavailable) {
        await markTombstone(env, row.id, handle, profile.unavailable, log);
        return {
          screen_name: handle,
          status: 'tombstoned',
          is_suspended: profile.unavailable,
          message: profile.unavailable === 1 ? '账号已被封号, 头像无法取回' : '账号已注销, 头像无法取回',
        };
      }

      avatarOrigin = profile.avatar_origin;
      coverOrigin = profile.cover_origin;

      // 顺手把资料刷新一遍(改名/换简介/粉丝数)
      await env.DB.prepare(
        `UPDATE bloggers SET name=?, description=?, followers_count=?, verified=?, last_synced_at=?
          WHERE id=?`
      ).bind(profile.name, profile.description, profile.followers_count, profile.verified, nowIso(), row.id).run();
    } else {
      avatarOrigin = await resolveViaUnavatar(handle);
      if (!avatarOrigin) {
        return { screen_name: handle, status: 'not_found', message: 'unavatar 未返回真实头像(账号可能已消失)' };
      }
    }

    if (!avatarOrigin) {
      return { screen_name: handle, status: 'no_avatar', message: '该账号没有自定义头像' };
    }

    const avatarKey = await archiveMedia(env, 'avatars', row.id, avatarOrigin, log);
    if (!avatarKey) {
      return { screen_name: handle, status: 'fetch_failed', message: '取图失败', logs };
    }

    let coverKey = null;
    if (coverOrigin) {
      // banner 常缺失(实测 23/332 无 banner), 失败不影响头像
      coverKey = await archiveMedia(env, 'covers', row.id, coverOrigin, log);
    }

    await env.DB.prepare(
      `UPDATE bloggers
          SET avatar_key=?, avatar_origin=?,
              cover_key=COALESCE(?, cover_key), cover_origin=COALESCE(?, cover_origin),
              last_synced_at=?
        WHERE id=?`
    ).bind(avatarKey, avatarOrigin, coverKey, coverOrigin, nowIso(), row.id).run();

    // 记一条时间线: 头像来源变了
    await env.DB.prepare(
      `INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at)
       VALUES (?,?,'avatar_url',?,?,?)`
    ).bind(row.id, handle, row.avatar_key || '', avatarKey, nowIso()).run();

    return { screen_name: handle, status: 'ok', avatar_key: avatarKey, avatar_origin: avatarOrigin, logs };
  } catch (err) {
    if (err.rateLimited || err.status === 429) {
      return { screen_name: handle, status: 'rate_limited', message: err.message };
    }
    return { screen_name: handle, status: 'error', message: err.message, logs };
  }
}

/**
 * unavatar.io 兜底。实测: 活跃账号返回真实 jpeg(与 twimg 直链字节数一致),
 * 已消失账号返回 ~569B 的占位 SVG —— 必须拒收, 否则会把占位图当成头像归档。
 *
 * 尽量把重定向跟到底, 拿到真正的 pbs.twimg.com 地址存进 avatar_origin ——
 * 存第三方转发地址等于把"可恢复性"寄托在别人的服务上, 那正是原站犯的错的变体。
 */
async function resolveViaUnavatar(handle) {
  const proxied = `https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false`;
  const res = await fetch(proxied, { redirect: 'follow' });
  if (!res.ok) return null;

  const ct = res.headers.get('content-type') || '';
  const len = Number(res.headers.get('content-length') || 0);
  // 占位 SVG = 账号已消失, 不能当成头像归档
  if (ct.includes('svg') || (len && len < 2000)) return null;

  // res.url 是跟完重定向后的最终地址; 命中 twimg 就用真源, 否则退回代理地址
  const final = res.url || '';
  return /^https:\/\/(pbs|abs)\.twimg\.com\//.test(final) ? final : proxied;
}

