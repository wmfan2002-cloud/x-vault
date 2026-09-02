/**
 * GET    /api/my-bloggers                                我收录的档案（公开+私密）
 * PATCH  /api/my-bloggers  { screen_name, visibility }   切换公开/私密
 * DELETE /api/my-bloggers  { screen_name }               取消收录（可批量 screen_names）
 *
 * ── DELETE 到底删了什么 ────────────────────────────────────────
 * 删的是**我这一行归属指针**，不是共享的归档数据。同一位博主全库只存一份
 * bloggers 行 + 一份 R2 媒体，谁在用它由 blogger_owners 逐行表示。所以：
 *
 *   · 公开仓（admin-legacy）持有的那行指针我碰不到 —— SQL 里 user_id 写死成调用者。
 *     因此**个人取消收录永远不会把公开仓的副本删掉**，这是靠 SQL 作用域保证的，
 *     不是靠 if 判断。
 *   · 别人的私人收录同理不受影响。
 *   · 我解除之后如果**再没有任何人引用**这份数据（没归属、也没收藏），
 *     它就没有存在的意义了，由 releaseOwnership() 顺手回收（含 R2 媒体）。
 *
 * "admin 上传的只能 admin 删"不需要单独写规则：admin-legacy 那行指针本身算一个
 * 引用，别人删自己的指针时计数不归零，数据自然留着。
 */
