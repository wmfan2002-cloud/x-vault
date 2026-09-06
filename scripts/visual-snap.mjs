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
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = 'public';
const OUT = '.visual';
const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const option = (name) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const sourceRef = option('ref');
const sceneFilter = option('only') ? new RegExp(option('only')) : null;
const strict = process.argv.includes('--strict');
const sourceCache = new Map();

async function asset(path) {
  // Generated archive data is not tracked; both revisions use the same local fixture.
  if (!sourceRef || path.startsWith('public/data/')) return readFile(path);
  if (!sourceCache.has(path)) sourceCache.set(path, execFileSync('git', ['show', `${sourceRef}:${path}`]));
  return sourceCache.get(path);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

/** 只服务 public/ 下的静态文件。绕开 functions/，所以 /admin.html 不经门禁，也不需要口令。 */
function serve() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/' || path === '') path = '/index.html';
    if (!extname(path)) path += '.html';
    try {
      const buf = await asset(join(ROOT, path));
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
async function fixtures(page, base, scene) {
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
  if (scene.admin) {
    await page.addInitScript(() => localStorage.setItem('x_archive_admin_token', 'visual-fixture'));
    const chartUrl = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
    const chartFile = join(OUT, 'chart-4.4.7.js');
    await page.route(chartUrl, async route => {
      if (!existsSync(chartFile)) {
        const response = await route.fetch();
        if (!response.ok()) throw new Error('Cannot load Chart.js for visual regression');
        await writeFile(chartFile, await response.body());
      }
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(chartFile) });
    });
    const bloggers = scene.empty ? [] : rows.map((row, i) => ({
      ...row, name: `Creator ${i + 1}`, verified: i % 3 === 0 ? 1 : 0,
      my_visibility: 'public', in_gallery: 1, is_blocked: i === 3 ? 1 : 0,
      total_clicks: 60 - i, clicks_card: 30, clicks_timeline: 10, clicks_roulette: 20 - i,
    }));
    await page.route('**/api/admin/**', route => {
      const url = new URL(route.request().url());
      const responses = {
        '/api/admin/check': { authenticated: true },
        '/api/admin/credentials': { success: true, hasCredentials: false },
        '/api/admin/visibility': { success: true, visibility: 'public' },
        '/api/admin/workflow-status': { success: true, is_active: false },
        '/api/admin/refetch-avatar': { success: true, remaining: 8, results: [] },
        '/api/admin/bloggers': {
          success: true, data: bloggers, total: bloggers.length, page: 1, limit: 30, totalPages: 1,
          stats: { total: bloggers.length, in_gallery: bloggers.length ? 23 : 0, blocked: bloggers.length ? 1 : 0, mine_private: 0 },
        },
        '/api/admin/analytics': {
          success: true,
          kpi: scene.empty ? {} : { total: 24, total_clicks: 1000, clicks_card: 600, clicks_timeline: 300, clicks_roulette: 100,
            followers_sum: 4500000, verified_pct: 33, snapshots: 120, blocked: 1, suspended: 1, verified: 8 },
          tiers: scene.empty ? {} : { t1m: 1, t500k: 2, t100k: 8, t10k: 10, tsmall: 3 },
          topClicked: bloggers.slice(0, 10), topFollowers: bloggers.slice(0, 10),
        },
      };
      return route.fulfill(json(responses[url.pathname] || { success: true, data: [] }));
    });
  }
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (scene.admin && p.startsWith('/api/admin/')) return route.fallback();
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
    if (scene.auth && p === '/api/auth/me') return route.fulfill(json({
      success: true,
      user: { id: 'visual-user', email: 'visual@example.com', display_name: 'Visual User', owned: 0, favorites: 0 },
    }));
    if (scene.auth && p === '/api/favorites') return route.fulfill(json({ success: true, data: [] }));
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
  { name: 'gallery-compact-desktop', path: '/', size: [1440, 900], act: ['.view-tab-btn[data-view="compact"]'] },
  { name: 'gallery-compact-mobile', path: '/', size: [390, 844], act: ['.view-tab-btn[data-view="compact"]'] },
  { name: 'gallery-favorite-desktop', path: '/', size: [1440, 900], auth: true },
  { name: 'gallery-favorite-mobile', path: '/', size: [390, 844], auth: true },
  { name: 'gallery-favorite-compact', path: '/', size: [1440, 900], auth: true, act: ['.view-tab-btn[data-view="compact"]'] },
  { name: 'gallery-resize-roundtrip', path: '/', size: [1440, 900], resizes: [[820, 1100], [390, 844], [1440, 900]] },
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
  ...[[1440, 900], [390, 844]].flatMap(size => {
    const device = size[0] === 390 ? 'mobile' : 'desktop';
    return [
      { name: `admin-live-analytics-${device}`, path: '/admin.html#analytics', admin: true, size, charts: true, settle: '#analytics-click-top-list .leaderboard-row' },
      { name: `admin-live-empty-${device}`, path: '/admin.html#analytics', admin: true, empty: true, size, charts: true, settle: '#analytics-click-top-list .blogger-list-empty' },
      { name: `admin-live-bloggers-${device}`, path: '/admin.html#bloggers', admin: true, size, settle: '#blogger-list-container .blogger-row' },
      { name: `admin-live-export-${device}`, path: '/admin.html#bloggers', admin: true, size, act: ['#btn-export-handles'], settle: '#modal-export-handles:not(.hidden)' },
      { name: `admin-live-add-${device}`, path: '/admin.html#bloggers', admin: true, size, act: ['#btn-add-blogger'], settle: '#modal-add-blogger:not(.hidden)' },
      { name: `admin-live-refetch-${device}`, path: '/admin.html#bloggers', admin: true, size, act: ['#btn-refetch-avatars'], settle: '#modal-refetch:not(.hidden)' },
    ];
  }),
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
  const scenes = SCENES.filter(scene => !sceneFilter || sceneFilter.test(scene.name));
  if (!scenes.length) throw new Error('No scenes matched --only');
  try {
  for (const scene of scenes) {
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
    await fixtures(page, base, scene);
    await page.goto(base + scene.path, { waitUntil: 'load' });
    if (scene.theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), scene.theme);
    // 管理台：门禁属于后端，这里直接把面板揭出来，只验样式
    if (scene.reveal) await page.evaluate(() => {
      document.getElementById('auth-gate-screen')?.classList.add('hidden');
      document.getElementById('admin-dashboard-screen')?.classList.remove('hidden');
    });
    if (scene.admin) await page.waitForSelector('#admin-dashboard-screen:not(.hidden)');
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
    if (scene.resizes) {
      const cardCount = await page.locator('.blogger-card').count();
      if (!cardCount) throw new Error('Resize scene requires populated cards');
      for (const [width, height] of scene.resizes) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        if (await page.locator('.blogger-card').count() !== cardCount) throw new Error('Resize lost loaded cards');
      }
    }
    if (scene.admin) {
      await page.evaluate(() => {
        const latency = document.getElementById('hud-d1-latency');
        latency.textContent = '18ms';
        latency.className = 'hud-latency-pill fast';
        // click() can scroll an overflowing panel horizontally before opening a modal.
        for (const element of document.body.querySelectorAll('*')) element.scrollLeft = 0;
      });
    }
    if (scene.charts) {
      await page.waitForFunction(() => Object.keys(window.Chart?.instances || {}).length === 3);
      await page.evaluate(() => {
        for (const chart of Object.values(window.Chart.instances)) {
          chart.stop();
          chart.update('none');
          if (!chart.ctx.getImageData(0, 0, chart.canvas.width, chart.canvas.height).data.some((value, i) => i % 4 === 3 && value)) {
            throw new Error(`Blank chart: ${chart.canvas.id}`);
          }
        }
      });
    }
    // 统一滚回顶部。点卡片会把页面滚走，而 fullPage 截图会把 fixed 元素画在当前滚动位置，
    // 两次跑滚动量不同就是几万像素的假差异。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    await page.evaluate(async () => {
      const entering = document.getAnimations().filter(animation =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.all(entering.map(animation => animation.finished.catch(() => {})));
    });
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
    let screenshot = await page.screenshot({ fullPage: true });
    let stable = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const next = await page.screenshot({ fullPage: true });
      if (screenshot.equals(next)) { stable = true; break; }
      screenshot = next;
    }
    if (!stable) throw new Error(`Unstable screenshot: ${scene.name}`);
    await writeFile(join(dir, `${scene.name}.png`), screenshot);
    await page.close();
    done++;
    process.stdout.write(`\r  采集 ${done}/${scenes.length} ${scene.name.padEnd(32)}`);
  }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n快照写入 ${dir}/（${done} 个场景，各一张 png + 一份计算样式）`);
}

const NUM = /-?\d*\.?\d+/g;
/**
 * 抖动 vs 实质变动。瀑布流按实测高度排布，亚像素舍入会让整列 y 差 1px，
 * 并顺着传进 radial-gradient 的圆心坐标 —— 同一份代码跑两次就有几百处这种差异。
 * 判定：非数字骨架完全相同，且每个数字相差不超过 1px。
 */
function jitter(prop, x, y) {
  if (strict || x === undefined || y === undefined) return false;
  if (prop === 'background-image') {
    const position = /^radial-gradient\(circle at (-?[\d.]+)px (-?[\d.]+)px(,.*)$/;
    const a = x.match(position), b = y.match(position);
    return !!(a && b && a[3] === b[3] && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1);
  }
  if (!['box', 'width', 'height', 'min-height', 'max-height', 'transform-origin'].includes(prop)) return false;
  const skeleton = (v) => String(v).replace(NUM, '#');
  if (skeleton(x) !== skeleton(y)) return false;
  const nx = String(x).match(NUM) || [];
  const ny = String(y).match(NUM) || [];
  return nx.length === ny.length && nx.every((v, i) => Math.abs(Number(v) - Number(ny[i])) <= 1);
}

async function diff(a, b) {
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;
  const dirA = join(OUT, a);
  const dirB = join(OUT, b);
  for (const d of [dirA, dirB]) if (!existsSync(d)) { console.error(`没有 ${d}，先 snap`); process.exit(1); }
  const names = [...new Set((await readdir(dirA)).concat(await readdir(dirB))
    .filter(f => /\.(png|json)$/.test(f)).map(f => f.replace(/\.(png|json)$/, '')))]
    .filter(name => !sceneFilter || sceneFilter.test(name)).sort();
  if (!names.length) throw new Error('No snapshot files to compare');

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
        // 默认只容忍 256 个栅格化边缘像素，仍输出真实计数；--strict 不容忍任何差异。
        if (n > (strict ? 0 : 256)) {
          badPix++;
          pixLine = `${n} (${(ratio * 100).toFixed(2)}%)`;
        } else pixLine = n ? `${n} 噪声` : '0';
      }
    } else badPix++;

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
        for (const p of new Set([...Object.keys(sa[k]), ...Object.keys(sb[k])])) {
          if (p === '_' || sa[k][p] === sb[k][p]) continue;
          (jitter(p, sa[k][p], sb[k][p]) ? soft : real).push([k, p, sa[k][p], sb[k][p], sa[k]._]);
        }
      }
      const fmt = (rows) => rows.map(([k, p, x, y, id]) => `${k}  ${id || ''}\n    ${p}: ${x}  ->  ${y}`).join('\n');
      if (real.length || soft.length) {
        await writeFile(join(OUT, `diff-${name}.txt`),
          `【实质变动 ${real.length} 处】\n${fmt(real)}\n\n【≤1px 抖动 ${soft.length} 处，可忽略】\n${fmt(soft)}\n`);
      }
      if (real.length) badStyle++;
      styleLine = real.length ? `${real.length} 处` : (soft.length ? `0（抖动 ${soft.length}）` : '0');
    } else badStyle++;
    console.log(`${name.padEnd(34)}${pixLine.padEnd(18)}${styleLine}`);
  }
  console.log('─'.repeat(58));
  if (!badPix && !badStyle) console.log('外观完全一致。\n');
  else console.log(`${badPix} 个场景像素有差异，${badStyle} 个场景样式有变动。明细见 ${OUT}/diff-*.png 与 ${OUT}/diff-*.txt\n`);
  if (badPix || badStyle) process.exitCode = 1;
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'snap' && x) await snap(x);
else if (cmd === 'diff' && x && y) await diff(x, y);
else {
  console.log(`用法:
  node scripts/visual-snap.mjs snap <标签>       采集一套快照到 ${OUT}/<标签>/
  node scripts/visual-snap.mjs diff <A> <B>      比对两套快照
  --only=<场景正则>  --ref=<Git 提交>（仅采集）  --strict（零像素/样式容差）

典型流程:
  node scripts/visual-snap.mjs snap before
  # 改 public/ 下的代码
  node scripts/visual-snap.mjs snap after
  node scripts/visual-snap.mjs diff before after`);
}
