import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { waitFor } from './helpers/admin-dom.mjs';

const profiles = Array.from({ length: 30 }, (_, index) => ({
  id: String(index), screen_name: `creator${index}`, name: `Creator ${index}`,
  followers_count: 10000 - index, description: '', avatar_url: '', cover_url: '',
  verified: 0, is_suspended: 0, backed_up_at: '2026-01-01T00:00:00Z',
}));

async function gallery({ pendingArchive = false } = {}) {
  let release;
  const archiveReady = pendingArchive ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const source = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace('</body>', `<script>${source.replace(/<\/script>/g, '<\\/script>')}</script></body>`);
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.innerWidth = 1440;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollTo = () => {};
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (_, key) => key === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : () => {},
        set: () => true,
      });
      window.matchMedia = query => ({ media: query, matches: false, addEventListener() {} });
      // Unequal measured heights exercise shortest-column selection and stable ties.
      Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() {
        if (this.classList.contains('masonry-column')) return [...this.children].reduce((sum, card) => {
          const handle = card.querySelector('.card-user-handle').textContent;
          return sum + [200, 300, 200, 150][Number(handle.replace('@creator', '')) % 4];
        }, 0);
        return 1000;
      } });
      window.fetch = async input => {
        const path = new URL(input, window.location.href).pathname;
        let body = { success: true, data: [] };
        if (path === '/data/archive.json') { await archiveReady; body = profiles; }
        if (path === '/api/archive') body = { success: true, data: profiles };
        if (path === '/api/auth/me') body = { success: true, user: null };
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
      };
    },
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  return { window: dom.window, document: dom.window.document, release, close: () => dom.window.close() };
}

test('sort options are present while the initial archive request is pending', async t => {
  const ui = await gallery({ pendingArchive: true });
  t.after(ui.close);
  const options = [...ui.document.querySelectorAll('#sort-menu [role="option"]')];
  assert.deepEqual(options.map(option => option.dataset.val), ['followers-desc', 'followers-asc', 'name-asc', 'recent']);
  ui.document.getElementById('sort-trigger-btn').click();
  assert.equal(ui.document.getElementById('sort-trigger-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(ui.document.getElementById('sort-menu').classList.contains('hidden'), false);
  ui.release();
  await waitFor(() => ui.document.querySelectorAll('.blogger-card').length === 12, 'initial cards');
});

test('masonry appends without replacing cards and preserves counts across breakpoints', async t => {
  const ui = await gallery();
  t.after(ui.close);
  const { window, document } = ui;
  const cards = () => [...document.querySelectorAll('.blogger-card')];
  const columns = () => [...document.querySelectorAll('.masonry-column')];
  const sentinel = document.getElementById('infinite-scroll-sentinel');
  const handles = column => [...column.querySelectorAll('.card-user-handle')].map(x => x.textContent);
  await waitFor(() => cards().length === 12, 'first page');
  assert.equal(columns().length, 3);
  assert.deepEqual(columns().map(column => handles(column).slice(0, 2)), [
    ['@creator0', '@creator3'], ['@creator1', '@creator5'], ['@creator2', '@creator4'],
  ]);
  const originalCards = cards();
  window.scrollY = 10000;
  window.dispatchEvent(new window.Event('scroll'));
  await waitFor(() => cards().length === 24, 'second page');
  assert.ok(originalCards.every(card => card.isConnected && cards().includes(card)));
  assert.equal(sentinel.classList.contains('hidden'), false);
  window.dispatchEvent(new window.Event('scroll'));
  await waitFor(() => cards().length === 30, 'last page');
  assert.equal(new Set(cards().map(card => card.querySelector('.card-user-handle').textContent)).size, 30);
  assert.equal(sentinel.classList.contains('hidden'), true);

  for (const [width, expected] of [[640, 1], [641, 2], [1024, 2], [1025, 3]]) {
    window.innerWidth = width;
    window.dispatchEvent(new window.Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.equal(columns().length, expected);
    assert.equal(cards().length, 30);
  }
  document.querySelector('[data-view="compact"]').click();
  assert.equal(columns().length, 4);
  assert.equal(cards().length, 12);
  for (const [width, expected] of [[640, 2], [641, 3], [1025, 4]]) {
    window.innerWidth = width;
    window.dispatchEvent(new window.Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.equal(columns().length, expected);
    assert.equal(cards().length, 12);
  }
  document.querySelector('[data-view="list"]').click();
  assert.equal(columns().length, 0);
  assert.ok(cards().every(card => card.parentElement.id === 'blogger-wall'));
  const search = document.getElementById('global-search');
  search.value = 'no-match';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(cards().length, 0);
  assert.equal(document.getElementById('empty-state-search').classList.contains('hidden'), false);
  assert.equal(sentinel.classList.contains('hidden'), true);
  document.getElementById('search-clear-btn').click();
  assert.equal(cards().length, 12);
});
