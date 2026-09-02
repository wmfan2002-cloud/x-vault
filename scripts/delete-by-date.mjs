#!/usr/bin/env node
/**
 * 按归档日期批量彻底删除博主档案。
 *
 * 用法:
 *   node scripts/delete-by-date.mjs 2026-09-02 --dry-run     只看会删什么
 *   node scripts/delete-by-date.mjs 2026-09-02 --confirm      真删
 *
 * 为什么不用 DELETE /api/admin/blogger 循环 375 次:
 *   · 那个端点一次一条, 375 个 HTTP 往返太慢
 *   · 它需要 admin 会话, 而脚本跑在本机, 直接操作 D1 更直接
 *   · 需要在删之前把整批导出成可恢复的 JSON —— 端点做不到
 *
 * 删除范围 (五张表, D1 默认不强制外键所以逐张显式删):
 *   bloggers · blogger_history · follower_snapshots · blogger_owners · favorites · blogger_tags
 * R2 里的头像/封面**不删** —— 见文件末尾说明。
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const D1_DIR = resolve(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');

const date = process.argv[2];
const confirmed = process.argv.includes('--confirm');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
  console.error('用法: node scripts/delete-by-date.mjs YYYY-MM-DD [--confirm]');
  process.exit(1);
}

const file = readdirSync(D1_DIR).find((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'));
if (!file) { console.error('找不到本地 D1 文件'); process.exit(1); }
const db = new DatabaseSync(resolve(D1_DIR, file));

const rows = db.prepare(
  "SELECT * FROM bloggers WHERE substr(backed_up_at,1,10) = ?"
).all(date);

if (!rows.length) { console.log(`${date} 没有归档记录，什么都没做`); process.exit(0); }

const ids = rows.map((r) => r.id);
const ph = ids.map(() => '?').join(',');
const grab = (sql) => db.prepare(sql).all(...ids);

const bundle = {
  exported_at: new Date().toISOString(),
  criterion: `substr(backed_up_at,1,10) = '${date}'`,
  bloggers: rows,
  blogger_history: grab(`SELECT * FROM blogger_history WHERE blogger_id IN (${ph})`),
  follower_snapshots: grab(`SELECT * FROM follower_snapshots WHERE blogger_id IN (${ph})`),
  blogger_owners: grab(`SELECT * FROM blogger_owners WHERE blogger_id IN (${ph})`),
  favorites: grab(`SELECT * FROM favorites WHERE blogger_id IN (${ph})`),
  blogger_tags: grab(`SELECT * FROM blogger_tags WHERE blogger_id IN (${ph})`),
};

console.log(`\n${date} 归档的记录：`);
console.log(`  bloggers            ${bundle.bloggers.length}`);
console.log(`  blogger_history     ${bundle.blogger_history.length}`);
console.log(`  follower_snapshots  ${bundle.follower_snapshots.length}`);
console.log(`  blogger_owners      ${bundle.blogger_owners.length}`);
console.log(`  favorites           ${bundle.favorites.length}`);
console.log(`  blogger_tags        ${bundle.blogger_tags.length}`);
console.log(`  点击数合计          ${rows.reduce((a, r) => a + r.clicks_card + r.clicks_timeline + r.clicks_roulette, 0)}`);
console.log(`  R2 头像 / 封面      ${rows.filter((r) => r.avatar_key).length} / ${rows.filter((r) => r.cover_key).length}`);

const out = resolve(ROOT, `backups/deleted-${date}-${Date.now()}.json`);
writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n');
console.log(`\n备份已写出: ${out}`);

if (!confirmed) {
  console.log('\n这是预演（--dry-run）。真要删加 --confirm。');
  process.exit(0);
}

// 单事务：中途失败整批回滚，不会留下删一半的状态
db.exec('BEGIN');
try {
  for (const t of ['blogger_history', 'follower_snapshots', 'blogger_owners', 'favorites', 'blogger_tags']) {
    db.prepare(`DELETE FROM ${t} WHERE blogger_id IN (${ph})`).run(...ids);
  }
  db.prepare(`DELETE FROM bloggers WHERE id IN (${ph})`).run(...ids);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('删除失败，已回滚:', err.message);
  process.exit(1);
}

console.log(`\n已删除 ${ids.length} 条档案及其关联数据。`);
console.log(`剩余 bloggers: ${db.prepare('SELECT COUNT(*) n FROM bloggers').get().n}`);
console.log(`孤儿归属行:    ${db.prepare('SELECT COUNT(*) n FROM blogger_owners o WHERE NOT EXISTS (SELECT 1 FROM bloggers b WHERE b.id=o.blogger_id)').get().n}`);
console.log('\n下一步: node scripts/generate-snapshot.mjs --local  重新生成公开快照');

// R2 里的图故意留着：
//   · 备份 JSON 里存了 avatar_key / cover_key，所以恢复时图还能对上
//   · 站长说了之后要用自己的号重新同步这批人。upsert 时 avatar_origin 没变就不会重下，
//     留着这些对象等于省掉几百次下载
//   · 真要清，本地是 .wrangler/state 下的目录，删了也就回收点磁盘
