#!/usr/bin/env node
/**
 * 外观回归网。重构 public/ 的每一步之前后各采一套快照，比对确认渲染没变。
 *
 *   node scripts/visual-snap.mjs snap before      # 改之前采基线
 *   ...改代码...
 *   node scripts/visual-snap.mjs snap after
 *   node scripts/visual-snap.mjs diff before after
 *
 * 两层网，缺一不可：
 *   截图    —— 人眼能看的证据，pixelmatch 给出差异像素数
 *   计算样式 —— 每个元素每条关键属性的最终值 + 盒子位置，文本可 diff。
 *              它能抓到截图抓不到的东西：transition/animation 被删、hover 态丢失、
 *              z-index 变化。2026-09-05 那次翻车就是这类损失，而当时 106 项测试全绿。
 *
 * 确定性靠三件事：内置静态服务器（不经 functions）、API 全部用固定桩数据、
 * Math.random 与 Date.now 定死。截图前才禁用动画 —— 顺序反了会把 transition 的
 * 真实值冲掉，那正是最需要盯的属性。
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const ROOT = 'public';
const OUT = '.visual';
const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

/** 只服务 public/ 下的静态文件。绕开 functions/，所以 /admin.html 不经门禁，也不需要口令。 */
function serve() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/' || path === '') path = '/index.html';
    if (!extname(path)) path += '.html';
    try {
      const buf = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

/**
 * 网络字体本地缓存。页面从 fonts.googleapis.com 取 Plus Jakarta Sans，
 * 每次跑的到达时机不同 —— 字体晚一点到，文字行高就用回落字体算，
 * 整列卡片会往下挪 2-4px，diff 里全是这种假变动。
 * 首次跑落盘，之后一律从盘里喂，既确定又能离线跑。
 */
async function fontCache(page) {
  const dir = join(OUT, '.fonts');
  await mkdir(dir, { recursive: true });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    const url = route.request().url();
    const base = join(dir, createHash('sha1').update(url).digest('hex'));
    if (!existsSync(base)) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': await page.evaluate(() => navigator.userAgent) } });
        await writeFile(base, Buffer.from(await res.arrayBuffer()));
        await writeFile(`${base}.type`, res.headers.get('content-type') || 'application/octet-stream');
      } catch {
        return route.abort();   // 拿不到就让页面回落到系统字体，至少两次跑是一致的
      }
    }
    return route.fulfill({ body: await readFile(base), contentType: await readFile(`${base}.type`, 'utf8') });
  });
}

/** 固定桩数据：真实数据会变（粉丝数、公告、今日精选），会把 diff 淹掉 */
async function fixtures(page, base) {
  const snapshot = JSON.parse(await readFile('public/data/archive.json', 'utf8'));
  const rows = (Array.isArray(snapshot) ? snapshot : snapshot.data || []).slice(0, 24).map((b, i) => ({
    ...b,
    followers_count: 100000 - i * 3137,
    statuses_count: 5000 - i * 71,
    friends_count: 900 - i * 13,
    avatar_url: '/logo-icon.png',
    banner_url: null,
    is_verified: i % 3 === 0 ? 1 : 0,
    is_suspended: i === 7 ? 1 : 0,
    created_at: '2020-03-04T05:06:07Z',
    updated_at: '2026-01-10T08:00:00Z',
  }));
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (p === '/api/archive') return route.fulfill(json({ success: true, data: rows, stats: { total: rows.length } }));
    if (p === '/api/media') return route.fulfill({ status: 302, headers: { location: `${base}/logo-icon.png` } });
    if (p === '/api/announcements') return route.fulfill(json({ success: true, data: [
      { id: 1, title: '归档站启用', body: '资料与头像开始持续留存。', level: 'info', is_pinned: 1, updated_at: '2026-01-05T00:00:00Z', created_at: '2026-01-05T00:00:00Z' },
      { id: 2, title: '同步窗口调整', body: '每日同步改到凌晨执行。', level: 'warn', is_pinned: 0, updated_at: '2026-01-08T00:00:00Z', created_at: '2026-01-08T00:00:00Z' },
    ] }));
    if (p === '/api/history') return route.fulfill(json({ success: true, data: [
      { field: 'name', old_value: '旧昵称', new_value: '新昵称', changed_at: '2026-01-02T00:00:00Z' },
      { field: 'avatar_url', old_value: 'a', new_value: 'b', changed_at: '2026-01-06T00:00:00Z' },
    ] }));
    if (p === '/api/tags' || p === '/api/my-bloggers' || p === '/api/favorites') return route.fulfill(json({ success: true, data: [] }));
    if (p.startsWith('/api/auth/') || p.startsWith('/api/admin/') || p.startsWith('/api/user/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
    return route.fulfill(json({ success: true, data: [] }));
  });
}

