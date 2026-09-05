/**
 * POST /api/sync-following   { ct0, authToken } -> 模式 A 响应
 *
 *
 * 走"模式 A: 边缘直返" —— Function 内同步抓完并直接返回结果数组。
 * 智能增量: X 按关注时间倒序返回, 连续命中 3 个已在库博主即判定无新增并停止翻页
 * (原站日志文案 admin.js:551 证实了这个阈值)。日常同步因此只花 1-2 个请求。
 *
 * ⚠️ 局限(与原站相同): 增量只发现**新增关注**, 发现不了已有博主改名/换头像/被封。
 * 那部分靠 GitHub Actions 全量刷新补齐, 两者是配套的。
 *
 * ── 断点续跑（与 /api/user/sync 同一套修法）────────────────────
 * 原来撞到单轮上限就停, 下一轮又从第 1 位重扫 —— 前面那段全是已知的,
 * 「连续 3 个已知即停」立刻触发, **永远过不了单轮上限那个位置**。
 * 现在把页游标存进 sync_state.cursor, 下一轮从它继续;
 * 且**只要 cursor 非空就关掉「连续已知即停」** —— 那个判据只适用于从头找新增,
 * 补历史时前面那段已知恰恰是要跳过的部分。
 *
 * 断点是 (cursor, offset) 一对: 游标含义是"下一页从这里取", 页中间存它会漏人;
 * 但**实测 X 完全无视 count**(传 5/20/100 都回 50 人一页), 只按页边界断点的话
 * 最小一批就是 50 位 x 约 8 次查询 = 400 次, 超 Free 上限 8 倍。所以再记一个页内偏移,
 * 恢复时重新取同一页(1 次 HTTP、0 次 D1 查询)跳过前 offset 个。
 */
import { json, fail, nowIso } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { getSetting, getXCredentials } from '../_lib/crypto.js';
import { iterateFollowingPages, verifyCredentials } from '../_lib/x-provider/graphql.js';
import { upsertBlogger } from '../_lib/sync.js';

const CONSECUTIVE_KNOWN_STOP = 3;

// 单次调用的 D1 查询预算。Cloudflare Free 是 50 次/调用, 留 8 次给状态读写。
// 本地和 Workers Paid(1000 次)可以由前端调大。
//
// 为什么按预算而不是"每批 N 位": 两种人开销差 8 倍 ——
//   新博主 约 8 次查询(查已有/upsert/history/快照/归属)
//   已收录 1 次查询(查一下就跳过)
// 按预算扣, 一批可以是"跳 40 个已知 + 收 4 个新的", 也可以是"只收 5 个新的",
// 都不会超出 Free 的上限。
const DEFAULT_QUERY_BUDGET = 42;
const MAX_QUERY_BUDGET = 900;
const COST_NEW = 8;
const COST_SKIP = 1;

