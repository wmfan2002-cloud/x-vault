#!/usr/bin/env node
/**
 * 给 app.js / admin.js / style.css 的引用加内容哈希版本戳。
 *
 * 为什么必须这么做：Cloudflare 区域级的 **Browser Cache TTL** 会覆盖源站的
 * Cache-Control。免费版默认 4 小时（max-age=14400），且只作用于 js/css ——
 * 所以 index.html 是新的、app.js 是 4 小时前的。新 HTML + 旧 JS 的后果是
 * 事件处理器压根没绑上，按钮点了毫无反应，而且看不出任何报错。
 *
 * `public/_headers` 里的 no-cache 在源站是生效的（实测直连 127.0.0.1:8788 正确），
 * 但拦不住 Cloudflare 的覆盖。改 URL 才是唯一不依赖任何 CDN 设置的办法 ——
 * 内容一变 URL 就变，旧缓存自然失效。
 *
 * 用法: node scripts/bump-assets.mjs
 * 改完 app.js / admin.js / style.css 后跑一次；npm run dev / deploy 之前也该跑。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = resolve(ROOT, 'public');
const ASSETS = ['app.js', 'admin.js', 'style.css'];
const PAGES = ['index.html', 'admin.html'];

const hash = (f) => createHash('md5').update(readFileSync(resolve(PUB, f))).digest('hex').slice(0, 10);
const stamps = Object.fromEntries(ASSETS.map((a) => [a, hash(a)]));

let changed = 0;
for (const page of PAGES) {
  const p = resolve(PUB, page);
  let s = readFileSync(p, 'utf8');
  const before = s;

  for (const [asset, h] of Object.entries(stamps)) {
    const attr = asset.endsWith('.css') ? 'href' : 'src';
    // 匹配 src="/app.js"、src="app.js"、src="./app.js"，带不带 ?v= 都行。
    // ⚠️ 原站写的是 `/app.js?v=2.2`（有前导斜杠，版本号还是 2.2 这种非十六进制），
    // 早先的正则两点都没考虑到，静默匹配不上、一个字都没改。
    s = s.replace(
      new RegExp(`(${attr}=")(\\.?/?)${asset.replace('.', '\\.')}(\\?v=[^"]*)?(")`, 'g'),
      `$1$2${asset}?v=${h}$4`
    );
  }
  if (s !== before) { writeFileSync(p, s); changed++; }
  console.log(`  ${page} ${s !== before ? '已更新' : '无变化'}`);
}

console.log('\n版本戳:');
for (const [a, h] of Object.entries(stamps)) console.log(`  ${a.padEnd(12)} ?v=${h}`);
console.log(changed ? '\n完成。' : '\n没有需要改的引用（检查 HTML 里的 src/href 写法）。');
