/**
 * 同步核心: diff -> history -> 媒体归档 -> UPSERT。
 *
 * 依据 _reference/spec/04-data-model.md 与 05-sync-pipeline.md。
 *
 * 三条不可违背的规则:
 *   1. 归档记录**永不删除** —— 账号从 X 消失只改 is_suspended, 这是产品的全部意义
 *   2. UPSERT 不得覆盖 backed_up_at, 不得覆盖 clicks_* —— 首次归档时间与埋点是本地资产
 *   3. 媒体 key 与 origin 双存 —— 原站只存 key, 结果 R2 一挂 324/332 条图片永久丢失
 */
import { nowIso } from './http.js';

/** 参与 diff 的字段 -> history.field 的取值(前端有对应中文标签) */
const TRACKED = [
  ['name', 'name'],
  ['screen_name', 'screen_name'],
  ['description', 'description'],
  ['avatar_origin', 'avatar_url'],
  ['cover_origin', 'cover_url'],
];

/** 算出 incoming 相对 existing 的变更列表 */
export function diffUser(existing, incoming) {
  const changes = [];
  if (!existing) return changes;
  for (const [col, field] of TRACKED) {
    const before = existing[col] ?? '';
    const after = incoming[col] ?? '';
    if (after && before !== after) {
      changes.push({ field, old_value: String(before), new_value: String(after) });
    }
  }
  return changes;
}

/** 内容哈希前 16 位 -> R2 key。头像没换就命中同一 key, 天然跳过上传并保留历史头像 */
async function contentKey(prefix, xId, bytes, ext = 'jpg') {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}/${xId}/${hex.slice(0, 16)}.${ext}`;
}

/**
 * 抓一张图存进 R2。已存在同 key 则跳过上传。
 * 失败返回 null —— 单张图失败绝不能中断整批(实测 banner 404/403 是常态)。
 */
export async function archiveMedia(env, prefix, xId, url, log = () => {}) {
  if (!url || !env.MEDIA) return null;
  try {
    const res = await fetch(url, { headers: { accept: 'image/*' } });
    if (!res.ok) {
      log(`[WARN] 取图失败 ${res.status}: ${url}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return null;

    const ext = (res.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
    const key = await contentKey(prefix, xId, bytes, ext);

    const head = await env.MEDIA.head(key);
    if (head) return key; // 内容未变, 已归档过

    await env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: res.headers.get('content-type') || 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    log(`[R2] 已归档 ${key} (${bytes.length} bytes)`);
    return key;
  } catch (err) {
    log(`[WARN] 归档媒体异常: ${err.message}`);
    return null;
  }
}

const SELECT_EXISTING = `SELECT id, screen_name, name, description, followers_count, verified,
  is_suspended, avatar_key, avatar_origin, cover_key, cover_origin, backed_up_at
  FROM bloggers WHERE id = ?`;

/**
 * 落库一个博主: diff -> history -> 媒体 -> UPSERT -> 粉丝快照。
 * 返回 { isNew, changes }。
 */
export async function upsertBlogger(env, incoming, log = () => {}) {
  const db = env.DB;
  const now = nowIso();
  const existing = await db.prepare(SELECT_EXISTING).bind(incoming.id).first();
  const isNew = !existing;
  const changes = diffUser(existing, incoming);

  // 媒体: 只在新增或图片 URL 变了时才重新抓
  let avatarKey = existing?.avatar_key ?? null;
  let coverKey = existing?.cover_key ?? null;

  const avatarChanged = isNew || (incoming.avatar_origin && incoming.avatar_origin !== existing?.avatar_origin);
  const coverChanged = isNew || (incoming.cover_origin && incoming.cover_origin !== existing?.cover_origin);

  if (avatarChanged) {
    avatarKey = (await archiveMedia(env, 'avatars', incoming.id, incoming.avatar_origin, log)) ?? avatarKey;
  }
  if (coverChanged) {
    coverKey = (await archiveMedia(env, 'covers', incoming.id, incoming.cover_origin, log)) ?? coverKey;
  }

  // screen_name 有 UNIQUE 约束: 改名可能撞上别人占着的旧 handle, 先给它让位
  if (existing && existing.screen_name !== incoming.screen_name) {
    await db.prepare(
      'UPDATE bloggers SET screen_name = screen_name || ?1 WHERE LOWER(screen_name) = LOWER(?2) AND id != ?3'
    ).bind(`_stale_${Date.now()}`, incoming.screen_name, incoming.id).run();
  }

  await db.prepare(
    `INSERT INTO bloggers (id, screen_name, name, description, followers_count, verified,
       verified_type, avatar_key, avatar_origin, cover_key, cover_origin,
       backed_up_at, last_synced_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)
     ON CONFLICT(id) DO UPDATE SET
       screen_name=excluded.screen_name, name=excluded.name,
       description=excluded.description, followers_count=excluded.followers_count,
       verified=excluded.verified, verified_type=excluded.verified_type,
       avatar_key=COALESCE(excluded.avatar_key, bloggers.avatar_key),
       avatar_origin=COALESCE(excluded.avatar_origin, bloggers.avatar_origin),
       cover_key=COALESCE(excluded.cover_key, bloggers.cover_key),
       cover_origin=COALESCE(excluded.cover_origin, bloggers.cover_origin),
       last_synced_at=excluded.last_synced_at`
       // 刻意不写: backed_up_at (首次归档不可变) / clicks_* (埋点不可覆盖)
       // 刻意不写: is_suspended / is_blocked (分别由墓碑检测与管理员掌管)
  ).bind(
    incoming.id, incoming.screen_name, incoming.name, incoming.description,
    incoming.followers_count, incoming.verified, incoming.verified_type,
    avatarKey, incoming.avatar_origin, coverKey, incoming.cover_origin,
    existing?.backed_up_at || now
  ).run();

  for (const c of changes) {
    await db.prepare(
      `INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(incoming.id, incoming.screen_name, c.field, c.old_value, c.new_value, now).run();
  }

  // 粉丝数快照: 原站缺这张表, 所以 analytics 画不出增长曲线
  if (isNew || existing.followers_count !== incoming.followers_count) {
    await db.prepare(
      'INSERT INTO follower_snapshots (blogger_id, followers_count, captured_at) VALUES (?,?,?)'
    ).bind(incoming.id, incoming.followers_count, now).run();
  }

  return { isNew, changes };
}

/** 墓碑标记。绝不删除记录 —— 只改状态并留下一条 history */
export async function markTombstone(env, id, screenName, state, log = () => {}) {
  const now = nowIso();
  const before = await env.DB.prepare('SELECT is_suspended FROM bloggers WHERE id = ?').bind(id).first();
  if (!before || before.is_suspended === state) return false;

  await env.DB.prepare('UPDATE bloggers SET is_suspended = ?, last_synced_at = ? WHERE id = ?')
    .bind(state, now, id).run();
  await env.DB.prepare(
    `INSERT INTO blogger_history (blogger_id, screen_name, field, old_value, new_value, changed_at)
     VALUES (?,?,'is_suspended',?,?,?)`
  ).bind(id, screenName, String(before.is_suspended), String(state), now).run();

  log(state === 1 ? `[SUSPENDED] @${screenName} 已被封号` : `[DELETED] @${screenName} 已注销`);
  return true;
}
