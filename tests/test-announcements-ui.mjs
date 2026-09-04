/**
 * 公告已读 / 红点 的前端测试：真实的 index.html + app.js 跑在 jsdom 里。
 *
 *   node tests/test-announcements-ui.mjs
 *
 * 覆盖的核心语义：
 *   1. 有未读公告 -> 铃铛红点亮
 *   2. 点铃铛打开公告中心 -> 红点消失（原来的 bug：置顶公告让红点永远消不掉）
 *   3. 已读状态跨刷新保持 —— 但**置顶公告的横幅仍然重新出现**
 *      （这两件事是独立状态，站长明确要求置顶横幅每次都显示）
 *   4. 在横幅上关闭 -> 也算已读
 *   5. 管理员改了公告内容（updated_at 变）-> 重新变未读
 *   6. 打开面板的这一次仍能看出哪几条是新的（未读标记在标记已读之前渲染）
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html0 = readFileSync('public/index.html', 'utf8');
const appSrc = readFileSync('public/app.js', 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (fn()) return; } catch { /* 再等等 */ }
    await sleep(25);
  }
  throw new Error('等待超时: ' + label);
}

let pass = 0, failCount = 0;
const fails = [];
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { failCount++; fails.push(label); console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
};

const ann = (id, { pinned = 0, updated_at = '2026-09-01T00:00:00Z', level = 'info' } = {}) => ({
  id, title: `公告${id}`, body: `正文${id}`, level, pinned,
  created_at: '2026-09-01T00:00:00Z', updated_at,
});

// localStorage 要跨"刷新"保持 —— 用一个共享对象模拟同一个浏览器
const makeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _dump: () => Object.fromEntries(m),
  };
};

const buildDom = async (anns, store, { waitForBell = true } = {}) => {
  const html = html0.replace(/<script[^>]*app\.js[^>]*><\/script>/, '')
    .replace('</body>', `<script>${appSrc.replace(/<\/script>/g, '<\\/script>')}</script></body>`);

  const dom = new JSDOM(html, {
    url: 'http://localhost:8788/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      const anyStub = new Proxy(function () {}, {
        get: (t, p) => {
          if (p === Symbol.toPrimitive) return () => 0;
          if (p === 'data') return new Uint8ClampedArray(4);
          return anyStub;
        },
        apply: () => anyStub,
        set: () => true,
      });
      window.HTMLCanvasElement.prototype.getContext = () => anyStub;
      window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollTo = function () {};

      // 用共享 store 覆盖 jsdom 自带的 localStorage，模拟"同一个浏览器再打开一次"
      Object.defineProperty(window, 'localStorage', { value: store, configurable: true });

      window.fetch = (input) => {
        const u = String(input).replace(/^https?:\/\/[^/]+/, '');
        let body = { success: true, data: [] };
        if (u === '/api/announcements') body = { success: true, data: anns };
        else if (u === '/api/auth/me') body = { success: true, user: null };
        else if (u === '/data/archive.json' || u === '/api/archive') body = { success: true, data: [] };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      };
    },
  });
  // 公告是异步拉的，等铃铛渲染完
  if (waitForBell) {
    await waitFor(() => !dom.window.document.getElementById('btn-ann-center').classList.contains('hidden'),
      '铃铛出现');
  } else {
    await sleep(250);   // 无公告的场景没有可等的状态变化，只能给足时间让请求落地
  }
  return dom;
};

const dotHidden = (d) => d.window.document.getElementById('ann-bell-dot').classList.contains('hidden');
const barHidden = (d) => d.window.document.getElementById('ann-bar').classList.contains('hidden');

// ══ 1. 置顶公告：红点该能消掉（原 bug 的核心）══
console.log('[1] 置顶公告的红点可以消除');
const store = makeStore();
const anns = [ann('a1', { pinned: 1 }), ann('a2')];
let dom = await buildDom(anns, store);
let doc = dom.window.document;

