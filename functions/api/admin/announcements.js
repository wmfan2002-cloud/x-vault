/**
 * 公告管理。全部需要管理台会话 —— **发布权限只在管理台**，普通登录用户没有。
 *
 *   GET    /api/admin/announcements                列出全部（含已下线的）
 *   POST   /api/admin/announcements                新建
 *   PATCH  /api/admin/announcements  { id, ... }   改内容 / 上下线 / 置顶
 *   DELETE /api/admin/announcements  { id }        删除
 *
 * ⚠️ body 只存**纯文本**，不允许 HTML。
 * 公告渲染在每个访客的页面上，允许 HTML 就等于给全站开一个存储型 XSS 面：
 * 管理台会话一旦被劫，攻击者不用改代码，发一条公告就能在所有访客浏览器里执行脚本。
 * 服务端这里做长度和字段校验，前端渲染时 escapeHtml —— 两层都不能省。
 */
import { json, ok, fail, nowIso } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

const LEVELS = ['info', 'warn', 'urgent'];
const MAX_TITLE = 80;
const MAX_BODY = 2000;
const MAX_TOTAL = 200;   // 库里最多留这么多条，避免无限堆积

const clean = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();

/**
 * 时间字段归一化。**契约：客户端必须发送带时区的完整 ISO 串。**
 *
 * ⚠️ 这里曾经有一个 8 小时的时区 bug：管理台的 `<input type="datetime-local">`
 * 给出的是 `2026-09-02T20:00`（**本地**时间，不带时区），而这个函数直接在后面
 * 补了 'Z' 当成 UTC 存。站长在 UTC+8 填"晚上 8 点"，实际存成 20:00Z = 本地次日 04:00 ——
 * 偏了 8 小时。`starts_at` 这么存，公告要晚 8 小时才出现，看起来就像"公告消失了"。
 *
 * Workers 跑在 UTC，服务端**无法知道**客户端的时区，所以转换只能在浏览器侧做：
 * 管理台用 `new Date(input.value).toISOString()`（datetime-local 的无时区串
 * 会被 JS 按本地时区解析），再把完整 ISO 发过来。
 *
 * 这里保留对无时区串的兜底（当成 UTC），是给直接调 API 的场景用的 —— 不是给管理台用的。
 */
