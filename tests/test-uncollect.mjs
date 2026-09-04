/**
 * 取消收录 / 引用计数回收 的语义测试（离线，不起 wrangler）。
 *
 *   node tests/test-uncollect.mjs
 *
 * 做法：node:sqlite 建内存库 -> 跑全部 migrations -> 用一个 ~60 行的 D1 shim
 * 把真实 handler（my-bloggers.js / favorites.js / admin/blogger.js）和 db.js
 * 直接跑起来。不 mock 业务代码，只 mock 数据库驱动与 R2。
 *
 * 覆盖的核心语义（对应需求"每个相同 ID 的博主共用一份数据 + 指针"）：
 *   1. 个人取消收录只删自己的指针，公开仓（admin-legacy）的指针不动
 *   2. 引用归零（无归属、无收藏）时归档数据连同时间线/快照/标签/R2 媒体一并回收
 *   3. "admin 上传的只能 admin 删" = admin 指针本身是一个引用，别人删不掉
 *   4. 收藏也算引用；取消收藏是最后一个引用时同样回收
 *   5. 用户自己的标签：还收藏着就留，不收藏了就清；GC 时所有人的标签一起清（无孤儿）
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

import { listAll, countRefs, ADMIN_OWNER } from '../functions/_lib/db.js';
import { onRequestDelete as myDelete } from '../functions/api/my-bloggers.js';
import { onRequestDelete as favDelete } from '../functions/api/favorites.js';
import { onRequestDelete as admDelete } from '../functions/api/admin/blogger.js';
import { createUserSession } from '../functions/_lib/user-auth.js';

// ── D1 shim ──────────────────────────────────────────────────
class Stmt {
  constructor(sqlite, sql) { this.sqlite = sqlite; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  run() {
    const info = this.sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: info.changes ?? 0 }, success: true };
  }
  first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.args) }; }
}
class D1Shim {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Stmt(this.sqlite, sql); }
  async batch(stmts) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.run());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
}

// ── 建库 + migrations ────────────────────────────────────────
const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync(path.join(ROOT, 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  sqlite.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
}

const r2Deleted = [];
const MEDIA = { delete: async (key) => { r2Deleted.push(key); } };
const env = { DB: new D1Shim(sqlite), MEDIA };

// ── 断言小工具 ───────────────────────────────────────────────
let pass = 0, failCount = 0;
const fails = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { failCount++; fails.push(label); console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
}
const q1 = (sql, ...args) => sqlite.prepare(sql).get(...args);

// ── 造数据 ───────────────────────────────────────────────────
const NOW = new Date().toISOString();
const mkUser = (id, email) => sqlite.prepare(
  `INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at)
   VALUES (?,?, '!', ?, 'user', 1, ?)`
).run(id, email, email.split('@')[0], NOW);
const U1 = 'u1-aaaa', U2 = 'u2-bbbb';
mkUser(U1, 'u1@test.dev'); mkUser(U2, 'u2@test.dev');

const mkBlogger = (id, handle, { avatar = null, cover = null } = {}) => sqlite.prepare(
  `INSERT INTO bloggers (id, screen_name, name, followers_count, is_suspended, is_blocked,
     avatar_key, avatar_origin, cover_key, cover_origin, backed_up_at, clicks_card, clicks_timeline, clicks_roulette)
   VALUES (?,?,?,1000,0,0,?,NULL,?,NULL,?,1,2,3)`
).run(id, handle, handle, avatar, cover, NOW);

const own = (uid, bid, vis) => sqlite.prepare(
  `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at) VALUES (?,?,?,?)`
).run(uid, bid, vis, NOW);
const fav = (uid, bid) => sqlite.prepare(
  `INSERT INTO favorites (user_id, blogger_id, created_at) VALUES (?,?,?)`
).run(uid, bid, NOW);
const tag = (uid, tagId, bid, name) => {
  sqlite.prepare(`INSERT INTO tags (id, user_id, name, color, sort_order, created_at) VALUES (?,?,?,'violet',0,?)`)
    .run(tagId, uid, name, NOW);
  sqlite.prepare(`INSERT INTO blogger_tags (user_id, tag_id, blogger_id, created_at) VALUES (?,?,?,?)`)
    .run(uid, tagId, bid, NOW);
};
const mkHistory = (bid, handle) => sqlite.prepare(
  `INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at)
   VALUES (?,?, 'followers_count', '1', '2', ?)`
).run(bid, handle, NOW);
const mkSnapshot = (bid) => sqlite.prepare(
  `INSERT INTO follower_snapshots (blogger_id, followers_count, captured_at) VALUES (?,?,?)`
).run(bid, 1000, NOW);

// 6 条测试档案 + 完整附属数据
mkBlogger('b-pub', 'pubblogger', { avatar: 'avatars/b-pub.jpg', cover: 'covers/b-pub.jpg' });
mkHistory('b-pub', 'pubblogger'); mkSnapshot('b-pub');
own(ADMIN_OWNER, 'b-pub', 'public');
own(U1, 'b-pub', 'public');  // U1 也收录了它 —— 测"个人走人，公开仓不动"

mkBlogger('b-solo', 'soloblogger', { avatar: 'avatars/b-solo.jpg' });
mkHistory('b-solo', 'soloblogger'); mkSnapshot('b-solo');
own(U1, 'b-solo', 'public');
// 投稿日志：回收时**不能删行**（它同时是限流与冷却的依据），只该把 blogger_id 断开
sqlite.prepare(
  `INSERT INTO submissions (screen_name, status, reason, blogger_id, ip_hash, created_at)
   VALUES ('soloblogger', 'accepted', NULL, 'b-solo', 'ab12cd34', ?)`
).run(NOW);

mkBlogger('b-fav', 'favblogger', { avatar: 'avatars/b-fav.jpg', cover: 'covers/b-fav.jpg' });
own(U1, 'b-fav', 'public'); fav(U2, 'b-fav'); tag(U2, 't-u2-fav', 'b-fav', 'U2的标签');

mkBlogger('b-ownfav', 'ownfavblogger');
own(U1, 'b-ownfav', 'private'); fav(U1, 'b-ownfav'); tag(U1, 't-u1-ownfav', 'b-ownfav', 'U1的标签');

mkBlogger('b-two', 'twoblogger', { avatar: 'avatars/b-two.jpg' });
own(U1, 'b-two', 'public'); own(U2, 'b-two', 'private'); tag(U2, 't-u2-two', 'b-two', 'U2的另一个标签');

mkBlogger('b-adm', 'admonly', { avatar: 'avatars/b-adm.jpg', cover: 'covers/b-adm.jpg' });
own(ADMIN_OWNER, 'b-adm', 'public');

// ── 会话 ─────────────────────────────────────────────────────
const tok1 = await createUserSession(env, U1);
const tok2 = await createUserSession(env, U2);
const adminTok = 'admin-test-token-' + Date.now();
sqlite.prepare(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?,?,?)`)
  .run(createHash('sha256').update(adminTok).digest('hex'), NOW, new Date(Date.now() + 3600e3).toISOString());

const req = (method, path, body, token) => new Request(`http://localhost${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { 'x-user-token': token, 'x-admin-token': token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const j = async (r) => ({ status: r.status, ...(await r.json()) });

// ══ 1. 公开仓保护：个人取消收录，admin-legacy 的指针与画廊完好 ══
console.log('\n[1] 个人取消收录不碰公开仓');
let r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'pubblogger' }, tok1), env }));
eq(r.success, true, 'DELETE 成功');
eq(r.reclaimed_count, 0, '没有回收（公开仓还引用着）');
eq(r.kept?.[0]?.reason, 'kept_admin', '保留原因 = kept_admin');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='b-pub'`).n, 1, 'bloggers 行还在');
eq(q1(`SELECT COUNT(*) n FROM blogger_owners WHERE blogger_id='b-pub' AND user_id='${ADMIN_OWNER}'`).n, 1, '公开仓指针还在');
eq(q1(`SELECT COUNT(*) n FROM blogger_history WHERE blogger_id='b-pub'`).n, 1, '时间线还在');
eq((await listAll(env.DB)).some((x) => x.id === 'b-pub'), true, '公开画廊仍含 b-pub');
eq(q1(`SELECT COUNT(*) n FROM blogger_owners WHERE blogger_id='b-pub' AND user_id='${U1}'`).n, 0, '我的指针已删');

// ══ 2. 引用归零：整份归档数据 + R2 媒体一并回收 ══
console.log('\n[2] 无人引用时回收全部数据');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'soloblogger' }, tok1), env }));
eq(r.reclaimed, ['soloblogger'], '标记为已回收');
for (const [t, where] of [['bloggers', 'id'], ['blogger_owners', 'blogger_id'], ['blogger_history', 'blogger_id'], ['follower_snapshots', 'blogger_id'], ['blogger_tags', 'blogger_id'], ['favorites', 'blogger_id']]) {
  eq(q1(`SELECT COUNT(*) n FROM ${t} WHERE ${where}='b-solo'`).n, 0, `${t} 无残留`);
}
eq(r2Deleted.includes('avatars/b-solo.jpg'), true, 'R2 头像已删');
// submissions 是唯一"留行只断指针"的表：删行等于把限流窗口清零，谁都能借回收绕过冷却
const sub = q1(`SELECT status, ip_hash, created_at, blogger_id FROM submissions WHERE screen_name='soloblogger'`);
eq(!!sub, true, '投稿日志行保留（限流依据不能被回收清掉）');
eq(sub.blogger_id, null, '悬空的 blogger_id 已置空');
eq([sub.status, sub.ip_hash, sub.created_at], ['accepted', 'ab12cd34', NOW], '其余字段未被改动');
eq((await countRefs(env.DB, 'b-solo')).unused, true, '只剩一条投稿记录 -> 仍算无人引用（投稿是事件，不是持有者）');

// ══ 3. 收藏也算引用；最后一个引用消失才回收 ══
console.log('\n[3] 收藏是引用：还有人收藏就留');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'favblogger' }, tok1), env }));
eq(r.kept?.[0]?.reason, 'kept_favorites', '保留原因 = kept_favorites');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='b-fav'`).n, 1, '数据还在');
eq(q1(`SELECT COUNT(*) n FROM blogger_tags WHERE blogger_id='b-fav'`).n, 1, 'U2 的标签不受影响');
r = await j(await favDelete({ request: req('DELETE', '/api/favorites', { screen_name: 'favblogger' }, tok2), env }));
eq(r.reclaimed, true, '取消收藏后回收');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='b-fav'`).n, 0, '数据已回收');
eq(q1(`SELECT COUNT(*) n FROM blogger_tags WHERE blogger_id='b-fav'`).n, 0, 'U2 的标签一并清掉（无孤儿）');
eq(r2Deleted.includes('avatars/b-fav.jpg') && r2Deleted.includes('covers/b-fav.jpg'), true, 'R2 头像+banner 已删');

// ══ 4. 自己"既收录又收藏"：先解除收录 -> 标签因还收藏着而保留；再取消收藏 -> 回收 ══
console.log('\n[4] 还收藏着 -> 用户的标签保留');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'ownfavblogger' }, tok1), env }));
eq(r.kept?.[0]?.reason, 'kept_favorites', '保留原因 = kept_favorites（自己收藏着）');
eq(q1(`SELECT COUNT(*) n FROM blogger_tags WHERE blogger_id='b-ownfav'`).n, 1, '自己的标签保留');
r = await j(await favDelete({ request: req('DELETE', '/api/favorites', { screen_name: 'ownfavblogger' }, tok1), env }));
eq(r.reclaimed, true, '取消收藏后回收');
eq(q1(`SELECT COUNT(*) n FROM blogger_tags WHERE blogger_id='b-ownfav'`).n, 0, '标签随后一并清掉');

// ══ 5. 两个人都收录：走一个留一个，最后一个走时才回收 ══
console.log('\n[5] 多人共用：引用计数递减');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'twoblogger' }, tok1), env }));
eq(r.kept?.[0]?.reason, 'kept_owners', '保留原因 = kept_owners');
eq(q1(`SELECT COUNT(*) n FROM blogger_tags WHERE blogger_id='b-two'`).n, 1, 'U2 的标签还在');
eq((await listAll(env.DB)).some((x) => x.id === 'b-two'), false, 'U1 公开指针没了 -> 退出画廊（U2 是私密）');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'twoblogger' }, tok2), env }));
eq(r.reclaimed, ['twoblogger'], '最后一个也走 -> 回收');
eq(q1(`SELECT COUNT(*) n FROM blogger_tags WHERE blogger_id='b-two'`).n, 0, 'U2 的标签一并清掉');
eq(r2Deleted.includes('avatars/b-two.jpg'), true, 'R2 已删');

// ══ 6. admin 侧：release 模式 = 撤出公开仓；没人引用时要确认短语 ══
console.log('\n[6] admin release / purge');
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'admonly', mode: 'release' }, adminTok), env }));
eq(r.status, 428, '撤出后无人引用 -> 428 要确认短语');
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'admonly', mode: 'release', confirm: 'DELETE' }, adminTok), env }));
eq(r.success, true, '带确认短语 -> 成功');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='b-adm'`).n, 0, '数据一并回收');
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'pubblogger', mode: 'release' }, adminTok), env }));
eq(r.status, 428, '撤出 pub 后无人引用 -> 428 要确认短语');
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'pubblogger', mode: 'release', confirm: 'DELETE' }, adminTok), env }));
eq(r.success, true, '带确认短语 -> 撤出成功');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='b-pub'`).n, 0, '撤出后无人引用 -> 归档数据一并回收');
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'pubblogger', mode: 'release', confirm: 'DELETE' }, adminTok), env }));
eq(r.status, 404, '已回收的再删 -> 404');
// purge 保护：还有别人收录时必须 force
mkBlogger('b-purge', 'purgeme'); own(U1, 'b-purge', 'private');
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'purgeme', confirm: 'DELETE' }, adminTok), env }));
eq(r.status, 409, 'purge 撞上他人收录 -> 409 挡住（公开仓并没收录它，admin 只能 force 或让用户自己删）');
eq(r.success, false, '不放行');
// 409 要带结构化字段，否则管理台只能把开发者文案原样弹给站长，给不出下一步
eq(r.code, 'others_own', '409 带机器可判的 code');
eq([r.others, r.favorites], [1, 0], '409 报出杀伤半径（他人收录 1 / 收藏 0）');
eq(r.refs?.owners, 1, '409 附带完整引用计数');
// force 分支：确实要连带删（违规内容）时必须真的删掉别人的收录
r = await j(await admDelete({ request: req('DELETE', '/api/admin/blogger', { screen_name: 'purgeme', confirm: 'DELETE', force: true }, adminTok), env }));
eq(r.success, true, 'force:true -> 放行');
eq(r.deleted?.owners_removed, 1, '回报连带移除的收录数');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='b-purge'`).n, 0, '共享数据已删');
eq(q1(`SELECT COUNT(*) n FROM blogger_owners WHERE blogger_id='b-purge'`).n, 0, '他人的收录指针也一并清掉（force 的语义）');

// ══ 7. 错误路径 ══
console.log('\n[7] 错误路径');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'nobody' }, tok1), env }));
eq(r.status, 404, '没收录的 handle -> 404');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_names: ['pubblogger', 'nobody'] }, tok1), env }));
eq(r.status, 404, '批量里没有一个命中 -> 404');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', undefined, tok1), env }));
eq(r.status, 400, '缺参数 -> 400');
r = await j(await myDelete({ request: new Request('http://localhost/api/my-bloggers', { method: 'DELETE', body: '{bad', headers: { 'content-type': 'application/json', 'x-user-token': tok1 } }), env }));
eq(r.status, 400, '非法 JSON -> 400');
r = await j(await myDelete({ request: req('DELETE', '/api/my-bloggers', { screen_name: 'x' }), env }));
eq(r.status, 401, '未登录 -> 401');
eq(await countRefs(env.DB, 'b-solo').then((x) => x.unused), true, 'countRefs 对已回收的行报 unused');

// ── 收尾 ─────────────────────────────────────────────────────
console.log(`\n════════ ${pass} 通过 / ${failCount} 失败 ════════`);
if (failCount) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
