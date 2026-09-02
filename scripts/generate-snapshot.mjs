#!/usr/bin/env node
/**
 * 从 D1 重新生成静态快照 public/data/archive.json。
 *
 * 为什么要有这个快照 (见 _reference/spec/05-sync-pipeline.md §11):
 *   - 公开读走 CDN, D1 读配额消耗为 0
 *   - 后端整个挂掉画廊照常工作 (原站线上就是这个状态: Functions 全没了, 站还能看)
 *   - 代价是数据有延迟, 延迟 = 全量刷新的间隔
 *
 * 用法: node scripts/generate-snapshot.mjs [--local|--remote]
 * 由 .github/workflows/full-sync.yml 在同步结束后调用并提交结果。
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/archive.json');
const target = process.argv.includes('--local') ? '--local' : '--remote';

// 字段顺序与列表内容必须与 GET /api/archive 完全一致 —— 前端两条数据源共用同一套渲染逻辑。
// ⚠️ WHERE 必须和 db.js listAll() 逐字一致。快照是公开读的**首选**来源（CDN 直出，
// 不经 Function），所以这里漏一条过滤 = 线上直接泄露，且 D1 里改了也不会生效：
//   is_blocked = 0   漏了 -> 管理台屏蔽在主页无效
//   EXISTS(public)   漏了 -> 用户的私密档案通过 CDN 公开
const SQL = `SELECT
  id, screen_name, name,
  CASE WHEN avatar_key IS NOT NULL THEN '/api/media?key=' || replace(replace(avatar_key,'/','%2F'),' ','%20')
       ELSE COALESCE(avatar_origin,'') END AS avatar_url,
  CASE WHEN cover_key IS NOT NULL THEN '/api/media?key=' || replace(replace(cover_key,'/','%2F'),' ','%20')
       ELSE COALESCE(cover_origin,'') END AS cover_url,
  followers_count, description, verified, backed_up_at,
  is_blocked, is_suspended,
  clicks_card, clicks_timeline, clicks_roulette,
  (clicks_card + clicks_timeline + clicks_roulette) AS total_clicks,
  last_synced_at
FROM bloggers b
WHERE b.is_blocked = 0
  AND EXISTS (SELECT 1 FROM blogger_owners o WHERE o.blogger_id = b.id AND o.visibility = 'public')
ORDER BY followers_count DESC`;

const raw = execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'x-vault-db', target, '--command', SQL, '--json'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
);

// wrangler 的 --json 输出前可能夹着提示行, 从第一个 [ 开始截
const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
const rows = parsed[0]?.results ?? [];
if (!Array.isArray(rows)) throw new Error('未能从 wrangler 输出中解析出 results');

writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');

const tombstoned = rows.filter((r) => r.is_suspended !== 0).length;
console.log(`已写出 ${OUT}`);
console.log(`  记录数  ${rows.length}`);
console.log(`  墓碑    ${tombstoned} (赛博坟场)`);
console.log(`  蓝标    ${rows.filter((r) => r.verified === 1).length}`);
