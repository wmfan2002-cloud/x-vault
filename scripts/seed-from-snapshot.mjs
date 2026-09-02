#!/usr/bin/env node
/**
 * 把现有 332 条快照灌入 D1。
 *
 * 转换要点 (依据 _reference/spec/04-data-model.md):
 *   - avatar_url 形如 /api/media?key=avatars%2FX_400x400.jpg -> 解出 avatar_key, origin 留空
 *   - avatar_url 形如 https://pbs.twimg.com/...              -> 填 avatar_origin, key 留空
 *   - cover_url 空串 -> NULL
 *   - 丢弃 total_clicks (派生值, 查询时 SUM)
 *
 * 用法: node scripts/seed-from-snapshot.mjs --local | --remote [--file <path>] [--sql-only]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const remote = argv.includes('--remote');
const sqlOnly = argv.includes('--sql-only');
const fileArg = argv.indexOf('--file');
const SRC = fileArg !== -1
  ? resolve(argv[fileArg + 1])
  : resolve(ROOT, 'public/data/archive.json');
const OUT = resolve(ROOT, 'migrations/seed.generated.sql');

const esc = (v) => String(v).replace(/'/g, "''");
/** 可空列: 空串与 undefined 都落 NULL */
const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${esc(v)}'`);
/** NOT NULL 文本列: 空串就是空串, 不能变成 NULL */
const qs = (v) => `'${esc(v ?? '')}'`;
const n = (v) => Number.isFinite(Number(v)) ? String(Math.trunc(Number(v))) : '0';

/** /api/media?key=avatars%2FX.jpg -> avatars/X.jpg ; 远端 URL -> null */
function splitMedia(url) {
  if (!url) return { key: null, origin: null };
  if (url.startsWith('/api/media')) {
    const m = url.match(/[?&]key=([^&]+)/);
    return { key: m ? decodeURIComponent(m[1]) : null, origin: null };
  }
  if (/^https?:\/\//.test(url)) return { key: null, origin: url };
  return { key: null, origin: null };
}

const records = JSON.parse(readFileSync(SRC, 'utf8'));
if (!Array.isArray(records)) throw new Error(`${SRC} 不是 JSON 数组`);

const lines = [
  '-- 由 scripts/seed-from-snapshot.mjs 生成, 不要手改',
  `-- 源: ${SRC}`,
  `-- 记录数: ${records.length}`,
  '',
];

let withKey = 0, withOrigin = 0, noCover = 0, tombstoned = 0;

for (const r of records) {
  const av = splitMedia(r.avatar_url);
  const cv = splitMedia(r.cover_url);
  if (av.key) withKey++;
  if (av.origin) withOrigin++;
  if (!r.cover_url) noCover++;
  if (r.is_suspended) tombstoned++;

  // 幂等: 重复执行不会丢点击计数, 也不会覆盖首次归档时间
  lines.push(
    'INSERT INTO bloggers (id, screen_name, name, description, followers_count, verified, ' +
    'is_suspended, is_blocked, avatar_key, avatar_origin, cover_key, cover_origin, ' +
    'backed_up_at, last_synced_at, clicks_card, clicks_timeline, clicks_roulette) VALUES (' +
    [
      q(r.id), q(r.screen_name), qs(r.name), qs(r.description),
      n(r.followers_count), n(r.verified),
      n(r.is_suspended), n(r.is_blocked),
      q(av.key), q(av.origin), q(cv.key), q(cv.origin),
      q(r.backed_up_at), q(r.last_synced_at),
      n(r.clicks_card), n(r.clicks_timeline), n(r.clicks_roulette),
    ].join(', ') +
    ') ON CONFLICT(id) DO UPDATE SET ' +
    'screen_name=excluded.screen_name, name=excluded.name, description=excluded.description, ' +
    'followers_count=excluded.followers_count, verified=excluded.verified, ' +
    'is_suspended=excluded.is_suspended, is_blocked=excluded.is_blocked, ' +
    'avatar_key=COALESCE(excluded.avatar_key, bloggers.avatar_key), ' +
    'avatar_origin=COALESCE(excluded.avatar_origin, bloggers.avatar_origin), ' +
    'cover_key=COALESCE(excluded.cover_key, bloggers.cover_key), ' +
    'cover_origin=COALESCE(excluded.cover_origin, bloggers.cover_origin), ' +
    'last_synced_at=excluded.last_synced_at;'
  );

  // ⚠️ 归属行必须一起灌。listAll() 要求「至少一条 public 归属」才进公开画廊 ——
  // 只灌 bloggers 的话，数字对了、管理台看得到、画廊却是空的。
  // 快照是公开形状（16 字段），不含归属信息，所以统一挂到站长哨兵账号名下并标 public：
  // 这批本来就是公开画廊里的数据，标 private 反而会让首页突然变空。
  lines.push(
    "INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at) VALUES (" +
    ["'admin-legacy'", q(r.id), "'public'", q(r.backed_up_at)].join(', ') +
    ') ON CONFLICT(user_id, blogger_id) DO NOTHING;'
  );
}

writeFileSync(OUT, lines.join('\n') + '\n');

console.log(`生成 ${OUT}`);
console.log(`  记录数        ${records.length}`);
console.log(`  R2 key 形态   ${withKey}  (图片已不可达, 需重新同步或抢救)`);
console.log(`  原始 twimg    ${withOrigin}  (可用 _reference/recover-media.sh 抢救)`);
console.log(`  无 banner     ${noCover}`);
console.log(`  已墓碑        ${tombstoned}  (is_suspended != 0, 永不删除)`);

if (sqlOnly) process.exit(0);

const target = remote ? '--remote' : '--local';
console.log(`\n执行到 D1 (${target}) ...`);
try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'x-vault-db', target, `--file=${OUT}`, '--yes'],
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('\n完成。');
} catch (err) {
  console.error('\nwrangler 执行失败。可以先建库再重试:');
  console.error('  npm run db:create   # 把返回的 database_id 填进 wrangler.toml');
  console.error(`  npm run db:migrate:local`);
  console.error(`  npx wrangler d1 execute x-vault-db ${target} --file=${OUT}`);
  process.exit(1);
}
