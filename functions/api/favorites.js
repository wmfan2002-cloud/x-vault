/**
 * GET    /api/favorites                     列出我的收藏（仅自己可见）
 * POST   /api/favorites  { screen_name }    加入收藏
 * DELETE /api/favorites  { screen_name }    取消收藏
 *
 * 收藏是私有数据，一律要求登录 —— stylekit 那边还支持匿名 session_id 模式
 * （favorites 表也留了 session_id 列和 partial unique index），但"仅自己可见的
 * 收藏页"在匿名下没有意义（换浏览器就丢），所以这里只开放给登录用户。
 */
import { json, ok, fail, nowIso } from '../_lib/http.js';
import { requireUser } from '../_lib/user-auth.js';
import { listFavoritesBy, countRefs, purgeBlogger } from '../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  try {
    const data = await listFavoritesBy(env.DB, user.id);
    return json({ success: true, data, count: data.length }, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    return fail(`读取收藏失败: ${err.message}`, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  const handle = await readHandle(request);
  if (!handle) return fail('缺少 screen_name');

  const blogger = await env.DB.prepare(
    'SELECT id, screen_name FROM bloggers WHERE LOWER(screen_name) = ?'
  ).bind(handle.toLowerCase()).first();
  if (!blogger) return fail(`归档库中没有 @${handle}`, 404);

  try {
    // partial unique index 保证幂等，重复收藏静默忽略
    await env.DB.prepare(
      `INSERT INTO favorites (user_id, blogger_id, created_at) VALUES (?,?,?)
       ON CONFLICT DO NOTHING`
    ).bind(user.id, blogger.id, nowIso()).run();

    const n = await env.DB.prepare('SELECT COUNT(*) c FROM favorites WHERE user_id = ?')
      .bind(user.id).first();
    return ok({ message: `已收藏 @${blogger.screen_name}`, favorited: true, count: n?.c || 0 });
  } catch (err) {
    return fail(`收藏失败: ${err.message}`, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  const handle = await readHandle(request);
  if (!handle) return fail('缺少 screen_name');

  try {
    // avatar_key / cover_key 要在删之前取出来 —— 引用归零回收 R2 对象需要它们，
    // 行删掉之后就再也查不到了。
    const blogger = await env.DB.prepare(
      'SELECT id, screen_name, avatar_key, cover_key FROM bloggers WHERE LOWER(screen_name) = ?'
    ).bind(handle.toLowerCase()).first();
    if (!blogger) return fail(`归档库中没有 @${handle}`, 404);

    const del = await env.DB.prepare(
      'DELETE FROM favorites WHERE user_id = ? AND blogger_id = ?'
    ).bind(user.id, blogger.id).run();

    const n = await env.DB.prepare('SELECT COUNT(*) c FROM favorites WHERE user_id = ?')
      .bind(user.id).first();
    if (!del.meta?.changes) {
      return ok({ message: `@${blogger.screen_name} 本来就不在你的收藏里`, favorited: false, count: n?.c || 0 });
    }

    // 取消收藏也走同一条引用计数规则：收藏本身算一个引用，
    // 它是最后一个引用时（无人收录、无人收藏）归档数据一并回收，
    // 否则就会留下一条谁也看不见的孤儿行。
    let reclaimed = false;
    const refs = await countRefs(env.DB, blogger.id);
    if (refs.unused) {
      await purgeBlogger(env.DB, blogger.id, {
        media: env.MEDIA, avatarKey: blogger.avatar_key, coverKey: blogger.cover_key,
      });
      reclaimed = true;
    }

    return ok({
      message: reclaimed
        ? `已取消收藏 @${blogger.screen_name}；已无人收录或收藏，归档数据一并回收`
        : `已取消收藏 @${blogger.screen_name}`,
      favorited: false,
      reclaimed,
      count: n?.c || 0,
    });
  } catch (err) {
    return fail(`取消收藏失败: ${err.message}`, 500);
  }
}

async function readHandle(request) {
  try {
    const body = await request.json();
    return String(body?.screen_name || '').trim().replace(/^@/, '');
  } catch {
    return '';
  }
}
