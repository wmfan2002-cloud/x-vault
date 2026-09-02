/**
 * 取消收录的端到端测试：打真服务（wrangler pages dev，127.0.0.1:8788），
 * 数据直接落到本地 D1 文件（WAL 模式允许并发短写）。
 *
 *   node tests/e2e-uncollect.mjs
 *
 * 造一个专用测试用户（随机 id），测完连人带会话一起删掉，真实数据零改动。
 * 两条 GC 案例用的是新造的假博主（e2egc- 前缀），回收由被测端点自己完成。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8788';
const DB_FILE = (() => {
  const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  return dir + '/' + readdirSync(dir).find((f) => /^[0-9a-f]{64}\.sqlite$/.test(f));
})();

let pass = 0, failCount = 0;
const fails = [];
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { failCount++; fails.push(label); console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
};

const raw = new DatabaseSync(DB_FILE);
const q1 = (sql, ...args) => raw.prepare(sql).get(...args);
const run = (sql, ...args) => raw.prepare(sql).run(...args);

// ── 造测试用户 + 会话（token 走 x-user-token 头，requireUser 同时认 cookie 和这个头）──
const uid = 'e2e-uncollect-' + Date.now();
const token = 'e2etok-' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
const tokenHash = createHash('sha256').update(token).digest('hex');
run(`INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at) VALUES (?, ?, '!', 'e2e', 'user', 1, ?)`,
  uid, uid + '@e2e.invalid', new Date().toISOString());
run(`INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)`,
  tokenHash, uid, new Date().toISOString(), new Date(Date.now() + 3600e3).toISOString());
console.log(`测试用户 ${uid} 已建（含会话）\n`);

const cleanup = () => {
  try {
    run('DELETE FROM user_sessions WHERE user_id = ?', uid);
    run('DELETE FROM favorites WHERE user_id = ?', uid);
    run('DELETE FROM blogger_owners WHERE user_id = ?', uid);
    run('DELETE FROM users WHERE id = ?', uid);
    console.log('\n清理完成：测试用户/会话/归属/收藏已删');
  } catch (e) { console.log('清理失败（手动检查 ' + uid + '）:', e.message); }
};
process.on('exit', cleanup);

const api = async (method, path, body, tok = token) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { 'x-user-token': tok } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

const before = q1('SELECT COUNT(*) n FROM bloggers').n;
const archiveNow = async () => (await (await fetch(BASE + '/api/archive?_=' + Date.now())).json());

// ── 场景 A：公开仓也在收录的博主 —— 个人取消收录，公开仓安然无恙 ──
console.log('[A] 公开仓保护（真实画廊数据）');
const gallery = await archiveNow();
const target = gallery.data[0];   // 画廊里的都至少有一条 public 归属
eq(await api('GET', '/api/my-bloggers').then((r) => r.success), true, '测试用户会话有效（GET my-bloggers 成功）');
const addA = run('INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at) VALUES (?,?,?,?)',
  uid, target.id, 'public', new Date().toISOString());
eq(addA.changes, 1, `已把 @${target.screen_name} 收录到测试用户名下（模拟此前同步/投稿）`);
let r = await api('DELETE', '/api/my-bloggers', { screen_name: target.screen_name });
eq(r.success, true, '取消收录成功');
eq(r.reclaimed_count, 0, '没有回收（公开仓还引用着）');
eq(r.kept?.[0]?.reason, 'kept_admin', '保留原因 = kept_admin（公开仓指针还在）');
eq(q1('SELECT COUNT(*) n FROM bloggers WHERE id = ?', target.id).n, 1, 'bloggers 行完好');
const galleryAfterA = await archiveNow();
eq(galleryAfterA.data.some((x) => x.id === target.id), true, '公开画廊仍能看到它');
eq(q1('SELECT COUNT(*) n FROM bloggers').n, before, '全库条数不变');

// ── 场景 B：只有测试用户收录的假博主 —— 取消收录 -> 整份归档数据回收 ──
console.log('\n[B] 引用归零 -> 数据回收（假博主，回收即清理）');
const now = new Date().toISOString();
run(`INSERT INTO bloggers (id, screen_name, name, followers_count, is_suspended, is_blocked,
      avatar_key, backed_up_at, clicks_card, clicks_timeline, clicks_roulette)
     VALUES ('e2egc-b1', 'e2egcb1', 'E2E回收案例', 10, 0, 0, 'avatars/e2egc-b1.jpg', ?, 5, 0, 0)`, now);
run(`INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at) VALUES (?,?, 'public', ?)`, uid, 'e2egc-b1', now);
run(`INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at) VALUES ('e2egc-b1','e2egcb1','name','','E2E回收案例',?)`, now);
run(`INSERT INTO follower_snapshots (blogger_id, followers_count, captured_at) VALUES ('e2egc-b1', 10, ?)`, now);
r = await api('DELETE', '/api/my-bloggers', { screen_name: 'e2egcb1' });
eq(r.success, true, '取消收录成功');
eq(r.reclaimed, ['e2egcb1'], '归档数据已回收');
for (const t of ['bloggers', 'blogger_owners', 'blogger_history', 'follower_snapshots', 'blogger_tags']) {
  eq(q1(`SELECT COUNT(*) n FROM ${t} WHERE ${t === 'bloggers' ? 'id' : 'blogger_id'}='e2egc-b1'`).n, 0, `${t} 无残留`);
}
eq(q1('SELECT COUNT(*) n FROM bloggers').n, before, '全库条数回到基线');

// ── 场景 C：只被收藏的博主 —— 取消收藏是最后一个引用 -> 回收 ──
console.log('\n[C] 收藏是引用（假博主）');
run(`INSERT INTO bloggers (id, screen_name, name, followers_count, is_suspended, is_blocked, backed_up_at)
     VALUES ('e2egc-c1', 'e2egcc1', 'E2E收藏案例', 10, 0, 0, ?)`, now);
r = await api('POST', '/api/favorites', { screen_name: 'e2egcc1' });
eq(r.success, true, '收藏成功');
r = await api('DELETE', '/api/my-bloggers', { screen_name: 'e2egcc1' });
eq(r.status, 404, '没收录过 -> 取消收录 404（收藏不等于收录）');
r = await api('DELETE', '/api/favorites', { screen_name: 'e2egcc1' });
eq(r.success && r.reclaimed, true, '取消收藏 -> 引用归零 -> 回收');
eq(q1(`SELECT COUNT(*) n FROM bloggers WHERE id='e2egc-c1'`).n, 0, '数据已回收');
eq(q1('SELECT COUNT(*) n FROM bloggers').n, before, '全库条数回到基线');

// ── 场景 D：批量 + 权限边界 ──
console.log('\n[D] 批量与边界');
run(`INSERT INTO bloggers (id, screen_name, name, followers_count, is_suspended, is_blocked, backed_up_at)
     VALUES ('e2egc-d1', 'e2egcd1', 'E2E批量1', 10, 0, 0, ?)`, now);
run(`INSERT INTO bloggers (id, screen_name, name, followers_count, is_suspended, is_blocked, backed_up_at)
     VALUES ('e2egc-d2', 'e2egcd2', 'E2E批量2', 10, 0, 0, ?)`, now);
run(`INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at) VALUES (?,?, 'private', ?)`, uid, 'e2egc-d1', now);
run(`INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at) VALUES (?,?, 'private', ?)`, uid, 'e2egc-d2', now);
r = await api('DELETE', '/api/my-bloggers', { screen_names: ['e2egcd1', 'e2egcd2', 'ghost-handle'] });
eq(r.released_count, 2, '批量：2 条解除');
eq(r.reclaimed_count, 2, '批量：2 条无人引用被回收');
eq(r.missing, ['ghost-handle'], '没收录的进 missing 列表');
r = await api('DELETE', '/api/my-bloggers', { screen_name: target.screen_name });
eq(r.status, 404, '没收录的 -> 404');
r = await fetch(BASE + '/api/my-bloggers', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }).then(async (x) => ({ status: x.status, ...(await x.json()) }));
eq(r.status, 401, '未登录 -> 401');
eq(q1('SELECT COUNT(*) n FROM bloggers').n, before, '最终全库条数 = 基线（真实数据零改动）');

console.log(`\n════════ ${pass} 通过 / ${failCount} 失败 ════════`);
if (failCount) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
