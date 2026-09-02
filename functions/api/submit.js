/**
 * POST /api/submit   { screen_name }   —— 公开投稿，无需登录，无人工审核
 *
 * 流程: 格式校验 → 限流 → 库内去重 → 去 X 核实存在性 → 抓资料 + 归档媒体 → 入库
 *
 * ⚠️ 这是全站唯一的"未鉴权写入"入口，所以护栏是必需的而非可选:
 *   1. 限流    —— 每 IP 每小时 5 次、每天 20 次；全站每小时 60 次
 *   2. 格式    —— handle 只能 [A-Za-z0-9_]{1,15}，挡掉注入与垃圾串
 *   3. 去重    —— 已在库直接返回，不消耗 X 配额
 *   4. 存在性  —— 必须在 X 上真实存在且未封号才入库
 *   5. 冷却    —— 同一 handle 被拒后 24h 内不再重复打 X
 * 没有这些，任何人都能用你的 X 凭据额度刷爆速率限制，或往库里灌垃圾。
 *
 * IP 只存哈希（加 SESSION_SECRET 做盐），不留原始地址。
 */
import { json, fail, nowIso } from '../_lib/http.js';
import { getXCredentials } from '../_lib/crypto.js';
import { optionalUser } from '../_lib/user-auth.js';
import { lookupUserByHandle } from '../_lib/x-provider/graphql.js';
import { archiveMedia } from '../_lib/sync.js';

const PER_IP_HOURLY = 5;
const PER_IP_DAILY = 20;
const GLOBAL_HOURLY = 60;
const REJECT_COOLDOWN_H = 24;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const raw = String(body?.screen_name || '').trim();
  // 允许粘贴整个主页链接
  const handle = raw
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '')
    .trim();

  if (!handle) return fail('请填写博主 handle');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return fail('handle 格式不合法：只能是字母、数字、下划线，最长 15 位');
  }

  // 登录用户：档案归其名下，可选私密。匿名投稿仍然可用，归站长名下且公开。
  const user = await optionalUser(request, env);
  const visibility = user && body?.visibility === 'private' ? 'private' : 'public';
  const ownerId = user?.id || 'admin-legacy';

  const ipHash = await hashIp(request, env);
  const now = nowIso();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();

  // ── 限流 ────────────────────────────────────────────────
  const [ipHour, ipDay, globalHour] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) n FROM submissions WHERE ip_hash=? AND created_at>?')
      .bind(ipHash, hourAgo).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM submissions WHERE ip_hash=? AND created_at>?')
      .bind(ipHash, dayAgo).first(),
    env.DB.prepare('SELECT COUNT(*) n FROM submissions WHERE created_at>?')
      .bind(hourAgo).first(),
  ]);

  if ((ipHour?.n || 0) >= PER_IP_HOURLY) {
    return fail(`提交过于频繁，请稍后再试（每小时上限 ${PER_IP_HOURLY} 次）`, 429);
  }
  if ((ipDay?.n || 0) >= PER_IP_DAILY) {
    return fail(`今日提交次数已达上限（${PER_IP_DAILY} 次）`, 429);
  }
  if ((globalHour?.n || 0) >= GLOBAL_HOURLY) {
    return fail('当前投稿量较大，请稍后再试', 429);
  }

  // ── 库内去重（不消耗 X 配额）────────────────────────────
  const existing = await env.DB.prepare(
    'SELECT id, screen_name, is_suspended FROM bloggers WHERE LOWER(screen_name)=?'
  ).bind(handle.toLowerCase()).first();

  if (existing) {
    // 已在共享归档里。登录用户仍然可以把它加进"我的收录"——
    // 一条 bloggers 行 + 多条归属行，媒体和 X 请求都不重复发生。
    if (user) {
      const added = await env.DB.prepare(
        `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
         VALUES (?,?,?,?) ON CONFLICT DO NOTHING`
      ).bind(user.id, existing.id, visibility, now).run();

      await record(env, handle, 'duplicate', '已在归档库中，已加入我的收录', existing.id, ipHash, now, user.id, visibility);
      return json({
        success: true,
        status: added.meta?.changes ? 'accepted' : 'duplicate',
        visibility,
        message: added.meta?.changes
          ? `@${existing.screen_name} 已加入我的收录（${visibility === 'private' ? '仅自己可见' : '公开'}）`
          : `@${existing.screen_name} 已经在你的收录里了`,
      });
    }

    await record(env, handle, 'duplicate', '已在归档库中', existing.id, ipHash, now, null, 'public');
    return json({
      success: true,
      status: 'duplicate',
      message: existing.is_suspended
        ? `@${existing.screen_name} 已在归档库中（该账号已进入赛博坟场）`
        : `@${existing.screen_name} 已在归档库中，感谢关注`,
    });
  }

  // ── 近期被拒的 handle 冷却，避免反复打 X ────────────────
  const recentReject = await env.DB.prepare(
    `SELECT reason FROM submissions
      WHERE LOWER(screen_name)=? AND status='rejected' AND created_at>?
      ORDER BY created_at DESC LIMIT 1`
  ).bind(handle.toLowerCase(), new Date(Date.now() - REJECT_COOLDOWN_H * 3600_000).toISOString()).first();

  if (recentReject) {
    return json({
      success: true,
      status: 'rejected',
      message: `@${handle} 无法收录：${recentReject.reason}`,
    });
  }

  return await tryArchive(env, handle, ipHash, now, ownerId, visibility, user);
}