/** 每个场景 = 一个页面 + 视口 + 一串把界面摆到目标状态的动作 */
const SCENES = [
  { name: 'gallery-desktop', path: '/', size: [1440, 900] },
  { name: 'gallery-wide', path: '/', size: [1920, 1080] },
  { name: 'gallery-tablet', path: '/', size: [820, 1100] },
  { name: 'gallery-mobile', path: '/', size: [390, 844] },
  { name: 'gallery-light', path: '/', size: [1440, 900], theme: 'light' },
  { name: 'gallery-list-view', path: '/', size: [1440, 900], act: ['.view-tab-btn[data-view="list"]'] },
  { name: 'gallery-filter-hot', path: '/', size: [1440, 900], act: ['.f-pill[data-filter="hot"]'] },
  // 点卡片开抽屉。settle 等的是遮罩真的显示出来 —— 瀑布流在按实测高度重排，
  // 点击可能落在重排的空档里而整个丢掉，只 wait 抽屉元素查不出来（它一直在 DOM 里）。
  { name: 'inspector-drawer', path: '/', size: [1440, 900], act: ['.blogger-card'], wait: '#inspector-drawer', settle: '#inspector-backdrop:not(.hidden)' },
  // 抽卡转盘全程由 setTimeout 驱动（老虎机滚动，然后 140ms 落定、再 160ms 浮出操作栏），
  // 冻结动画管不到 JS 计时器。不等它走完，采样会撞在中途 —— 同一份代码两次跑，
  // 一次截到操作栏、一次没截到。settle 就是等这一刻。
  { name: 'roulette', path: '/', size: [1440, 900], act: ['#btn-lucky-pick'], wait: '#random-roulette-backdrop', settle: '.roulette-outside-actions.is-visible' },
  { name: 'auth-panel', path: '/', size: [1440, 900], act: ['#btn-open-auth'], wait: '#auth-backdrop' },
  { name: 'announcements', path: '/', size: [1440, 900], act: ['#btn-ann-center'], wait: '#anncenter-backdrop' },
  { name: 'admin-overview', path: '/admin.html', size: [1440, 900], reveal: true },
  { name: 'admin-bloggers', path: '/admin.html', size: [1440, 900], reveal: true, act: ['.admin-tab-btn[data-tab="bloggers"]'] },
  { name: 'admin-analytics', path: '/admin.html', size: [1440, 900], reveal: true, act: ['.admin-tab-btn[data-tab="analytics"]'] },
  { name: 'admin-announcements', path: '/admin.html', size: [1440, 900], reveal: true, act: ['.admin-tab-btn[data-tab="announcements"]'] },
  { name: 'admin-submissions', path: '/admin.html', size: [1440, 900], reveal: true, act: ['.admin-tab-btn[data-tab="submissions"]'] },
  { name: 'admin-gate', path: '/admin.html', size: [1440, 900] },
  { name: 'admin-mobile', path: '/admin.html', size: [390, 844], reveal: true },
  // 悬停态单独成景。style.css 里有 115 处 :hover，默认状态的快照一条都盖不到
  { name: 'hover-card', path: '/', size: [1440, 900], hover: '.blogger-card' },
  { name: 'hover-header-btn', path: '/', size: [1440, 900], hover: '#btn-lucky-pick' },
  { name: 'hover-filter-pill', path: '/', size: [1440, 900], hover: '.f-pill[data-filter="new"]' },
  { name: 'hover-admin-tab', path: '/admin.html', size: [1440, 900], reveal: true, hover: '.admin-tab-btn[data-tab="bloggers"]' },
];

/** 采计算样式的属性白名单。全量 340 条属性会让 JSON 大到没法读，这些是重构真正会碰坏的 */
const PROPS = [
  'display', 'position', 'visibility', 'opacity', 'z-index', 'overflow', 'cursor', 'pointer-events',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'padding', 'inset', 'box-sizing',
  'color', 'background-color', 'background-image', 'background-size', 'background-position',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode', 'transform', 'transform-origin',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'text-overflow', '-webkit-line-clamp',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self',
  'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
];