eq(dotHidden(dom), false, '有未读 -> 红点亮');
eq(doc.getElementById('btn-ann-center').title.includes('2 条未读'), true, 'title 报出未读数');
eq(barHidden(dom), false, '横幅显示');

doc.getElementById('btn-ann-center').click();
await waitFor(() => !doc.getElementById('anncenter-backdrop').classList.contains('hidden'), '公告中心打开');
eq(doc.querySelectorAll('.anncenter-item').length, 2, '公告中心列出全部 2 条');
eq(doc.querySelectorAll('.anncenter-item.is-unread').length, 2,
  '这一次仍标出 2 条未读（标记已读发生在渲染之后）');
eq(dotHidden(dom), true, '点开公告中心 -> 红点消失（置顶公告不再被算作恒定未读）');
eq(doc.getElementById('btn-ann-center').title.includes('未读'), false, 'title 不再提未读');
dom.window.close();

// ══ 2. 已读跨刷新保持；但置顶横幅仍要重新出现 ══
console.log('\n[2] 刷新之后：红点不回来，置顶横幅照常出现');
dom = await buildDom(anns, store);   // 同一个 store = 同一个浏览器重开
doc = dom.window.document;
eq(dotHidden(dom), true, '红点保持消失（已读写进了 localStorage）');
eq(barHidden(dom), false, '置顶公告的横幅重新出现（站长明确要求，与已读无关）');
eq(doc.querySelectorAll('.anncenter-item.is-unread').length, 0, '公告中心里不再有未读标记');
dom.window.close();

// ══ 3. 管理员改了内容 -> 重新变未读 ══
console.log('\n[3] 公告内容更新后重新提醒');
const bumped = [ann('a1', { pinned: 1, updated_at: '2026-09-05T00:00:00Z' }), ann('a2')];
dom = await buildDom(bumped, store);
eq(dotHidden(dom), false, 'updated_at 变了 -> 重新算未读，红点再亮');
eq(dom.window.document.querySelectorAll('.anncenter-item.is-unread').length, 0,
  '面板还没打开，未读标记尚未渲染');
dom.window.document.getElementById('btn-ann-center').click();
await sleep(60);
eq(dotHidden(dom), true, '再点一次 -> 又变已读');
dom.window.close();

// ══ 4. 在横幅上关闭也算已读 ══
console.log('\n[4] 横幅上的关闭按钮同时标记已读');
const store2 = makeStore();
dom = await buildDom([ann('b1')], store2);   // 非置顶，单条
doc = dom.window.document;
eq(dotHidden(dom), false, '初始未读');
doc.getElementById('ann-close').click();
await waitFor(() => barHidden(dom), '横幅关闭');
eq(dotHidden(dom), true, '关掉横幅 -> 红点也消失（看过了）');
dom.window.close();

// 非置顶公告关掉后，刷新不该再出现横幅
dom = await buildDom([ann('b1')], store2);
eq(barHidden(dom), true, '非置顶公告关掉后刷新不再显示横幅');
eq(dotHidden(dom), true, '红点也仍然是灭的');
dom.window.close();

// ══ 5. 没有公告时铃铛整个隐藏 ══
// buildDom 会等铃铛出现，这里恰恰要验证它**不出现**，所以不能复用它
console.log('\n[5] 无公告');
const dom5 = await buildDom([], makeStore(), { waitForBell: false });
eq(dom5.window.document.getElementById('btn-ann-center').classList.contains('hidden'), true, '没有公告 -> 铃铛隐藏');
eq(dom5.window.document.getElementById('ann-bell-dot').classList.contains('hidden'), true, '红点也隐藏');
eq(dom5.window.document.getElementById('ann-bar').classList.contains('hidden'), true, '横幅也隐藏');
dom5.window.close();

console.log(`\n════════ ${pass} 通过 / ${failCount} 失败 ════════`);
if (failCount) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
