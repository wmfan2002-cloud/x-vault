/**
 * POST /api/track-click   批量点击埋点
 *
 * 契约见 _reference/spec/03-api-contract.md §3.4
 *
 * 真实 body 形状 (从 app.js:354-368 的离线队列结构反推, 不是猜的):
 *   { batch: [ { screen_name: "Anaimiya", card: 1, timeline: 2, roulette: 0, total: 3 }, ... ] }
 * 注意:
 *   - 按 screen_name 定位, 不是 id
 *   - 每项自带三个面的累加量, 不是"一次点击一条事件"
 *   - total 是客户端算的冗余值, 服务端不采信, 按三个面各自累加
 *
 * 客户端行为 (app.js:391-410) 决定两条硬约束:
 *   1. 只有响应 {success:true} 客户端才销毁本地队列 —— 提前返回成功会丢数据
 *   2. 返回失败是安全的: 客户端保留队列, 15s 节流后重发
 */
import { ok, fail } from '../_lib/http.js';
import { rateLimit, clientIp } from '../_lib/ratelimit.js';

// 这是全站第二个"未鉴权写入"入口（第一个是 /api/submit，那边有表级限流）。
// 点击数只是统计资产，收紧的代价近乎为零，所以三道护栏都往死里收：
//   1. 请求级限流 —— 正常客户端 15s 节流一批（约 4 次/分钟），60 次/分钟已很宽裕
//   2. 单批上限 100 条（原 1000）—— D1 每次 batch 都算写配额
//   3. 每条事件每面 clamp 到 100（原 10000）、合并后每个 handle 每请求最多 +500 ——
//      不收紧的话一个请求就能给一位博主刷出 3000 万次"点击"
const clamp = (v) => Math.min(Math.max(parseInt(v ?? 0, 10) || 0, 0), 100);
const MAX_PER_HANDLE_PER_REQ = 500;

export async function onRequestPost({ request, env }) {
  if (!rateLimit('track-click', clientIp(request), 60, 60_000)) {
    return fail('点击上报过于频繁，请稍后再试', 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const batch = Array.isArray(body?.batch) ? body.batch : null;
  if (!batch || !batch.length) return fail('batch 为空');
  if (batch.length > 100) return fail('单批上限 100 条');

  // 同一 handle 可能出现多次, 先在内存合并
  const merged = new Map();
  for (const e of batch) {
    const handle = String(e?.screen_name || '').trim();
    if (!handle) continue;
    const card = clamp(e.card);
    const timeline = clamp(e.timeline);
    const roulette = clamp(e.roulette);
    if (!card && !timeline && !roulette) continue;

    const k = handle.toLowerCase();
    const cur = merged.get(k) || { card: 0, timeline: 0, roulette: 0 };
    cur.card += card;
    cur.timeline += timeline;
    cur.roulette += roulette;
    merged.set(k, cur);
  }
  if (!merged.size) return fail('没有可记录的有效事件');

  // screen_name 在库里是 UNIQUE, 但大小写可能与客户端队列 key 不一致 -> 用 LOWER() 匹配
  const stmts = [];
  for (const [handle, c] of merged) {
    stmts.push(
      env.DB.prepare(
        `UPDATE bloggers
            SET clicks_card = clicks_card + ?1,
                clicks_timeline = clicks_timeline + ?2,
                clicks_roulette = clicks_roulette + ?3
          WHERE LOWER(screen_name) = ?4`
      ).bind(Math.min(c.card, MAX_PER_HANDLE_PER_REQ),
             Math.min(c.timeline, MAX_PER_HANDLE_PER_REQ),
             Math.min(c.roulette, MAX_PER_HANDLE_PER_REQ), handle)
    );
  }

  try {
    await env.DB.batch(stmts);
    return ok({ counted: merged.size });
  } catch (err) {
    return fail(`记录失败: ${err.message}`, 500);
  }
}