function normTime(v) {
  const raw = clean(v);
  if (!raw) return null;
  // 带 Z 或 ±HH:MM 偏移 -> 已有时区信息，直接解析
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const d = new Date(hasZone ? raw : raw + (raw.length === 16 ? ':00Z' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  const { results } = await env.DB.prepare(
    // status 把"为什么没在显示"分开算：原来只有一个 live 标志，
    // 界面上"已下线"和"定时还没到"被合并成一句"未到时间/已过期"，
    // 站长看不出该点「重新上线」还是该改时间。
    `SELECT id, title, body, level, pinned, is_active, starts_at, ends_at, created_at, updated_at,
            -- ⚠️ 两边都套 datetime()：ISO 的 'T' 分隔符和 datetime('now') 的空格
            -- 分隔符不可字符串比较，同一天内会把过去判成未来（详见 api/announcements.js 注释）
            CASE
              WHEN is_active = 0 THEN 'offline'
              WHEN starts_at IS NOT NULL AND starts_at != '' AND datetime(starts_at) >  datetime('now') THEN 'scheduled'
              WHEN ends_at   IS NOT NULL AND ends_at   != '' AND datetime(ends_at)   <= datetime('now') THEN 'expired'
              ELSE 'live'
            END AS status,
            CASE WHEN is_active = 1
                  AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now'))
                  AND (ends_at   IS NULL OR ends_at   = '' OR datetime(ends_at)   >  datetime('now'))
                 THEN 1 ELSE 0 END AS live
       FROM announcements
      ORDER BY pinned DESC, created_at DESC`
  ).all();

  return json({ success: true, data: results || [] }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }

  const text = clean(body?.body);
  if (!text) return fail('公告正文不能为空');
  if (text.length > MAX_BODY) return fail(`正文最长 ${MAX_BODY} 字`);
  const title = clean(body?.title).slice(0, MAX_TITLE);
  const level = LEVELS.includes(body?.level) ? body.level : 'info';

  const n = await env.DB.prepare('SELECT COUNT(*) c FROM announcements').first();
  if ((n?.c || 0) >= MAX_TOTAL) return fail(`公告数量已达上限 ${MAX_TOTAL} 条，请先删掉一些旧的`);

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO announcements (id, title, body, level, pinned, is_active, starts_at, ends_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, title, text, level, body?.pinned ? 1 : 0,
         body?.is_active === false ? 0 : 1,
         normTime(body?.starts_at), normTime(body?.ends_at), now, now).run();

  return ok({ id, message: '公告已发布' });
}

export async function onRequestPatch({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }
  const id = String(body?.id || '').trim();
  if (!id) return fail('缺少 id');

  const row = await env.DB.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first();
  if (!row) return fail('公告不存在', 404);

  // action=renotify：只把 updated_at 推到现在，内容一个字不改。
  // 效果是访客的"已收起"记录（key 里带 updated_at）全部失效 -> 这条公告重新出现。
  // 用于"公告很重要，想让已经关掉的人再看一次"，不必靠改一个空格来触发。
  if (body.action === 'renotify') {
    await env.DB.prepare('UPDATE announcements SET updated_at = ? WHERE id = ?')
      .bind(nowIso(), id).run();
    return ok({ message: '已重新提醒：之前关掉这条公告的访客会再看到一次' });
  }

  // action=republish：重新上线 + 清掉定时窗口 + 推 updated_at，一步到位。
  // 「下线很久之后想重新发」时，光点 is_active=1 往往还卡在过期的 ends_at 上。
  if (body.action === 'republish') {
    await env.DB.prepare(
      'UPDATE announcements SET is_active = 1, starts_at = NULL, ends_at = NULL, updated_at = ? WHERE id = ?'
    ).bind(nowIso(), id).run();
    return ok({ message: '已重新上线（定时窗口已清空，立即生效）' });
  }

  const sets = [];
  const bind = [];
  if (body.body !== undefined) {
    const text = clean(body.body);
    if (!text) return fail('公告正文不能为空');
    if (text.length > MAX_BODY) return fail(`正文最长 ${MAX_BODY} 字`);
    sets.push('body = ?'); bind.push(text);
  }
  if (body.title !== undefined) { sets.push('title = ?'); bind.push(clean(body.title).slice(0, MAX_TITLE)); }
  if (body.level !== undefined) {
    if (!LEVELS.includes(body.level)) return fail('level 只能是 info / warn / urgent');
    sets.push('level = ?'); bind.push(body.level);
  }
  if (body.pinned !== undefined)    { sets.push('pinned = ?');    bind.push(body.pinned ? 1 : 0); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); bind.push(body.is_active ? 1 : 0); }
  if (body.starts_at !== undefined) { sets.push('starts_at = ?'); bind.push(normTime(body.starts_at)); }
  if (body.ends_at !== undefined)   { sets.push('ends_at = ?');   bind.push(normTime(body.ends_at)); }
  if (!sets.length) return fail('没有要修改的字段');

  // updated_at 变化会让访客那边"已读关闭"失效并重新显示 —— 改了内容就该重新提醒
  sets.push('updated_at = ?'); bind.push(nowIso());

  await env.DB.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...bind, id).run();

  return ok({ message: '公告已更新' });
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body;
  try { body = await request.json(); } catch { return fail('请求体不是合法 JSON'); }
  const id = String(body?.id || '').trim();
  if (!id) return fail('缺少 id');

  const res = await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  if (!res.meta?.changes) return fail('公告不存在', 404);
  return ok({ message: '公告已删除' });
}