// 站长的归属账号。migration 0003 把历史 700+ 条挂在它名下，
// 这里同步进来的新博主也归它，否则没有任何 blogger_owners 行 ->
// listAll() 的 EXISTS(public) 直接把它过滤掉，成为不可见的孤儿。
const ADMIN_OWNER = 'admin-legacy';

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  let body = {};
  try {
    body = await request.json();
  } catch { /* 允许空 body, 走库里存的凭据 */ }

  // 前端仍会带 ct0/authToken; 没带就用库里加密存的那份
  let creds;  // 请求体带了就用请求体的，否则用库里那份（两个分支必走其一）
  if (body?.ct0 && body?.authToken) {
    creds = { ct0: String(body.ct0).trim(), authToken: String(body.authToken).trim() };
  } else {
    creds = await getXCredentials(env);
  }
  if (!creds) return fail('尚未配置 X Cookie 凭据');

  const budget = Math.min(
    Math.max(parseInt(body?.queryBudget, 10) || DEFAULT_QUERY_BUDGET, 10),
    MAX_QUERY_BUDGET
  );
  // 只在**开新一轮**时生效; 续跑沿用状态里存的那个
  const wantMode = body?.mode === 'full' ? 'full' : 'incremental';

  const logs = [];
  const log = (m) => logs.push(m);

  try {
    // 拿自己的 userId —— Following 查询需要它
    let userId = await getSetting(env.DB, 'x_account_id');
    if (!userId) {
      const me = await verifyCredentials(creds, env);
      userId = me.id;
    }
    if (!userId) return fail('无法确定当前登录账号的 userId');

    // 默认 private：同步是批量拉进来的，先落成「仅站长可见」由站长挑选后再公开。
    // 用 private 而不是 is_blocked 来做这个筛选很关键 —— is_blocked 是 bloggers 表上的
    // 全局列，置 1 之后别人收录同一位博主也进不了公开画廊；private 只影响站长这一条归属。
    const defaultVisibility =
      (await getSetting(env.DB, 'sync_default_visibility')) === 'public' ? 'public' : 'private';
    log(`[INFO] 新收录的博主可见性: ${defaultVisibility === 'public' ? '公开' : '仅站长可见（待你在档案管理里公开）'}`);

    const prev = await env.DB.prepare(
      'SELECT cursor, cursor_offset, pass_scanned, pass_mode FROM sync_state WHERE id=1').first();
    const restart = body?.restart === true;
    const startCursor = restart ? null : (prev?.cursor || null);
    const startOffset = restart ? 0 : (prev?.cursor_offset || 0);
    // 有断点就算 resuming —— 游标为 null 但偏移 > 0 也算（停在第一页中间）
    const resuming = !restart && (!!startCursor || startOffset > 0);
    const mode = resuming ? (prev?.pass_mode || 'incremental') : wantMode;
    const fullPass = mode === 'full';
    let passScanned = resuming ? (prev?.pass_scanned || 0) : 0;

    await env.DB.prepare(
      `UPDATE sync_state SET running=1, current=0, new_fetched=0, error=NULL,
        started_at=?, finished_at=NULL, cursor=?, cursor_offset=?, pass_scanned=?, pass_mode=? WHERE id=1`
    ).bind(nowIso(), startCursor, startOffset, passScanned, mode).run();

    log(resuming
      ? `[RESUME] 从断点继续（此前已扫 ${passScanned} 位，页内偏移 ${startOffset}）`
      : `[START] ${fullPass ? '完整核对：走完整个关注列表' : '增量：只找最新的新关注'}`);
    log(`[INFO] 本批查询预算 ${budget} 次（新博主约 ${COST_NEW} 次 / 已收录跳过 ${COST_SKIP} 次）`);
    if (fullPass) {
      log('[INFO] 完整核对模式：已关闭「连续 3 位已知即停」，已在库的会被快速跳过');
    }

    const newUsers = [];
    let lastSeen = null;
    let spent = 0;
    let skipped = 0;
    let consecutiveKnown = 0;
    let stopReason = null;
    let saveCursor = startCursor;   // 断点：取到当前页所用的游标
    let saveOffset = startOffset;   // 断点：该页内已处理人数
    let exhausted = false;
    let firstPage = true;

    for await (const pg of iterateFollowingPages(creds, env, {
      userId, log, cursor: startCursor,
    })) {
      if (pg.staleCursor) {
        log('[WARN] 保存的断点已失效，已重置。下次点击会从最新关注重新开始。');
        // exhausted=true 会让下面的收尾逻辑把 cursor / offset / pass_scanned / pass_mode
        // 全部清空 —— 这是"卡死"的唯一出路，别改成保留断点
        exhausted = true;
        saveCursor = null; saveOffset = 0; passScanned = 0; stopReason = 'stale_cursor';
        break;
      }

      // 只有本轮**第一页**要跳过偏移；后续页从头开始
      const from = firstPage ? Math.min(startOffset, pg.users.length) : 0;
      firstPage = false;
      if (from > 0) log(`[SKIP] 本页前 ${from} 位已在上一批处理过，跳过（不消耗数据库查询）`);

      let stoppedMidPage = false;

      for (let i = from; i < pg.users.length; i++) {
        // 连"查一次是否在库"的预算都不够了 -> 停在这里
        if (spent + COST_SKIP > budget) {
          saveCursor = pg.pageCursor;   // 游标保持"取到本页的那个"
          saveOffset = i;               // 偏移记到 i
          stoppedMidPage = true;
          stopReason = 'budget';
          log(`[PAUSE] 预算用尽（${spent}/${budget}）：本批新增 ${newUsers.length} 位、跳过 ${skipped} 位在库的，停在本页第 ${i} 位。`);
          break;
        }

        const u = pg.users[i];
        lastSeen = { screen_name: u.screen_name, name: u.name, followers_count: u.followers_count };

        const known = await env.DB.prepare('SELECT 1 FROM bloggers WHERE id = ?')
          .bind(u.id).first();
        spent += COST_SKIP;
        passScanned++;

        if (known) {
          // 已在库的**直接跳过，不跑 upsertBlogger**（省约 5 次查询）。
          // 代价是不刷新已有档案 —— 那是 GitHub Actions 全量刷新的职责，
          // 增量同步从设计上只负责"发现新关注"（见文件头局限说明）。
          consecutiveKnown++;
          skipped++;
        } else {
          if (spent + COST_NEW > budget) {
            saveCursor = pg.pageCursor;
            saveOffset = i;   // 是 i 不是 i+1：这一位还没处理
            stoppedMidPage = true;
            stopReason = 'budget';
            log(`[PAUSE] 预算不足以再抓一位新博主（${spent}/${budget}），停在本页第 ${i} 位。`);
            break;
          }
          consecutiveKnown = 0;

          await upsertBlogger(env, u, log);
          // 归属行：ON CONFLICT DO NOTHING 保证不会把站长手动改过的可见性覆盖回默认值
          await env.DB.prepare(
            `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
             VALUES (?,?,?,?) ON CONFLICT DO NOTHING`
          ).bind(ADMIN_OWNER, u.id, defaultVisibility, nowIso()).run();
          spent += COST_NEW;

          newUsers.push({
            screen_name: u.screen_name,
            name: u.name,
            followers_count: u.followers_count,
            // 前端据此在日志里打 [R2 头像+封面已落库] 标记
            avatar_url: u.avatar_origin ? '/api/media' : '',
          });
          log(`[NEW] 抓取到新增博主: @${u.screen_name} (${u.name}) · 粉丝: ${u.followers_count}`);
        }

        // ⚠️「连续已知即停」只在增量模式下启用。完整核对时前面那段在库的
        // 恰恰是要跳过的部分，在这里停下来就是原来那个永远过不去的 bug。
        if (!fullPass && consecutiveKnown >= CONSECUTIVE_KNOWN_STOP) {
          log(`[CHECK] 增量核对到此为止：连续 ${CONSECUTIVE_KNOWN_STOP} 位已在库，说明已追平最新关注。`);
          log('[HINT] 想补历史（把更早的关注也拉进来）请用「完整核对」，它会走完整个列表并跳过在库的。');
          stopReason = 'incremental'; exhausted = true; stoppedMidPage = true;
          break;
        }
      }

      await env.DB.prepare('UPDATE sync_state SET current=?, last_item=?, pass_scanned=? WHERE id=1')
        .bind(passScanned, lastSeen ? JSON.stringify(lastSeen) : null, passScanned).run();

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

    const totalRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM bloggers').first();
    const total = totalRow?.n || 0;

    const finalCursor = exhausted ? null : saveCursor;
    const finalOffset = exhausted ? 0 : saveOffset;
    const savePass = exhausted ? 0 : passScanned;
    // has_more 必须同时看游标和偏移：停在第一页中间时 cursor 是 null 但 offset > 0
    const hasMore = !exhausted && (!!finalCursor || finalOffset > 0);

    await env.DB.prepare(
      `UPDATE sync_state SET running=0, new_fetched=?, total=?, finished_at=?,
        cursor=?, cursor_offset=?, pass_scanned=?, pass_mode=? WHERE id=1`
    ).bind(newUsers.length, total, nowIso(), finalCursor, finalOffset, savePass,
           exhausted ? null : mode).run();

    return json({
      success: true,
      has_more: hasMore,
      done: !hasMore,
      stop_reason: stopReason,
      resumed: resuming,
      mode,
      skipped,
      spent,
      budget,
      pass_scanned: passScanned,
      last_seen: lastSeen,
      // following 保留是为了兼容前端"模式 A"判定（Array.isArray(json.following)）
      following: newUsers,
      new_users: newUsers,
      new_count: newUsers.length,
      count: passScanned,
      total_db_count: total,
      is_incremental_stop: stopReason === 'incremental',
      default_visibility: defaultVisibility,
      r2_bound: !!env.MEDIA,
      logs,
    });
  } catch (err) {
    await env.DB.prepare(
      'UPDATE sync_state SET running=0, error=?, finished_at=? WHERE id=1'
    ).bind(err.message, nowIso()).run();
    return json({ success: false, error: err.message, logs }, 200);
  }
}
