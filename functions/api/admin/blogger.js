/**
 * 单个博主档案的增删。与"屏蔽"严格区分。
 *
 *   PUT    /api/admin/blogger  { screen_name }        新增档案（自动去 X 抓真实资料）
 *   DELETE /api/admin/blogger  { screen_name, mode, confirm } 撤出公开仓 / 彻底删除
 *
 * ── 删除 vs 隐藏 ──────────────────────────────────────────────
 *   隐藏 (is_blocked=1, 走 POST /api/admin/bloggers)
 *     · 档案、头像、点击数、变更时间线全部保留
 *     · 只是不在公开画廊出现
 *     · 随时可恢复
 *   删除 (本端点)
 *     · 删除 bloggers 行 + 变更时间线 + 粉丝快照 + 所有人的归属与收藏
 *     · 点击统计一并丢失
 *     · R2 里的头像/banner 也删掉
 *     · **不可恢复**
 *
 * ── release vs purge（两种删除）─────────────────────────────
 *   mode:'release'  撤出公开仓 = 只删 admin-legacy 那一行归属指针。
 *                   别人的私人收录**照旧保留**，那份共享数据继续为他们服务。
 *                   只有在没人再引用时才顺带回收数据。日常下架应该用这个。
 *   mode:'purge'    彻底删除 = 连别人的收录一起毁掉（违规内容才需要）。
 *                   一旦还有别的用户收录着它，必须额外传 force:true 才放行 ——
 *                   否则站长一次点击就能静默清空别人的私人收藏夹。
 *
 * 归档系统的立身之本是"永不丢失"，所以删除要求确认短语，且账号在 X 上消失时
 * 绝不该走删除 —— 那种情况是墓碑 (is_suspended)，档案必须留着。
 */
import { ok, fail, json, nowIso } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';
import { getXCredentials } from '../../_lib/crypto.js';
import { lookupUserByHandle } from '../../_lib/x-provider/graphql.js';
import { archiveMedia } from '../../_lib/sync.js';
import { ensureOwnership, releaseOwnership, purgeBlogger, countRefs, ADMIN_OWNER } from '../../_lib/db.js';

const DELETE_CONFIRM = 'DELETE';