/** 去 X 核实 + 抓资料 + 归档媒体 + 入库 */
async function tryArchive(env, handle, ipHash, now, ownerId, visibility, user) {
  const creds = await getXCredentials(env);
  if (!creds) {
    await record(env, handle, 'failed', '服务端未配置 X 凭据', null, ipHash, now, user?.id || null, visibility);
    return json({
      success: true,
      status: 'pending',
      message: '已记录你的投稿，管理员配置好抓取凭据后会自动收录',
    });
  }

  try {
    const profile = await lookupUserByHandle(creds, env, handle);

    if (profile?.unavailable) {
      const reason = profile.unavailable === 1 ? '该账号已被 X 封号' : '该账号不存在或已注销';
      await record(env, handle, 'rejected', reason, null, ipHash, now, user?.id || null, visibility);
      return json({ success: true, status: 'rejected', message: `@${handle} 无法收录：${reason}` });
    }
    if (!profile?.id) {
      await record(env, handle, 'rejected', '未能取到资料', null, ipHash, now, user?.id || null, visibility);
      return json({ success: true, status: 'rejected', message: `@${handle} 无法收录：未能取到资料` });
    }

    // 按 id 再去重一次：投稿用的可能是改名后的新 handle
    const byId = await env.DB.prepare('SELECT screen_name FROM bloggers WHERE id=?')
      .bind(profile.id).first();
    if (byId) {
      // 改名后用新 handle 投稿会走到这里：rest_id 相同但 handle 不同
      if (user) {
        await env.DB.prepare(
          `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
           VALUES (?,?,?,?) ON CONFLICT DO NOTHING`
        ).bind(user.id, profile.id, visibility, now).run();
      }
      await record(env, handle, 'duplicate', `已在库中（记录名 @${byId.screen_name}）`, profile.id, ipHash, now, user?.id || null, visibility);
      return json({
        success: true,
        status: 'duplicate',
        message: `该账号已在归档库中（当前记录为 @${byId.screen_name}，可能已改名）`,
      });
    }

    const avatarKey = await archiveMedia(env, 'avatars', profile.id, profile.avatar_origin);
    const coverKey = await archiveMedia(env, 'covers', profile.id, profile.cover_origin);

    await env.DB.prepare(
      `INSERT INTO bloggers (id, screen_name, name, description, followers_count, verified,
         verified_type, avatar_key, avatar_origin, cover_key, cover_origin,
         backed_up_at, last_synced_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)
       ON CONFLICT(id) DO NOTHING`
    ).bind(
      profile.id, profile.screen_name, profile.name, profile.description,
      profile.followers_count, profile.verified, profile.verified_type,
      avatarKey, profile.avatar_origin, coverKey, profile.cover_origin, now
    ).run();

    await env.DB.prepare(
      'INSERT INTO follower_snapshots (blogger_id, followers_count, captured_at) VALUES (?,?,?)'
    ).bind(profile.id, profile.followers_count, now).run();

    // 归属行决定可见性。匿名投稿归 admin-legacy 且公开；
    // 登录用户归自己名下，可选私密（私密的不会出现在公开画廊，见 db.js listAll）
    await env.DB.prepare(
      `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
       VALUES (?,?,?,?) ON CONFLICT DO NOTHING`
    ).bind(ownerId, profile.id, visibility, now).run();

    await record(env, handle, 'accepted', null, profile.id, ipHash, now, user?.id || null, visibility);

    return json({
      success: true,
      status: 'accepted',
      visibility,
      message: `已收录 @${profile.screen_name}（${profile.followers_count.toLocaleString()} 粉丝）`
        + (visibility === 'private' ? ' · 仅自己可见' : ''),
      blogger: {
        screen_name: profile.screen_name,
        name: profile.name,
        followers_count: profile.followers_count,
        verified: profile.verified,
        avatar_url: avatarKey ? `/api/media?key=${encodeURIComponent(avatarKey)}` : (profile.avatar_origin || ''),
      },
    });
  } catch (err) {
    // 速率限制不算"拒绝"，让投稿者稍后重试
    if (err.rateLimited || err.status === 429) {
      await record(env, handle, 'failed', 'X 速率限制', null, ipHash, now, user?.id || null, visibility);
      return fail('当前抓取通道繁忙，请几分钟后再试', 429);
    }
    await record(env, handle, 'failed', err.message, null, ipHash, now, user?.id || null, visibility);
    return fail(`收录失败：${err.message}`, 500);
  }
}

async function record(env, handle, status, reason, bloggerId, ipHash, now, userId = null, visibility = 'public') {
  try {
    await env.DB.prepare(
      `INSERT INTO submissions (screen_name, status, reason, blogger_id, ip_hash, created_at, user_id, visibility)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(handle, status, reason, bloggerId, ipHash, now, userId, visibility).run();
  } catch { /* 记录失败不影响主流程 */ }
}

/** IP 只留哈希，加 SESSION_SECRET 做盐 —— 限流够用，且不存原始地址 */
async function hashIp(request, env) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'unknown';
  const data = new TextEncoder().encode(`${ip}|${env.SESSION_SECRET || 'x-vault'}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
