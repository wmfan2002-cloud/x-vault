/**
 * POST /api/user/sync    用自己的 X 凭据增量同步关注列表（一轮）
 * GET  /api/user/sync    轮询进度
 *
 * ── 两件事的实现，它们其实是同一个机制 ──────────────────────────
 *
 * ① 断点续跑（修 bug）
 *    原来：撞到单轮上限就停，下一轮又从第 1 位开始扫 —— 前面那一段全是已知的，
 *    「连续 3 个已知即停」立刻触发，于是**永远过不了单轮上限那个位置**。
 *
 *    「连续已知即停」这个启发式本身是对的：正常情况下你已同步完、又新关注了几个人，
 *    X 按关注时间倒序返回，新的在最前面，扫过它们就撞到已知的 -> 该停。
 *    但**在上限截断之后它是错的** —— 此时前面那段已知恰恰是要跳过的部分。
 *
 *    修法：把页游标存进 user_sync_state.cursor（这一列本来就有，只是从没写过），
 *    下一轮从它继续；且**只要 cursor 非空就关掉「连续已知即停」**。
 *    cursor 非空本身就等于「还在补历史，不是在找新增」，不需要额外标志位。
 *
 * ② 两种模式
 *    incremental（默认）从最新关注开始扫，连续 3 位已知就停。日常用，很快。
 *    full            走完**整个**关注列表，不理"连续已知"判据；已收录的**便宜跳过**
 *                    （只查一次归属，不跑 upsertBlogger 的约 5 次查询）。
 *                    用来补历史 / 强制完整核对，跨批次保持直到走完。
 *
 * ③ 小批量（为了 Cloudflare Free 能用）
 *    Free 版**每次 Worker 调用只能打 50 次 D1 查询**（Paid 是 1000），
 *    而同步每位博主约 8 次查询（查已有/upsert/写 history/写快照/归属/进度）。
 *    所以 Free 上一轮最多处理 5-6 位 —— 原来写死的 120 根本达不到。
 *    现在每轮处理多少由 maxUsers 决定，前端循环调用直到 done。
 *
 * ── 预算模型（为什么不是"每批 N 位"）─────────────────────────
 * 单纯限制"每批处理 N 位"不够，因为两种人的开销差 8 倍：
 *   新博主：约 8 次查询（查已有 / upsert / 写 history / 写快照 / 归属）
 *   已收录：1 次查询（查归属后直接跳过）
 * 所以按**查询预算**扣：预算花完就停。这样一批可以跳过 40 个已知 + 处理 4 个新的，
 * 也可以只处理 5 个新的 —— 都不会超出 Free 的 50 次/调用。
 *
 * ── 断点为什么是 (cursor, offset) 一对 ─────────────────────────
 * 游标 cursor-bottom 的含义是"下一页从这里取"，所以页中间存它会漏掉本页剩下的人。
 * 一开始只在页边界断点，但**实测 X 完全无视 count**（传 5/20/100 都回 50 人一页），
 * 于是最小一批就是 50 位 × 约 8 次查询 = 400 次，超 Free 上限 8 倍，分批等于没做。
 *
 * 所以状态是一对：
 *   cursor        取到当前这一页所用的游标（NULL = 第一页）
 *   cursor_offset 这一页里已处理完的人数
 * 恢复时重新取同一页（1 次 HTTP、0 次 D1 查询），跳过前 offset 个再继续。
 * 重复取页的代价远小于超配额。
 */
import { json, fail, nowIso } from '../../_lib/http.js';
import { requireUser } from '../../_lib/user-auth.js';
import { decryptSecret } from '../../_lib/crypto.js';
import { iterateFollowingPages, verifyCredentials } from '../../_lib/x-provider/graphql.js';
import { upsertBlogger } from '../../_lib/sync.js';

const CONSECUTIVE_KNOWN_STOP = 3;
const STALE_MS = 10 * 60 * 1000;

// 单次调用的 D1 查询预算。Cloudflare Free 是 50 次/调用，留 8 次给状态读写。
// 本地和 Workers Paid（1000 次）可以由前端调大。
const DEFAULT_QUERY_BUDGET = 42;
const MAX_QUERY_BUDGET = 900;
// 单位开销（估算，用于扣预算）
const COST_NEW = 8;    // 新博主：查已有 + upsert + history + 快照 + 归属
const COST_SKIP = 1;   // 已收录：只查一次归属就跳过