/** 动效属性另采一遍。冻结动画会把这些值冲成 0s，而它们正是最需要盯的 —— 单独在冻结前取 */
const MOTION_PROPS = [
  'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
  'animation-name', 'animation-duration', 'animation-timing-function', 'animation-iteration-count', 'animation-fill-mode',
];

/**
 * 冻结动效，让渲染停在一个确定的状态。
 *   动画 —— 时长压到 1ms、延迟设成负值、只跑一轮、fill-mode 强制 forwards：
 *           入场动画（抽屉滑入、卡片渐显）直接停在终态；旋转类无限动画的终态是
 *           rotate(360deg)，等于原位，同样确定。不能直接 animation:none ——
 *           入场动画的可见状态是靠 forwards 撑住的，去掉动画卡片会变回透明。
 *   过渡 —— 整个去掉，元素立刻跳到目标值，不会被采到半路。
 */
const FREEZE = `*, *::before, *::after {
  animation-delay: -1ms !important; animation-duration: 1ms !important;
  animation-iteration-count: 1 !important; animation-fill-mode: forwards !important;
  transition: none !important; caret-color: transparent !important;
}`;

async function collect(page, props, base) {
  const raw = await page.evaluate((keys) => {
    /** 元素的稳定身份：从 body 起的标签+序号路径，附上 id 与 class 便于人读 */
    const key = (el) => {
      const parts = [];
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const idx = [...n.parentElement.children].indexOf(n) + 1;
        parts.unshift(`${n.tagName.toLowerCase()}:${idx}`);
      }
      return parts.join('>');
    };
    const out = {};
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const row = { _: `${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` };
      // 相对文档而不是相对视口：滚动位置在两次跑之间会差几百像素，会把 diff 淹掉
      row.box = [Math.round(r.x + window.scrollX), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)].join(' ');
      // 叶子节点的文字也记下来。两个作用：数字滚动动画没跑完时稳定性等待能察觉，
      // 以及重写标记时文案被改掉会被当成实质变动报出来。
      if (!el.firstElementChild) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (t) row.text = t.slice(0, 120);
      }
      for (const k of keys) row[k] = cs.getPropertyValue(k);
      out[key(el)] = row;
    }
    return out;
  }, props);
  return JSON.parse(JSON.stringify(raw).replaceAll(base, '@origin'));
}

