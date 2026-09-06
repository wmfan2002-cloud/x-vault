import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export async function waitFor(check, label, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${label}`);
}

export async function openAdmin({ tab = 'overview', respond = () => null } = {}) {
  const source = readFileSync('public/admin.js', 'utf8');
  const markup = readFileSync('public/admin.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace('</body>', `<script>${source.replace(/<\/script>/g, '<\\/script>')}</script></body>`);
  const calls = [];
  const intervals = new Map();
  const charts = [];
  const errors = [];
  const copied = [];
  let intervalId = 0;
  const dom = new JSDOM(markup, {
    url: `http://localhost/admin.html#${tab}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('x_archive_admin_token', 'test-session');
      window.addEventListener('error', event => errors.push(event.error));
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: () => () => {}, set: () => true,
      });
      window.setInterval = (callback, delay) => {
        const id = ++intervalId;
        intervals.set(id, { callback, delay });
        return id;
      };
      window.clearInterval = id => intervals.delete(id);
      window.navigator.clipboard = { writeText: value => { copied.push(value); return Promise.resolve(); } };
      window.Chart = class {
        constructor(canvas, config) {
          this.canvas = canvas;
          this.config = config;
          this.destroyed = false;
          charts.push(this);
        }
        destroy() { this.destroyed = true; }
      };
      window.fetch = async (input, init = {}) => {
        const url = new URL(input, window.location.href);
        const call = {
          path: url.pathname, search: url.searchParams, method: init.method || 'GET',
          body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {},
        };
        calls.push(call);
        let response = await respond(call);
        if (!response) {
          const defaults = {
            '/api/admin/check': { authenticated: true },
            '/api/admin/credentials': { success: true, hasCredentials: false },
            '/api/admin/visibility': { success: true, visibility: 'public' },
            '/api/admin/workflow-status': { success: true, is_active: false },
            '/api/admin/refetch-avatar': { success: true, remaining: 0, results: [] },
            '/api/admin/bloggers': {
              success: true, data: [], total: 0, page: 1, limit: 30, totalPages: 1,
              stats: { total: 0, in_gallery: 0, blocked: 0, mine_private: 0 },
            },
          };
          response = { body: defaults[call.path] || { success: true, data: [] } };
        }
        const status = response.status || 200;
        return { status, ok: status < 400, json: async () => JSON.parse(JSON.stringify(response.body)) };
      };
    },
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const document = dom.window.document;
  await waitFor(() => !document.getElementById('admin-dashboard-screen').classList.contains('hidden'), 'admin session');
  return {
    window: dom.window, document, calls, intervals, charts, errors, copied,
    close: () => dom.window.close(),
    tick: async delay => {
      for (const { callback, delay: ms } of [...intervals.values()]) {
        if (ms === delay) await callback();
      }
    },
  };
}