async function getUserCreds(env, userId) {
  const row = await env.DB.prepare(
    'SELECT ct0_enc, auth_token_enc, x_user_id FROM user_x_credentials WHERE user_id = ?'
  ).bind(userId).first();
  if (!row) return null;
  return {
    ct0: await decryptSecret(row.ct0_enc, env.CREDENTIAL_ENC_KEY),
    authToken: await decryptSecret(row.auth_token_enc, env.CREDENTIAL_ENC_KEY),
    xUserId: row.x_user_id || '',
  };
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);

  const row = await env.DB.prepare('SELECT * FROM user_sync_state WHERE user_id = ?')
    .bind(user.id).first();
  if (!row) return json({ running: false, current: 0, total: 0, has_more: false });

  let running = !!row.running;
  let error = row.error || null;
  // Worker 被中断时没机会把 running 置 0，这里兜底
  if (running && row.started_at && Date.now() - new Date(row.started_at).getTime() > STALE_MS) {
    running = false;
    error = error || '任务超时未上报，已自动标记结束';
    await env.DB.prepare('UPDATE user_sync_state SET running=0, error=? WHERE user_id=?')
      .bind(error, user.id).run();
  }

  let lastItem = null;
  if (row.last_item) { try { lastItem = JSON.parse(row.last_item); } catch { /* 忽略脏值 */ } }

  return json({
    running,
    current: row.current || 0,
    passScanned: row.pass_scanned || 0,
    newFetched: row.new_fetched || 0,
    total: row.total || 0,
    // 断点存在 = 还没走完，再点一次会从这里继续。offset > 0 也算（停在第一页中间）
    has_more: !!row.cursor || (row.cursor_offset || 0) > 0,
    mode: row.pass_mode || null,
    lastItem,
    error,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
  }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail('请先登录', 401);
  if (!env.CREDENTIAL_ENC_KEY) return fail('服务端未配置加密密钥', 503);

  let body = {};
  try { body = await request.json(); } catch { /* 允许空 body */ }
  const visibility = body?.visibility === 'private' ? 'private' : 'public';
  const budget = Math.min(
    Math.max(parseInt(body?.queryBudget, 10) || DEFAULT_QUERY_BUDGET, 10),
    MAX_QUERY_BUDGET
  );
  // restart=true：丢掉已存断点，从最新关注重新开始
  const restart = body?.restart === true;
  // 请求的模式。只在**开新一轮**时生效；续跑时沿用状态里存的那个。
  const wantMode = body?.mode === 'full' ? 'full' : 'incremental';

  const creds = await getUserCreds(env, user.id);
  if (!creds) return fail('请先在「X 凭据」里配置并验证你的 Cookie');

  const cur = await env.DB.prepare(
    `SELECT running, started_at, cursor, cursor_offset, pass_scanned, pass_mode
       FROM user_sync_state WHERE user_id=?`
  ).bind(user.id).first();

  if (cur?.running && cur.started_at && Date.now() - new Date(cur.started_at).getTime() < STALE_MS) {
    return fail('你的同步任务正在运行中，请稍候', 409);
  }

  const startCursor = restart ? null : (cur?.cursor || null);
  const startOffset = restart ? 0 : (cur?.cursor_offset || 0);
  // resuming 的判据是"有断点"，游标为 null 但偏移 > 0 也算 —— 那是停在第一页中间
  const resuming = !restart && (!!startCursor || startOffset > 0);
  // 续跑沿用这一轮开始时定下的模式；开新一轮才用请求里的
  const mode = resuming ? (cur?.pass_mode || 'incremental') : wantMode;
  const fullPass = mode === 'full';
  let passScanned = resuming ? (cur?.pass_scanned || 0) : 0;

  const logs = [];
  const log = (m) => logs.push(m);
  const now = nowIso();

  try {
    let xUserId = creds.xUserId;
    if (!xUserId) {
      const me = await verifyCredentials(creds, env);
      xUserId = me.id;
      await env.DB.prepare('UPDATE user_x_credentials SET x_user_id=? WHERE user_id=?')
        .bind(xUserId, user.id).run();
    }
    if (!xUserId) return fail('无法确定你的 X userId，请重新验证凭据');

    await env.DB.prepare(
      // ⚠️ 列名与 VALUES 的占位符数量必须严格对应。
      // 这里曾经漏掉 pass_mode 这一列却在 VALUES 里多加了一个 ? ——
      // D1 报 "11 values for 10 columns"，而这条语句只在**用户面板**同步时执行，
      // 我之前只测了管理台那条路径，所以没暴露出来。
      `INSERT INTO user_sync_state
         (user_id, running, current, new_fetched, error, started_at, finished_at,
          cursor, cursor_offset, pass_scanned, pass_mode)
       VALUES (?,1,0,0,NULL,?,NULL,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         running=1, current=0, new_fetched=0, error=NULL,
         started_at=excluded.started_at, finished_at=NULL,
         cursor=excluded.cursor, cursor_offset=excluded.cursor_offset,
         pass_scanned=excluded.pass_scanned, pass_mode=excluded.pass_mode`
    ).bind(user.id, now, startCursor, startOffset, passScanned, mode).run();

    log(resuming
      ? `[RESUME] 从断点继续（此前已扫 ${passScanned} 位，页内偏移 ${startOffset}）`
      : `[START] ${fullPass ? '完整核对：走完整个关注列表' : '增量：只找最新的新关注'}`);
    log(`[INFO] 本批查询预算 ${budget} 次（新博主约 ${COST_NEW} 次 / 已收录跳过 ${COST_SKIP} 次）`);
    if (fullPass) {
      log('[INFO] 完整核对模式：已关闭「连续 3 位已知即停」，已收录的会被快速跳过');
    }

    const newOwned = [];
    let lastSeen = null;   // 最后看过的那一位，用于进度显示
    let consecutiveKnown = 0;
    let stopReason = null;
    let saveCursor = startCursor;   // 断点：取到当前页所用的游标
    let saveOffset = startOffset;   // 断点：该页内已处理人数
    let exhausted = false;
    let firstPage = true;

    let spent = 0;      // 已花掉的查询预算
    let skipped = 0;

    for await (const pg of iterateFollowingPages(creds, env, {
      userId: xUserId, log, cursor: startCursor,
    })) {
      if (pg.staleCursor) {
        // 游标失效（X 侧过期或关注列表变动过大）—— 清空重来，不要静默卡死
        log('[WARN] 保存的断点已失效，已重置。下次点击会从最新关注重新开始。');
        // exhausted=true 会让下面的收尾逻辑把 cursor / offset / pass_scanned / pass_mode
        // 全部清空 —— 这是"卡死"的唯一出路，别改成保留断点
        exhausted = true;
        saveCursor = null; saveOffset = 0; passScanned = 0;
        stopReason = 'stale_cursor';
        break;
      }

      // 只有本轮的**第一页**要跳过偏移；后续页都是从头开始
      const from = firstPage ? Math.min(startOffset, pg.users.length) : 0;
      firstPage = false;
      if (from > 0) log(`[SKIP] 本页前 ${from} 位已在上一批处理过，跳过（不消耗数据库查询）`);

      let stoppedMidPage = false;

      for (let i = from; i < pg.users.length; i++) {
        // 连"查一次归属"的预算都不够了 -> 停在这里
        if (spent + COST_SKIP > budget) {
          saveCursor = pg.pageCursor;   // 游标保持"取到本页的那个"
          saveOffset = i;               // 偏移记到 i
          stoppedMidPage = true;
          stopReason = 'budget';
          log(`[PAUSE] 预算用尽（${spent}/${budget}）：本批新增 ${newOwned.length} 位、跳过 ${skipped} 位已收录，停在本页第 ${i} 位。`);
          break;
        }

        const u = pg.users[i];
        lastSeen = { screen_name: u.screen_name, name: u.name, followers_count: u.followers_count };

        // 是否已在**我的**收录里（不是全库）—— 增量判据必须按用户算
        const mine = await env.DB.prepare(
          'SELECT 1 FROM blogger_owners WHERE user_id=? AND blogger_id=?'
        ).bind(user.id, u.id).first();
        spent += COST_SKIP;
        passScanned++;

        if (mine) {
          // 已收录的**直接跳过，不跑 upsertBlogger**（省约 5 次查询）。
          // 代价是不刷新已有档案的资料 —— 但那本来就是 GitHub Actions 全量刷新的职责，
          // 增量同步从设计上只负责"发现新关注"（见文件头的局限说明）。
          consecutiveKnown++;
          skipped++;
        } else {
          // 新的才付全价
          if (spent + COST_NEW > budget) {
            saveCursor = pg.pageCursor;
            saveOffset = i;   // 注意是 i 而不是 i+1：这一位还没处理，下批要重做
            stoppedMidPage = true;
            stopReason = 'budget';
            log(`[PAUSE] 预算不足以再处理一位新博主（${spent}/${budget}），停在本页第 ${i} 位。`);
            break;
          }
          consecutiveKnown = 0;

          // 共享归档：别人已抓过就不会重复下载媒体
          await upsertBlogger(env, u, log);
          await env.DB.prepare(
            `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
             VALUES (?,?,?,?) ON CONFLICT DO NOTHING`
          ).bind(user.id, u.id, visibility, nowIso()).run();
          spent += COST_NEW;

          newOwned.push({ screen_name: u.screen_name, name: u.name, followers_count: u.followers_count });
          log(`[NEW] @${u.screen_name} (${u.name}) · 粉丝 ${u.followers_count}`);
        }

        // ⚠️「连续已知即停」只在增量模式下启用。完整核对时前面那段已知
        // 恰恰是要跳过的部分，在这里停下来就是原来那个永远过不去的 bug。
        // 放在页内逐位判断（不是每页判一次），找新增时才能第一时间停住。
        if (!fullPass && consecutiveKnown >= CONSECUTIVE_KNOWN_STOP) {
          log(`[CHECK] 增量核对到此为止：连续 ${CONSECUTIVE_KNOWN_STOP} 位已在你的收录中，说明已追平最新关注。`);
          log('[HINT] 想补历史（把 120 位之后的也拉进来）请用「完整核对」，它会走完整个列表并跳过已收录的。');
          stopReason = 'incremental';
          exhausted = true;      // 增量这一轮结束，不留断点
          stoppedMidPage = true;
          break;
        }
      }

      if (stoppedMidPage) break;

      // 整页处理完：断点推进到下一页起点
      saveCursor = pg.cursor;
      saveOffset = 0;
      exhausted = pg.exhausted;

      if (exhausted) {
        log('[DONE] 关注列表已走到末尾，本轮完整走完一遍。');
        stopReason = 'exhausted';
        break;
      }
      if (spent + COST_SKIP > budget) {
        stopReason = 'budget';
        log(`[PAUSE] 预算用尽（${spent}/${budget}），断点已保存在页边界。`);
        break;
      }
    }

    const totalRow = await env.DB.prepare(
      'SELECT COUNT(*) n FROM blogger_owners WHERE user_id=?'
    ).bind(user.id).first();
    const total = totalRow?.n || 0;

    // exhausted / 智能中断 -> 清空断点与累计（一轮结束）；否则保留断点
    const finalCursor = exhausted ? null : saveCursor;
    const finalOffset = exhausted ? 0 : saveOffset;
    const savePass = exhausted ? 0 : passScanned;
    // has_more 的判据必须同时看游标和偏移：停在第一页中间时 cursor 是 null 但 offset > 0，
    // 只看 cursor 会误判成"跑完了"，那正是最初那个 bug 的另一种形态。
    const hasMore = !exhausted && (!!finalCursor || finalOffset > 0);

    await env.DB.prepare(
      `UPDATE user_sync_state
          SET running=0, current=?, new_fetched=?, total=?, finished_at=?,
              cursor=?, cursor_offset=?, pass_scanned=?, pass_mode=?, last_item=?
        WHERE user_id=?`
    ).bind(
      passScanned, newOwned.length, total, nowIso(), finalCursor, finalOffset, savePass,
      exhausted ? null : mode,
      lastSeen ? JSON.stringify(lastSeen) : null,
      user.id
    ).run();

    return json({
      success: true,
      // 前端据此决定要不要继续调用
      has_more: hasMore,
      done: !hasMore,
      stop_reason: stopReason,
      resumed: resuming,
      mode,
      scanned: passScanned,
      new_this_batch: newOwned.length,
      skipped,
      spent,
      budget,
      pass_scanned: passScanned,
      new_users: newOwned,
      new_count: newOwned.length,
      count: passScanned,
      last_seen: lastSeen,
      total_owned: total,
      is_incremental_stop: stopReason === 'incremental',
      visibility,
      logs,
    });
  } catch (err) {
    // 出错时**保留游标**，这样修好问题后还能从断点继续，不用从头再来
    await env.DB.prepare(
      'UPDATE user_sync_state SET running=0, error=?, finished_at=? WHERE user_id=?'
    ).bind(err.message, nowIso(), user.id).run();
    // 出错保留断点，修好问题能从这里继续
    return json({ success: false, error: err.message, has_more: resuming || !!startCursor, logs }, 200);
  }
}
