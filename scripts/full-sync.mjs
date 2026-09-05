#!/usr/bin/env node
/**
 * 全量数据深度刷新 —— 在 GitHub Actions 上跑（见 .github/workflows/full-sync.yml）。
 *
 * 为什么不在 Worker 里跑：332 人 × (查询 + 两张图) 远超 Workers 的 CPU/时长限额，
 * 且需要 cron 与密钥托管。
 *
 * 与边缘增量同步的分工：
 *   增量 (POST /api/sync-following) 只发现**新增关注**，连续 3 个已知即停
 *   全量 (本脚本)                   遍历全部在库博主，发现改名/换图/封号，写 history
 * 两者是配套的，缺了全量就永远发现不了资料变化。
 *
 * 用法: node scripts/full-sync.mjs [--mode=full|tombstone-only|media-only] [--local] [--limit=N]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iterateFollowing, verifyCredentials, discoverQueryId, lookupUserByHandle } from '../functions/_lib/x-provider/graphql.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const MODE = arg('mode', 'full');
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const TARGET = argv.includes('--local') ? '--local' : '--remote';
const DB = 'x-vault-db';
const BUCKET = 'x-vault-media';

const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const sq = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// queryId 缓存落到本地文件即可 —— Actions runner 是一次性的，但同一次运行内可复用
const CACHE = resolve(ROOT, '.wrangler/full-sync-cache.json');
const store = {
  get(k) {
    if (!existsSync(CACHE)) return null;
    try { return JSON.parse(readFileSync(CACHE, 'utf8'))[k] ?? null; } catch { return null; }
  },
  set(k, v) {
    mkdirSync(dirname(CACHE), { recursive: true });
    let all = {};
    if (existsSync(CACHE)) { try { all = JSON.parse(readFileSync(CACHE, 'utf8')); } catch {} }
    all[k] = v;
    writeFileSync(CACHE, JSON.stringify(all));
  },
};

// ── D1 / R2 访问：走 wrangler CLI，避免自己实现 Cloudflare API 签名 ──────────

function d1(sql) {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, TARGET, '--command', sql, '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  );
  const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
  return parsed[0]?.results ?? [];
}

function d1Batch(statements) {
  if (!statements.length) return;
  const file = resolve(ROOT, '.wrangler/full-sync-batch.sql');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, statements.join('\n'));
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB, TARGET, `--file=${file}`, '--yes'],
    { cwd: ROOT, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
}

async function r2Put(key, bytes, contentType) {
  const tmp = resolve(ROOT, '.wrangler/tmp-media');
  mkdirSync(tmp, { recursive: true });
  const file = resolve(tmp, key.replace(/[/]/g, '_'));
  writeFileSync(file, bytes);
  const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
    `--file=${file}`, `--content-type=${contentType}`];
  if (TARGET === '--local') args.push('--local');
  else args.push('--remote');
  execFileSync('npx', args, { cwd: ROOT, stdio: 'pipe' });
}

async function sha16(bytes) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** 抓一张图并归档。失败返回 null —— 单张图失败绝不中断整批 */
async function archiveMedia(prefix, xId, url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: 'image/*' } });
    if (!res.ok) { log(`[WARN] 取图 ${res.status}: ${url}`); return null; }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) return null;
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const key = `${prefix}/${xId}/${await sha16(bytes)}.${ct.includes('png') ? 'png' : 'jpg'}`;
    await r2Put(key, bytes, ct);
    log(`[R2] ${key} (${bytes.length}B)`);
    return key;
  } catch (err) {
    log(`[WARN] 归档媒体异常: ${err.message}`);
    return null;
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────

const TRACKED = [
  ['name', 'name'],
  ['screen_name', 'screen_name'],
  ['description', 'description'],
  ['avatar_origin', 'avatar_url'],
  ['cover_origin', 'cover_url'],
];

const creds = { ct0: process.env.X_CT0, authToken: process.env.X_AUTH_TOKEN };
if (!creds.ct0 || !creds.authToken) {
  console.error('缺少 X_CT0 / X_AUTH_TOKEN');
  process.exit(1);
}
const env = { store };

log(`[CONFIG] mode=${MODE} target=${TARGET}${LIMIT ? ` limit=${LIMIT}` : ''}`);

const me = await verifyCredentials(creds, env);
log(`[CONFIG] 已登录 @${me.screen_name} (id ${me.id})`);
log(`[CONFIG] Following queryId = ${await discoverQueryId(env)}`);

// 当前库内状态，用于 diff
const existing = new Map(
  d1(`SELECT id, screen_name, name, description, followers_count, verified,
             is_suspended, avatar_key, avatar_origin, cover_key, cover_origin
      FROM bloggers`).map((r) => [r.id, r])
);
log(`[CONFIG] 库中现有 ${existing.size} 位博主`);

const seen = new Set();
const stmts = [];
let newCount = 0;
let changedCount = 0;
let mediaCount = 0;

if (MODE !== 'tombstone-only') {
  for await (const u of iterateFollowing(creds, env, { userId: me.id, log })) {
    seen.add(u.id);
    const prev = existing.get(u.id);
    const isNew = !prev;

    // diff -> history
    const changes = [];
    if (prev) {
      for (const [col, field] of TRACKED) {
        const before = prev[col] ?? '';
        const after = u[col] ?? '';
        if (after && before !== after) changes.push({ field, old_value: String(before), new_value: String(after) });
      }
    }

    // 媒体：新增，或图片 URL 变了，才重新抓
    let avatarKey = prev?.avatar_key ?? null;
    let coverKey = prev?.cover_key ?? null;
    if (isNew || (u.avatar_origin && u.avatar_origin !== prev?.avatar_origin)) {
      const k = await archiveMedia('avatars', u.id, u.avatar_origin);
      if (k) { avatarKey = k; mediaCount++; }
    }
    if (isNew || (u.cover_origin && u.cover_origin !== prev?.cover_origin)) {
      const k = await archiveMedia('covers', u.id, u.cover_origin);
      if (k) { coverKey = k; mediaCount++; }
    }

    const now = nowIso();

    // screen_name 有 UNIQUE 约束：改名可能撞上别人占着的旧 handle，先给它让位
    if (prev && prev.screen_name !== u.screen_name) {
      stmts.push(
        `UPDATE bloggers SET screen_name = screen_name || '_stale_${Date.now()}' ` +
        `WHERE LOWER(screen_name) = LOWER(${sq(u.screen_name)}) AND id != ${sq(u.id)};`
      );
    }

    stmts.push(
      `INSERT INTO bloggers (id, screen_name, name, description, followers_count, verified,
         verified_type, avatar_key, avatar_origin, cover_key, cover_origin, backed_up_at, last_synced_at)
       VALUES (${sq(u.id)}, ${sq(u.screen_name)}, ${sq(u.name)}, ${sq(u.description)},
         ${u.followers_count}, ${u.verified}, ${sq(u.verified_type)},
         ${sq(avatarKey)}, ${sq(u.avatar_origin)}, ${sq(coverKey)}, ${sq(u.cover_origin)},
         ${sq(now)}, ${sq(now)})
       ON CONFLICT(id) DO UPDATE SET
         screen_name=excluded.screen_name, name=excluded.name, description=excluded.description,
         followers_count=excluded.followers_count, verified=excluded.verified,
         verified_type=excluded.verified_type,
         avatar_key=COALESCE(excluded.avatar_key, bloggers.avatar_key),
         avatar_origin=COALESCE(excluded.avatar_origin, bloggers.avatar_origin),
         cover_key=COALESCE(excluded.cover_key, bloggers.cover_key),
         cover_origin=COALESCE(excluded.cover_origin, bloggers.cover_origin),
         last_synced_at=excluded.last_synced_at;`
      // 刻意不写 backed_up_at (首次归档不可变) 与 clicks_* (本地埋点资产)
    );

    // ⚠️ 归属行必须一起写。listAll() 要求「至少一条 public 归属」才进公开画廊 ——
    // 只写 bloggers 的话，全量刷新抓进来的新博主全是不可见的孤儿。
    // 可见性跟随 settings.sync_default_visibility（站长在管理台同步面板上的那个开关），
    // 用 SELECT 子查询读，让离线脚本和 Function 端行为一致，只有一个总闸。
    // ON CONFLICT DO NOTHING：绝不覆盖站长手工设过的可见性。
    stmts.push(
      `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
       SELECT 'admin-legacy', ${sq(u.id)},
              COALESCE((SELECT value FROM settings WHERE key='sync_default_visibility'), 'private'),
              ${sq(now)}
       ON CONFLICT(user_id, blogger_id) DO NOTHING;`
    );

    for (const c of changes) {
      stmts.push(
        `INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at)
         VALUES (${sq(u.id)}, ${sq(u.screen_name)}, ${sq(c.field)}, ${sq(c.old_value)}, ${sq(c.new_value)}, ${sq(now)});`
      );
      log(`[MUTATION] @${u.screen_name} ${c.field}: ${String(c.old_value).slice(0, 40)} -> ${String(c.new_value).slice(0, 40)}`);
    }

    if (!prev || prev.followers_count !== u.followers_count) {
      stmts.push(
        `INSERT INTO follower_snapshots (blogger_id, followers_count, captured_at)
         VALUES (${sq(u.id)}, ${u.followers_count}, ${sq(now)});`
      );
    }

    if (isNew) { newCount++; log(`[NEW] @${u.screen_name} (${u.name}) · 粉丝 ${u.followers_count}`); }
    else if (changes.length) changedCount++;

    if (LIMIT && seen.size >= LIMIT) { log(`[POLICY] 达到 --limit=${LIMIT}, 停止`); break; }
  }
}

// ── 墓碑检测 ──────────────────────────────────────────────────────────────
// 在库但本次没在 following 列表出现的博主：可能被封、注销，也可能只是你自己取关了。
// 三者都**不删记录** —— 这是产品的全部意义。只有确认封号/注销才改 is_suspended。
if (MODE !== 'media-only' && seen.size > 0) {
  const missing = [...existing.values()].filter((r) => !seen.has(r.id));
  log(`\n[CHECK] ${missing.length} 位在库博主本次未出现在关注列表, 逐个核对状态...`);

  for (const r of missing) {
    let state = null;
    try {
      // 走 GraphQL UserByScreenName。v1.1 users/show.json 已死(403 Cloudflare 挑战页)
      const u = await lookupUserByHandle(creds, env, r.screen_name);
      if (u?.unavailable) state = u.unavailable;
      else if (u?.id) state = 0;  // 账号还在, 只是你取关了 —— 不动状态
    } catch (err) {
      log(`[WARN] @${r.screen_name} 核对失败: ${err.message}`);
    }

    if (state !== null && state !== r.is_suspended) {
      const now = nowIso();
      stmts.push(`UPDATE bloggers SET is_suspended=${state}, last_synced_at=${sq(now)} WHERE id=${sq(r.id)};`);
      stmts.push(
        `INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at)
         VALUES (${sq(r.id)}, ${sq(r.screen_name)}, 'is_suspended', ${sq(String(r.is_suspended))}, ${sq(String(state))}, ${sq(now)});`
      );
      log(state === 1 ? `[SUSPENDED] @${r.screen_name} 已被封号`
        : state === 2 ? `[DELETED] @${r.screen_name} 已注销`
        : `[RESTORED] @${r.screen_name} 已恢复正常`);
    }
    await sleep(1200 + Math.floor(Math.random() * 800));
  }
}

// ── 落库 ──────────────────────────────────────────────────────────────────
log(`\n[PROGRESS] 待执行 ${stmts.length} 条语句`);
if (stmts.length) {
  // 分批, 避免单个 SQL 文件过大
  const CHUNK = 200;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    d1Batch(stmts.slice(i, i + CHUNK));
    log(`[PROGRESS] 已写入 ${Math.min(i + CHUNK, stmts.length)}/${stmts.length}`);
  }
}

const total = d1('SELECT COUNT(*) AS n FROM bloggers')[0]?.n ?? 0;
log(`\n[SUCCESS] 全量刷新完成`);
log(`  扫描      ${seen.size}`);
log(`  新增      ${newCount}`);
log(`  资料变更  ${changedCount}`);
log(`  媒体归档  ${mediaCount}`);
log(`  库中总计  ${total}`);

