/**
 * 个人标签 / 文件夹。全部需要登录，全部只作用于**自己**的数据。
 *
 *   GET    /api/tags                                 -> 我的标签 + 每个标签下的数量
 *   POST   /api/tags     { name, color? }            -> 新建
 *   PATCH  /api/tags     { id, name?, color?, sort_order? } -> 改名 / 换色 / 排序
 *   DELETE /api/tags     { id }                      -> 删除（同时解除所有该标签的标注）
 *   PUT    /api/tags     { blogger_id, tag_ids: [] } -> 设置某位博主的**完整**标签集合
 *
 * 为什么 PUT 是"设置完整集合"而不是"加一个/减一个"：
 * 前端的交互是一个多选面板（勾上/取消若干个然后保存），整集覆盖天然幂等，
 * 也不会出现"加成功了但减失败了"的半途状态。逐个加减需要前端自己 diff，
 * 而且并发点击容易产生不一致。
 *
 * ⚠️ 越权防护：所有写入都必须校验 tag 属于当前用户。
 * 只用 tag_id 定位而不带 user_id 的话，任何登录用户都能往别人的标签里塞东西。
 */
import { json, ok, fail, nowIso } from '../_lib/http.js';
import { requireUser } from '../_lib/user-auth.js';

const MAX_TAGS_PER_USER = 100;
const MAX_NAME_LEN = 24;
// 只允许色板里的键名，不接受任意字符串 —— 前端会把它拼进 class/CSS 变量名
const COLORS = ['violet', 'blue', 'cyan', 'green', 'amber', 'rose', 'slate'];

const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.color, t.sort_order, t.created_at,
            (SELECT COUNT(*) FROM blogger_tags bt WHERE bt.tag_id = t.id) AS count
       FROM tags t
      WHERE t.user_id = ?
      ORDER BY t.sort_order ASC, t.created_at ASC`
  ).bind(user.id).all();

  return json({ success: true, data: results || [] }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }

  const name = cleanName(body?.name);
  if (!name) return fail('请填写标签名');
  if (name.length > MAX_NAME_LEN) return fail(`标签名最长 ${MAX_NAME_LEN} 个字`);
  const color = COLORS.includes(body?.color) ? body.color : 'violet';

  const n = await env.DB.prepare('SELECT COUNT(*) c FROM tags WHERE user_id = ?').bind(user.id).first();
  if ((n?.c || 0) >= MAX_TAGS_PER_USER) return fail(`标签数量已达上限 ${MAX_TAGS_PER_USER} 个`);

  const dup = await env.DB.prepare(
    'SELECT id FROM tags WHERE user_id = ? AND LOWER(name) = LOWER(?)'
  ).bind(user.id, name).first();
  if (dup) return fail(`已有同名标签「${name}」`, 409);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO tags (id, user_id, name, color, sort_order, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(id, user.id, name, color, (n?.c || 0), nowIso()).run();

  return ok({ tag: { id, name, color, sort_order: n?.c || 0, count: 0 }, message: `已创建标签「${name}」` });
}

export async function onRequestPatch({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }
  const id = String(body?.id || '').trim();
  if (!id) return fail('缺少 id');

  // ⚠️ 必须带 user_id 定位，否则能改别人的标签
  const row = await env.DB.prepare('SELECT id, name FROM tags WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
  if (!row) return fail('标签不存在', 404);

  const sets = [];
  const bind = [];
  if (body?.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return fail('标签名不能为空');
    if (name.length > MAX_NAME_LEN) return fail(`标签名最长 ${MAX_NAME_LEN} 个字`);
    const dup = await env.DB.prepare(
      'SELECT id FROM tags WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ?'
    ).bind(user.id, name, id).first();
    if (dup) return fail(`已有同名标签「${name}」`, 409);
    sets.push('name = ?'); bind.push(name);
  }
  if (body?.color !== undefined) {
    if (!COLORS.includes(body.color)) return fail('颜色不在可选范围内');
    sets.push('color = ?'); bind.push(body.color);
  }
  if (body?.sort_order !== undefined) {
    sets.push('sort_order = ?'); bind.push(parseInt(body.sort_order, 10) || 0);
  }
  if (!sets.length) return fail('没有要修改的字段');

  await env.DB.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...bind, id, user.id).run();

  return ok({ message: '标签已更新' });
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }
  const id = String(body?.id || '').trim();
  if (!id) return fail('缺少 id');

  const row = await env.DB.prepare('SELECT name FROM tags WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
  if (!row) return fail('标签不存在', 404);

  // blogger_tags 有 ON DELETE CASCADE，但 **D1 默认不强制外键**，必须显式删
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blogger_tags WHERE tag_id = ?').bind(id),
    env.DB.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').bind(id, user.id),
  ]);

  return ok({ message: `已删除标签「${row.name}」（博主档案本身不受影响）` });
}

/** 设置某位博主的完整标签集合 */
export async function onRequestPut({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }

  const bloggerId = String(body?.blogger_id || '').trim();
  if (!bloggerId) return fail('缺少 blogger_id');
  const wanted = Array.isArray(body?.tag_ids)
    ? [...new Set(body.tag_ids.map((x) => String(x)))]
    : [];

  const exists = await env.DB.prepare('SELECT 1 FROM bloggers WHERE id = ?').bind(bloggerId).first();
  if (!exists) return fail('博主档案不存在', 404);

  // ⚠️ 只接受**属于自己**的标签 id。不校验的话，传别人的 tag_id 就能往对方标签里塞人。
  let valid = [];
  if (wanted.length) {
    const ph = wanted.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id FROM tags WHERE user_id = ? AND id IN (${ph})`
    ).bind(user.id, ...wanted).all();
    valid = (results || []).map((r) => r.id);
  }
  const rejected = wanted.length - valid.length;

  const now = nowIso();
  const stmts = [
    // 整集覆盖：先清掉这位博主在**我的**标签下的全部标注
    env.DB.prepare(
      'DELETE FROM blogger_tags WHERE user_id = ? AND blogger_id = ?'
    ).bind(user.id, bloggerId),
    ...valid.map((tid) => env.DB.prepare(
      `INSERT INTO blogger_tags (user_id, tag_id, blogger_id, created_at)
       VALUES (?,?,?,?) ON CONFLICT(tag_id, blogger_id) DO NOTHING`
    ).bind(user.id, tid, bloggerId, now)),
  ];
  // batch 是单事务：不会出现"删掉了旧的但没写上新的"
  await env.DB.batch(stmts);

  return ok({
    blogger_id: bloggerId,
    tag_ids: valid,
    message: valid.length ? `已归入 ${valid.length} 个标签` : '已清空该博主的标签',
    ...(rejected ? { warning: `${rejected} 个标签 id 无效或不属于你，已忽略` } : {}),
  });
}