async function snap(label) {
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}`;
  const dir = join(OUT, label);
  await mkdir(dir, { recursive: true });
  // 关掉次像素级文字渲染：LCD 子像素抗锯齿会在字形边缘留下彩色描边，
  // 文字位置差三分之一个像素，描边颜色就完全不同（灰 11,11,11 变成 77,29,52），
  // 肉眼看不出来，pixelmatch 却会报上千个点。
  const browser = await chromium.launch({
    args: ['--disable-lcd-text', '--disable-font-subpixel-positioning', '--disable-partial-raster'],
  });
  let done = 0;
  for (const scene of SCENES) {
    const page = await browser.newPage({ viewport: { width: scene.size[0], height: scene.size[1] }, deviceScaleFactor: 1 });
    await page.addInitScript(({ now }) => {
      // 返回常数，而不是种子序列。序列版本挡不住干扰：粒子背景每帧都在消耗随机数，
      // 等抽卡转盘去取时，序列已经被推进了不确定的步数，两次跑抽出来的中奖者就不一样。
      // 常数与调用次数无关，谁先谁后都拿到同一个值。
      Math.random = () => 0.42;
      const Real = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends Real { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
      Date.UTC = Real.UTC; Date.parse = Real.parse;
    }, { now: FIXED_NOW });
    await fontCache(page);
    await fixtures(page, base);
    await page.goto(base + scene.path, { waitUntil: 'load' });
    if (scene.theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), scene.theme);
    // 管理台：门禁属于后端，这里直接把面板揭出来，只验样式
    if (scene.reveal) await page.evaluate(() => {
      document.getElementById('auth-gate-screen')?.classList.add('hidden');
      document.getElementById('admin-dashboard-screen')?.classList.remove('hidden');
    });
    for (const sel of scene.act || []) {
      const el = page.locator(sel).first();
      if (!(await el.count())) continue;
      await el.click({ timeout: 5000 }).catch(() => {});
      // 声明了 settle 的场景：点击可能被重排吞掉，没生效就重试几次
      if (scene.settle) {
        for (let i = 0; i < 4; i++) {
          if (await page.locator(scene.settle).count()) break;
          await page.waitForTimeout(300);
          await el.click({ timeout: 5000 }).catch(() => {});
        }
      }
    }
    if (scene.wait) await page.waitForSelector(scene.wait, { state: 'visible', timeout: 5000 }).catch(() => {});
    if (scene.settle) {
      // 等不到就直接失败。静默采一张「界面还没就绪」的快照，会在下一次比对里
      // 变成一堆看不懂的差异 —— 那正是 inspector-drawer 出过的问题。
      try {
        await page.waitForSelector(scene.settle, { timeout: 20000 });
      } catch {
        throw new Error(`场景 ${scene.name}: 等不到 ${scene.settle}，界面没到目标状态，快照作废`);
      }
    }
    if (scene.hover) {
      const target = page.locator(scene.hover).first();
      if (await target.count()) {
        // 悬停两次，第二次落在元素内的固定偏移上。只 hover 一次的话，卡片的聚光跟随
        // 靠的那一下 mousemove 可能赶在重排里丢掉 —— 于是渐变圆心一次有、一次没有。
        await target.hover({ timeout: 5000 }).catch(() => {});
        await target.hover({ position: { x: 30, y: 30 }, timeout: 5000 }).catch(() => {});
      }
    }
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForLoadState('networkidle').catch(() => {});
    // 统一滚回顶部。点卡片会把页面滚走，而 fullPage 截图会把 fixed 元素画在当前滚动位置，
    // 两次跑滚动量不同就是几万像素的假差异。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    // 动效属性必须在冻结之前采，冻结会把 transition-duration 冲成 0s
    const motion = await collect(page, MOTION_PROPS, base);
    await page.addStyleTag({ content: FREEZE });
    // 冻结之后等页面真正静下来：动画走到终态、异步取色与时间线渲染完成。
    // 不等就会采到中途值，两次跑同样的代码也对不上。
    let styles = null;
    for (let i = 0; i < 26; i++) {
      const now = await collect(page, PROPS, base);
      if (styles && JSON.stringify(styles) === JSON.stringify(now)) break;
      styles = now;
      await page.waitForTimeout(250);
    }
    // 只把动效属性并回去。整行并会把冻结前的 box 覆盖上来 —— 那是动画半路的盒子，
    // 每次跑都不一样（旋转中的方块外接矩形会变大）。
    for (const k of Object.keys(styles)) {
      if (!motion[k]) continue;
      for (const prop of MOTION_PROPS) styles[k][prop] = motion[k][prop];
    }
    await writeFile(join(dir, `${scene.name}.json`), JSON.stringify(styles, null, 0));
    // 粒子背景是 canvas 上按帧画的，帧数对不齐就是几千个点的差异，而它的计算样式一模一样。
    // canvas 里画的东西本来就不是像素比对能守的东西，截图时藏掉；它自己的尺寸、位置、
    // 透明度仍然在上面的计算样式里被盯着。
    await page.addStyleTag({ content: '#bg-particles-canvas { visibility: hidden !important; }' });
    await page.screenshot({ path: join(dir, `${scene.name}.png`), fullPage: true, animations: 'disabled' });
    await page.close();
    done++;
    process.stdout.write(`\r  采集 ${done}/${SCENES.length} ${scene.name.padEnd(24)}`);
  }
  await browser.close();
  server.close();
  console.log(`\n快照写入 ${dir}/（${done} 个场景，各一张 png + 一份计算样式）`);
}

const NUM = /-?\d*\.?\d+/g;
/**
 * 抖动 vs 实质变动。瀑布流按实测高度排布，亚像素舍入会让整列 y 差 1px，
 * 并顺着传进 radial-gradient 的圆心坐标 —— 同一份代码跑两次就有几百处这种差异。
 * 判定：非数字骨架完全相同，且每个数字相差不超过 1px。
 */
function jitter(x, y) {
  if (x === undefined || y === undefined) return true;   // 一侧没采到（DOM 在两遍采样之间变了），不作数
  const skeleton = (v) => String(v).replace(NUM, '#');
  if (skeleton(x) !== skeleton(y)) return false;
  const nx = String(x).match(NUM) || [];
  const ny = String(y).match(NUM) || [];
  return nx.every((v, i) => Math.abs(Number(v) - Number(ny[i])) <= 1);
}

async function diff(a, b) {
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;
  const dirA = join(OUT, a);
  const dirB = join(OUT, b);
  for (const d of [dirA, dirB]) if (!existsSync(d)) { console.error(`没有 ${d}，先 snap`); process.exit(1); }
  const names = [...new Set((await readdir(dirA)).concat(await readdir(dirB)))]
    .filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();

  let badPix = 0, badStyle = 0;
  console.log(`\n${a} -> ${b}\n`);
  console.log('场景                      差异像素      实质样式变动');
  console.log('─'.repeat(58));
  for (const name of names) {
    let pixLine = '缺文件';
    const pa = join(dirA, `${name}.png`), pb = join(dirB, `${name}.png`);
    if (existsSync(pa) && existsSync(pb)) {
      const ia = PNG.sync.read(await readFile(pa));
      const ib = PNG.sync.read(await readFile(pb));
      if (ia.width !== ib.width || ia.height !== ib.height) {
        pixLine = `尺寸变了 ${ia.width}x${ia.height}->${ib.width}x${ib.height}`;
        badPix++;
      } else {
        const out = new PNG({ width: ia.width, height: ia.height });
        const n = pixelmatch(ia.data, ib.data, out.data, ia.width, ia.height, { threshold: 0.1 });
        const ratio = n / (ia.width * ia.height);
        if (n > 0) await writeFile(join(OUT, `diff-${name}.png`), PNG.sync.write(out));
        // 像素层只当粗筛，地板放到 1.2 万点。
        //
        // 为什么这么松：中文字形的栅格化在两次跑之间就是不稳的 —— 同一段文字、同一个字体、
        // 同一个盒子位置，边缘像素照样能差上万点（实测 9088，通道差最大 137）。
        // 已经关掉了次像素定位与 LCD 抗锯齿，剩下的这部分压不掉。
        //
        // 所以精确检查全靠计算样式那一层：它是零容差的，68 条属性 + 盒子 + 文案，
        // 删一条 backdrop-filter 都会被点名。像素层只负责抓样式层看不见的东西 ——
        // 背景图整块换掉、层叠顺序变了导致元素被盖住之类，那些是十万点量级。
        if (n > 12000) {
          badPix++;
          pixLine = `${n} (${(ratio * 100).toFixed(2)}%)`;
        } else pixLine = n ? `${n} 噪声` : '0';
      }
    }

    let styleLine = '缺文件';
    const ja = join(dirA, `${name}.json`), jb = join(dirB, `${name}.json`);
    if (existsSync(ja) && existsSync(jb)) {
      const sa = JSON.parse(await readFile(ja, 'utf8'));
      const sb = JSON.parse(await readFile(jb, 'utf8'));
      const real = [];
      const soft = [];
      for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
        if (!sa[k]) { real.push([k, '新增元素', '', sb[k]._]); continue; }
        if (!sb[k]) { real.push([k, '元素消失', sa[k]._, '']); continue; }
        for (const p of Object.keys(sa[k])) {
          if (p === '_' || sa[k][p] === sb[k][p]) continue;
          (jitter(sa[k][p], sb[k][p]) ? soft : real).push([k, p, sa[k][p], sb[k][p], sa[k]._]);
        }
      }
      const fmt = (rows) => rows.map(([k, p, x, y, id]) => `${k}  ${id || ''}\n    ${p}: ${x}  ->  ${y}`).join('\n');
      if (real.length || soft.length) {
        await writeFile(join(OUT, `diff-${name}.txt`),
          `【实质变动 ${real.length} 处】\n${fmt(real)}\n\n【≤1px 抖动 ${soft.length} 处，可忽略】\n${fmt(soft)}\n`);
      }
      if (real.length) badStyle++;
      styleLine = real.length ? `${real.length} 处` : (soft.length ? `0（抖动 ${soft.length}）` : '0');
    }
    console.log(`${name.padEnd(26)}${pixLine.padEnd(14)}${styleLine}`);
  }
  console.log('─'.repeat(58));
  if (!badPix && !badStyle) console.log('外观完全一致。\n');
  else console.log(`${badPix} 个场景像素有差异，${badStyle} 个场景样式有变动。明细见 ${OUT}/diff-*.png 与 ${OUT}/diff-*.txt\n`);
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'snap' && x) await snap(x);
else if (cmd === 'diff' && x && y) await diff(x, y);
else {
  console.log(`用法:
  node scripts/visual-snap.mjs snap <标签>       采集一套快照到 ${OUT}/<标签>/
  node scripts/visual-snap.mjs diff <A> <B>      比对两套快照

典型流程:
  node scripts/visual-snap.mjs snap before
  # 改 public/ 下的代码
  node scripts/visual-snap.mjs snap after
  node scripts/visual-snap.mjs diff before after`);
}
