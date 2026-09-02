/**
 * 「取消收录」前端测试：把真实的 index.html + app.js 跑在 jsdom 里。
 *
 *   node tests/test-uncollect-ui.mjs
 *
 * mock 掉 window.fetch（按 方法+路径 路由，调用有日志），不 mock 业务代码。
 * 覆盖：按钮只在「我的收录」出现、确认框取消不发请求、点确认发 DELETE、
 * 服务端返回后卡片就地消失 + 副标题统计重算、失败提示、批量取消收录。
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

// ── mock 数据 ──
const mk = (id, handle, visibility) => ({
  id, screen_name: handle, name: handle.toUpperCase(), followers_count: 1000,
  description: '', verified: 0, is_blocked: 0, is_suspended: 0,
  clicks_card: 0, clicks_timeline: 0, clicks_roulette: 0, total_clicks: 0,
  backed_up_at: '2026-01-01T00:00:00Z', last_synced_at: null,
  avatar_url: '', cover_url: '', tag_ids: [], visibility,
});
const myData = [mk('1', 'alice', 'public'), mk('2', 'bob', 'private'), mk('3', 'carol', 'public')];

const buildDom = async (url, archiveData = []) => {
  const html = html0.replace(/<script[^>]*app\.js[^>]*><\/script>/, '')
    .replace('</body>', `<script>${appSrc.replace(/<\/script>/g, '<\\/script>')}</script></body>`);

  const dom = new JSDOM(html, {
    url: 'http://localhost:8788' + url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // beforeParse 在任何脚本执行前跑 —— 启动期的那批 fetch（auth/me、my-bloggers）
    // 必须已经被 mock 住，否则拿到空数据就不会再渲染卡片了。
    beforeParse(window) {
      // jsdom 没有 canvas 2d 上下文；首页背景粒子动画在启动时就要 getContext。
      // 给一个"调用返回自身"的万能 stub，属性赋值静默接受，数字上下文取 0。
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

      window.__calls = [];
      window.__responders = [
        (method, u) => {
          if (method === 'GET' && u === '/api/auth/me')
            return { body: { success: true, user: { id: 'u1', email: 'u1@test', display_name: 'E2E', owned: myData.length, favorites: 0 } } };
          if (method === 'GET' && u === '/api/favorites') return { body: { success: true, data: [] } };
          if (method === 'GET' && u === '/api/my-bloggers')
            return { body: { success: true, data: myData, count: myData.length } };
          if (method === 'GET' && u === '/data/archive.json') return { body: archiveData };
          if (method === 'GET' && u === '/api/archive') return { body: { success: true, data: archiveData } };
          return null;
        },
      ];
      window.fetch = (input, init = {}) => {
        const u = String(input).replace(/^https?:\/\/[^/]+/, '');
        const method = (init.method || 'GET').toUpperCase();
        window.__calls.push({ method, url: u, body: init.body || null });
        for (const h of window.__responders) {
          const r = h(method, u, init);
          if (r) {
            const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
            return Promise.resolve({ ok: (r.status || 200) < 400, status: r.status || 200, json: () => Promise.resolve(JSON.parse(body)) });
          }
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: [] }) });
      };
    },
  });
  await waitFor(() => dom.window.document.querySelectorAll('.blogger-card').length > 0, '卡片渲染 ' + url);
  return dom;
};

// ══ /my：按钮、确认、删除、就地消失 ══
console.log('[/my] 取消收录按钮');
const dom = await buildDom('/my');
const doc = dom.window.document;

const removeBtns = () => [...doc.querySelectorAll('.btn-card-remove')];
eq(removeBtns().length, 3, '三张卡各有一个「取消收录」按钮');
eq(doc.getElementById('mh-sub').textContent, '共 3 位 · 公开 2 · 仅自己可见 1', '副标题统计正确');

let confirmCalls = 0;
dom.window.confirm = () => { confirmCalls++; return false; };
removeBtns()[0].click();
await sleep(60);
eq(confirmCalls, 1, '先弹确认框');
eq(dom.window.__calls.filter((c) => c.method === 'DELETE').length, 0, '点「取消」不发请求');

const deletes = [];
dom.window.__responders.unshift((method, u, init) => {
  if (method === 'DELETE' && u === '/api/my-bloggers') {
    deletes.push(JSON.parse(init.body));
    return { body: { success: true, message: '已从我的收录中移除 @alice（公开仓仍保留着它）' } };
  }
  return null;
});
dom.window.confirm = () => true;
removeBtns()[0].click();   // alice
await waitFor(() => removeBtns().length === 2, '卡片就地移除');
eq(deletes, [{ screen_name: 'alice' }], 'DELETE /api/my-bloggers 带正确的 screen_name');
eq(doc.body.textContent.includes('公开仓仍保留着它'), true, '服务端的人话提示被展示（toast）');
eq(doc.getElementById('mh-sub').textContent, '共 2 位 · 公开 1 · 仅自己可见 1', '副标题统计跟着重算');
eq(myData.length, 3, '只动前端视图数据，mock 源不动（重渲染用本地过滤）');

// 失败路径：404 时卡片不消失、错误被展示
dom.window.__responders.unshift((method, _u) => {
  if (method === 'DELETE' && _u === '/api/my-bloggers')
    return { status: 404, body: { success: false, error: '你没有收录 @bob' } };
  return null;
});
removeBtns()[0].click();   // bob
await sleep(80);
eq(removeBtns().length, 2, '失败时卡片不消失');
eq(doc.body.textContent.includes('你没有收录 @bob'), true, '失败原因被展示');
dom.window.__responders.shift();

// 批量取消收录：作用于当前筛选结果，发 screen_names
dom.window.__responders.unshift((method, _u, _init) => {
  if (method === 'DELETE' && _u === '/api/my-bloggers')
    return { body: { success: true, released_count: 2, reclaimed_count: 1, message: '已取消收录 2 位' } };
  return null;
});
doc.getElementById('btn-bulk-uncollect').click();
const findBatch = () => dom.window.__calls.find((c) => c.method === 'DELETE' && typeof c.body === 'string' && c.body.includes('screen_names'));
await waitFor(findBatch, '批量 DELETE 发出');
const batchBody = JSON.parse(findBatch().body);
eq(Object.keys(batchBody).sort(), ['screen_names'], '批量走 screen_names（不支持 scope:all 后门）');
eq(batchBody.screen_names.length, 2, '作用于当前列表（剩 2 位）');
await waitFor(() => (dom.window.__calls.filter((c) => c.method === 'GET' && c.url === '/api/my-bloggers').length >= 2), '批量后重新拉取我的收录');
dom.window.close();

// ══ /：公开画廊没有这个按钮 ══
console.log('\n[/] 公开画廊不出现');
const dom2 = await buildDom('/', [mk('9', 'galleryone', 'public'), mk('10', 'gallerytwo', 'public')]);
eq(dom2.window.document.querySelectorAll('.btn-card-remove').length, 0, '画廊卡片没有取消收录按钮');
eq(dom2.window.document.getElementById('mine-tools').classList.contains('hidden'), true, '批量工具条也隐藏');
dom2.window.close();

console.log(`\n════════ ${pass} 通过 / ${failCount} 失败 ════════`);
if (failCount) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