import { json, ok, fail } from '../_lib/http.js';
import { requireUser } from '../_lib/user-auth.js';
import { listOwnedBy, releaseOwnership } from '../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  try {
    const data = await listOwnedBy(env.DB, user.id);
    return json({
      success: true,
      data,
      count: data.length,
      public_count: data.filter((r) => r.visibility === 'public').length,
      private_count: data.filter((r) => r.visibility === 'private').length,
    }, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    return fail(`读取失败: ${err.message}`, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const visibility = body?.visibility === 'private' ? 'private' : 'public';

  // 支持批量：screen_names 数组，或 scope:'all' 表示"我收录的全部"。
  // 站长要把整份收录一次公开，逐条发请求既慢又容易半途失败。
  const MAX_BATCH = 500;
  let handles = null;
  let scopeAll = false;

  if (body?.scope === 'all') {
    scopeAll = true;
  } else if (Array.isArray(body?.screen_names)) {
    handles = body.screen_names.map((h) => String(h).trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
    if (!handles.length) return fail('screen_names 为空');
    if (handles.length > MAX_BATCH) return fail(`单次最多 ${MAX_BATCH} 个`);
  } else {
    const one = String(body?.screen_name || '').trim().replace(/^@/, '');
    if (!one) return fail('缺少 screen_name / screen_names / scope');
    handles = [one.toLowerCase()];
  }

  let res;
  if (scopeAll) {
    // 只改**我自己**这些归属行，不碰别人的
    res = await env.DB.prepare(
      'UPDATE blogger_owners SET visibility = ? WHERE user_id = ?'
    ).bind(visibility, user.id).run();
  } else {
    const ph = handles.map(() => '?').join(',');
    res = await env.DB.prepare(
      `UPDATE blogger_owners SET visibility = ?
        WHERE user_id = ?
          AND blogger_id IN (SELECT id FROM bloggers WHERE LOWER(screen_name) IN (${ph}))`
    ).bind(visibility, user.id, ...handles).run();
  }

  const changed = res.meta?.changes || 0;
  if (!changed) {
    return fail(handles && handles.length === 1
      ? `你没有收录 @${handles[0]}`
      : '没有匹配到你收录的博主', 404);
  }

  // 批量时直接回结果，不走下面单条的文案
  if (scopeAll || (handles && handles.length > 1)) {
    return ok({
      changed,
      visibility,
      message: visibility === 'public'
        ? `已公开 ${changed} 位（会出现在公开画廊）`
        : `已把 ${changed} 位设为仅自己可见（已从公开画廊撤下）`,
    });
  }
  const handle = handles[0];

  return ok({
    message: visibility === 'private' ? `@${handle} 已设为仅自己可见` : `@${handle} 已设为公开`,
    visibility,
  });
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  // 单条与批量共用一条路径。批量刻意**不支持 scope:'all'**：
  // PATCH 那边"一次全部公开"是可逆的，删除不可逆，不给一键清空的入口。
  // 上限 100 而不是 PATCH 的 500：每条归属要 4~5 次 D1 查询（删指针/查收藏/
  // 清标签/引用计数/回收），Workers Free 档每次调用约 50 次查询预算，
  // 上限再大就注定有一半在半途失败 —— 还不如让客户端分小片发。
  const MAX_BATCH = 100;
  let handles;
  if (Array.isArray(body?.screen_names)) {
    handles = [...new Set(
      body.screen_names.map((h) => String(h).trim().replace(/^@/, '')).filter(Boolean)
    )];
    if (!handles.length) return fail('screen_names 为空');
    if (handles.length > MAX_BATCH) return fail(`单次最多 ${MAX_BATCH} 个`);
  } else {
    const one = String(body?.screen_name || '').trim().replace(/^@/, '');
    if (!one) return fail('缺少 screen_name / screen_names');
    handles = [one];
  }

  const released = [];   // 成功解除的
  const reclaimed = [];  // 顺带被回收掉的（引用归零）
  const kept = [];       // 解除了但数据留着的
  const missing = [];    // 本来就没收录

  for (const handle of handles) {
    // avatar_key / cover_key 要在删之前取出来 —— 回收 R2 对象需要它们，
    // 行删掉之后就再也查不到了。
    const blogger = await env.DB.prepare(
      'SELECT id, screen_name, avatar_key, cover_key FROM bloggers WHERE LOWER(screen_name) = ?'
    ).bind(handle.toLowerCase()).first();
    if (!blogger) { missing.push(handle); continue; }

    const r = await releaseOwnership(env.DB, blogger, user.id, { media: env.MEDIA });
    if (!r.released) { missing.push(blogger.screen_name); continue; }

    released.push(blogger.screen_name);
    if (r.gcd) reclaimed.push(blogger.screen_name);
    else kept.push({ screen_name: blogger.screen_name, reason: r.reason, refs: r.refs });
  }

  if (!released.length) {
    return fail(handles.length === 1
      ? `你没有收录 @${handles[0]}`
      : '没有匹配到你收录的博主', 404);
  }

  // 提示必须说清"共享的那份还在不在" —— 这是用户唯一真正关心的事。
  let message;
  if (handles.length === 1) {
    const h = released[0];
    if (reclaimed.length) {
      message = `已取消收录 @${h}；没有其他人收录或收藏它，归档数据已一并回收`;
    } else {
      const k = kept[0];
      const detail = k?.reason === 'kept_admin' ? '公开仓仍保留着它'
        : k?.reason === 'kept_favorites' ? '仍有人收藏着它，归档数据保留'
        : `仍有 ${k?.refs?.owners ?? 0} 人收录着它，归档数据保留`;
      message = `已从我的收录中移除 @${h}（${detail}）`;
    }
  } else {
    message = `已取消收录 ${released.length} 位` +
      (reclaimed.length ? `，其中 ${reclaimed.length} 位无人再引用、归档数据已回收` : '，归档数据均因仍有人引用而保留') +
      (missing.length ? `；${missing.length} 位你本来就没收录` : '');
  }

  const remaining = await env.DB.prepare(
    'SELECT COUNT(*) n FROM blogger_owners WHERE user_id = ?'
  ).bind(user.id).first();

  return ok({
    message,
    released_count: released.length,
    released,
    reclaimed_count: reclaimed.length,
    reclaimed,
    kept,
    missing,
    total_owned: remaining?.n || 0,
  });
}
