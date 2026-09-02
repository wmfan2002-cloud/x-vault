#!/usr/bin/env node
/**
 * 批量补回头像 —— 把 324 条"只剩死 R2 key"的记录逐个去 X 重新取图。
 *
 * 循环调用 POST /api/admin/refetch-avatar（单次上限 25 个），带节奏，可断点续跑。
 *
 * 用法:
 *   node scripts/refetch-avatars.mjs --password=<管理员密码> [选项]
 *
 * 选项:
 *   --base=http://localhost:8788    目标站点
 *   --user=admin                    管理员用户名
 *   --source=x|unavatar             取图来源，默认 x（需已在管理台配好 Cookie）
 *   --batch=8                       单次数量（上限 8，受 Workers 子请求限额约束）
 *   --delay=8000                    批间隔 ms（X 对单账号查询限流较紧，别调太低）
 *   --max=0                         最多处理多少个，0 = 直到补完
 *   --handles=a,b,c                 只处理指定 handle
 */
const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const BASE = arg('base', 'http://localhost:8788').replace(/\/$/, '');
const USER = arg('user', 'admin');
const PASSWORD = arg('password', process.env.ADMIN_PASSWORD || '');
const SOURCE = arg('source', 'x');
const BATCH = Math.min(parseInt(arg('batch', '8'), 10) || 8, 8);
const DELAY = parseInt(arg('delay', '8000'), 10) || 8000;
const MAX = parseInt(arg('max', '0'), 10) || 0;
const HANDLES = arg('handles', '').split(',').map((s) => s.trim()).filter(Boolean);

if (!PASSWORD) {
  console.error('缺少 --password=<管理员密码>（或设置环境变量 ADMIN_PASSWORD）');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
});
const loginJson = await login.json().catch(() => ({}));
if (!loginJson?.token) {
  console.error(`登录失败: ${loginJson?.error || login.status}`);
  process.exit(1);
}
const TOKEN = loginJson.token;
console.log(`已登录 ${BASE}，来源=${SOURCE}\n`);

const tally = { ok: 0, tombstoned: 0, failed: 0, processed: 0 };
let round = 0;
let rateLimitStreak = 0;

while (true) {
  round++;
  const payload = HANDLES.length
    ? { screen_names: HANDLES.slice(tally.processed, tally.processed + BATCH), source: SOURCE }
    : { all_missing: true, limit: BATCH, source: SOURCE };

  if (HANDLES.length && !payload.screen_names.length) break;

  let res, data;
  try {
    res = await fetch(`${BASE}/api/admin/refetch-avatar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: JSON.stringify(payload),
    });
    data = await res.json();
  } catch (err) {
    console.error(`第 ${round} 批请求异常: ${err.message} —— 稍后重试`);
    await sleep(DELAY * 2);
    continue;
  }

  if (!data?.success) {
    console.error(`第 ${round} 批失败: ${data?.error || res.status}`);
    break;
  }

  const rows = data.results || [];
  if (!rows.length) {
    console.log('没有需要补图的记录了。');
    break;
  }

  for (const r of rows) {
    tally.processed++;
    if (r.status === 'ok') {
      tally.ok++;
      console.log(`  ✓ @${r.screen_name}  ${r.avatar_key}`);
    } else if (r.status === 'tombstoned') {
      tally.tombstoned++;
      console.log(`  † @${r.screen_name}  ${r.message}`);
    } else if (r.status === 'rate_limited') {
      // 不计入失败：这条只是没轮到，冷却后会重新出现在"待补"里
      tally.processed--;
      console.log(`  ⏸ @${r.screen_name}  命中速率限制，本批中止`);
    } else {
      tally.failed++;
      console.log(`  ✗ @${r.screen_name}  ${r.status}: ${r.message || ''}`);
    }
  }

  console.log(`第 ${round} 批完成 · 累计 成功 ${tally.ok} / 墓碑 ${tally.tombstoned} / 失败 ${tally.failed} · 剩余待补 ${data.remaining}\n`);

  if (MAX && tally.processed >= MAX) { console.log(`已达 --max=${MAX}，停止。`); break; }
  if (!HANDLES.length && data.remaining === 0) break;

  // 服务端报速率限制 -> 长睡等窗口重置，而不是接着打。
  // 连续多轮都被限就退出，让你换个时间再跑（游标式的"剩余待补"保证能续）。
  if (data.rate_limited) {
    rateLimitStreak++;
    if (rateLimitStreak >= 3) {
      console.log('连续 3 轮命中速率限制，退出。稍后重跑即可从剩余部分继续。');
      break;
    }
    const cool = 15 * 60 * 1000 * rateLimitStreak;
    console.log(`命中 X 速率限制，冷却 ${cool / 60000} 分钟后继续...\n`);
    await sleep(cool);
    continue;
  }
  rateLimitStreak = 0;

  await sleep(DELAY);
}

console.log('=== 汇总 ===');
console.log(`  成功补回  ${tally.ok}`);
console.log(`  已墓碑    ${tally.tombstoned}  (账号已消失，头像无法取回)`);
console.log(`  失败      ${tally.failed}`);
console.log('\n补完后建议重新生成静态快照: node scripts/generate-snapshot.mjs --local');