export async function onRequestPut({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const handle = String(body?.screen_name || '').trim().replace(/^@/, '');
  if (!handle) return fail('请填写博主 handle');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return fail('handle 格式不合法（只能是字母、数字、下划线，最长 15 位）');
  }

  const existing = await env.DB.prepare(
    'SELECT id, screen_name FROM bloggers WHERE LOWER(screen_name) = ?'
  ).bind(handle.toLowerCase()).first();
  if (existing) return fail(`@${existing.screen_name} 已在归档库中`, 409);

  const creds = await getXCredentials(env);
  if (!creds) return fail('尚未配置 X Cookie 凭据，无法抓取博主资料');

  try {
    const profile = await lookupUserByHandle(creds, env, handle);
    if (profile?.unavailable) {
      return fail(
        profile.unavailable === 1
          ? `@${handle} 已被 X 封号，无法抓取资料`
          : `@${handle} 不存在或已注销`,
        404
      );
    }
    if (!profile?.id) return fail('未能取到该博主资料');

    // id 可能已存在（改名后用新 handle 再添加一次）
    const byId = await env.DB.prepare('SELECT screen_name FROM bloggers WHERE id = ?')
      .bind(profile.id).first();
    if (byId) {
      return fail(`该账号已在库中，当前记录的 handle 是 @${byId.screen_name}（可能已改名）`, 409);
    }

    const now = nowIso();
    const avatarKey = await archiveMedia(env, 'avatars', profile.id, profile.avatar_origin);
    const coverKey = await archiveMedia(env, 'covers', profile.id, profile.cover_origin);

    await env.DB.prepare(
      `INSERT INTO bloggers (id, screen_name, name, description, followers_count, verified,
         verified_type, avatar_key, avatar_origin, cover_key, cover_origin,
         backed_up_at, last_synced_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)`
    ).bind(
      profile.id, profile.screen_name, profile.name, profile.description,
      profile.followers_count, profile.verified, profile.verified_type,
      avatarKey, profile.avatar_origin, coverKey, profile.cover_origin, now
    ).run();

    await env.DB.prepare(
      'INSERT INTO follower_snapshots (blogger_id, followers_count, captured_at) VALUES (?,?,?)'
    ).bind(profile.id, profile.followers_count, now).run();

    // ⚠️ 必须建归属行，否则这条记录是不可见的孤儿（画廊看不到、不属于任何人）。
    // 这里曾经漏掉，站长手动加了 @X / @ER 之后在首页找不到人。
    // 可见性默认跟随 settings.sync_default_visibility，也可以在请求体里显式指定。
    const vis = await ensureOwnership(env.DB, profile.id, { visibility: body?.visibility });

    return ok({
      // 把落到哪个可见性写进提示 —— 默认私密时如果不说，用户会以为添加失败
      message: `已归档 @${profile.screen_name}（${profile.followers_count.toLocaleString()} 粉丝）` +
               (vis === 'private' ? ' · 已设为仅站长可见，去「待公开」Tab 里公开它' : ' · 已公开到画廊'),
      visibility: vis,
      blogger: {
        id: profile.id,
        screen_name: profile.screen_name,
        name: profile.name,
        followers_count: profile.followers_count,
        verified: profile.verified,
      },
    });
  } catch (err) {
    return fail(`添加失败: ${err.message}`, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body = {};
  try {
    body = await request.json();
  } catch { /* 允许空 body，下面会拒 */ }

  const handle = String(body?.screen_name || '').trim().replace(/^@/, '');
  if (!handle) return fail('缺少 screen_name');

  // 默认仍是 purge —— 老前端只传 { screen_name, confirm }，行为不能变。
  const mode = body?.mode === 'release' ? 'release' : 'purge';

  const row = await env.DB.prepare(
    `SELECT id, screen_name, name, avatar_key, cover_key, is_suspended,
            clicks_card + clicks_timeline + clicks_roulette AS clicks
       FROM bloggers WHERE LOWER(screen_name) = ?`
  ).bind(handle.toLowerCase()).first();
  if (!row) return fail(`未找到 @${handle}`, 404);

  const refs = await countRefs(env.DB, row.id);
  // 公开仓之外还有多少人收录着它 —— purge 的"杀伤半径"
  const others = refs.owners - (refs.adminOwns ? 1 : 0);

  try {
    if (mode === 'release') {
      if (!refs.adminOwns) {
        return fail(`公开仓并没有收录 @${row.screen_name}（它出现在画廊是因为别的用户把它标成了公开）。` +
                    `要全站下架请用「屏蔽」(is_blocked)。`, 409);
      }
      // 撤出公开仓本身是可逆的（重新添加即可），所以不要确认短语。
      // 但如果撤掉之后就没人引用了 —— 那这一步会真的销毁数据，必须确认。
      const willGc = others === 0 && refs.favorites === 0;
      if (willGc && body?.confirm !== DELETE_CONFIRM) {
        return fail(
          `@${row.screen_name} 只有公开仓在收录它，撤出后将无人引用，归档数据（含点击统计、` +
          `变更时间线、R2 媒体）会被一并回收，不可恢复。\n` +
          `若只想让它不在画廊出现但保留档案，请用「屏蔽」。\n` +
          `确认请在请求体加上 confirm: "${DELETE_CONFIRM}"。`,
          428
        );
      }

      const r = await releaseOwnership(env.DB, row, ADMIN_OWNER, { media: env.MEDIA });
      return ok({
        mode: 'release',
        reclaimed: r.gcd,
        message: r.gcd
          ? `已撤出公开仓 @${row.screen_name}，且已无人引用，归档数据一并回收`
          : `已把 @${row.screen_name} 撤出公开仓；仍有 ${r.refs.owners} 人收录` +
            `${r.refs.favorites ? ` / ${r.refs.favorites} 人收藏` : ''}，归档数据保留`,
        refs: r.refs,
      });
    }

    // ── purge ────────────────────────────────────────────────
    if (body?.confirm !== DELETE_CONFIRM) {
      return fail(
        `彻底删除不可恢复（含点击统计与变更时间线）。若只想让它不在画廊出现，请用"屏蔽"。` +
        `确认删除请在请求体加上 confirm: "${DELETE_CONFIRM}"。`,
        428
      );
    }

    // ⚠️ 别人也收录着它的时候，purge 会连带清空别人的私人收录 —— 那不是"下架"，
    // 是替别人做决定。所以这里挡一道，要站长明确表示知道杀伤半径。
    // 正常想下架应该走 mode:'release'。
    if (others > 0 && body?.force !== true) {
      // error 字符串保持原样：离线测试按原文断言 409。结构化字段给管理台二次确认用。
      return json({
        success: false,
        error:
          `还有 ${others} 位用户把 @${row.screen_name} 收录在自己名下` +
          `${refs.favorites ? `，另有 ${refs.favorites} 条收藏` : ''}。` +
          `彻底删除会把他们的收录一起毁掉。\n` +
          `· 只想撤出公开画廊：mode:"release"（他们的私人收录保留）\n` +
          `· 确实要连带删除（违规内容）：再加 force:true`,
        code: 'others_own',
        others,
        favorites: refs.favorites,
        refs,
      }, 409);
    }

    const { mediaDeleted } = await purgeBlogger(env.DB, row.id, {
      media: env.MEDIA, avatarKey: row.avatar_key, coverKey: row.cover_key,
    });

    return ok({
      mode: 'purge',
      message: `已彻底删除 @${row.screen_name} 的档案` +
               (others > 0 ? `（连带移除了 ${others} 位用户的收录）` : ''),
      deleted: {
        screen_name: row.screen_name,
        name: row.name,
        clicks_lost: row.clicks,
        media_deleted: mediaDeleted,
        owners_removed: refs.owners,
        favorites_removed: refs.favorites,
        was_tombstoned: row.is_suspended !== 0,
      },
    });
  } catch (err) {
    return fail(`删除失败: ${err.message}`, 500);
  }
}
