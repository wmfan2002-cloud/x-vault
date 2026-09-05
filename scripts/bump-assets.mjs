#!/usr/bin/env node
/**
 * 给 app.js / admin.js / style.css / logo-icon.png 的引用加内容哈希版本戳。
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
 * 图标也在列：favicon 的浏览器缓存比 js/css 更顽固，硬刷新经常都不管用，
 * 换了图不打戳很可能你自己都看不到变化。
 * （`favicon.ico` 和 `apple-touch-icon.png` 不打戳 —— 浏览器按固定路径主动请求，
 *   带查询串它们不认。那两个靠 _headers 的 no-cache 兜。）
 *
 * 用法: node scripts/bump-assets.mjs
 * 改完上面任何一个文件后跑一次；npm run dev / deploy 之前也该跑。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = resolve(ROOT, 'public');
const ASSETS = ['app.js', 'admin.js', 'style.css', 'logo-icon.png'];
// icons.svg 刻意不在这里：它是被 <use href="/icons.svg#name"> 引用的，带片段标识，
// 打戳要写成 `/icons.svg?v=hash#name`，而且四个文件（含两个 js）里都有引用，
// 不是只改 PAGES 就够。它在 public/_headers 里是 no-cache，浏览器每次都会校验，
// 打戳带来的收益为零。
const PAGES = ['index.html', 'admin.html'];

// href 用于 <link>，src 用于 <script>/<img>。图标两种都出现（favicon 是 link，
// 头部品牌位是 img），所以按属性名逐个试而不是按扩展名二选一。
const ATTRS = { '.css': ['href'], '.js': ['src'], '.png': ['href', 'src'] };
const attrsFor = (f) => ATTRS[f.slice(f.lastIndexOf('.'))] || ['src'];

const hash = (f) => createHash('md5').update(readFileSync(resolve(PUB, f))).digest('hex').slice(0, 10);
const stamps = Object.fromEntries(ASSETS.map((a) => [a, hash(a)]));

let changed = 0;
for (const page of PAGES) {
  const p = resolve(PUB, page);
  let s = readFileSync(p, 'utf8');
  const before = s;

  for (const [asset, h] of Object.entries(stamps)) {
    for (const attr of attrsFor(asset)) {
      // 匹配 src="/app.js"、src="app.js"、src="./app.js"，带不带 ?v= 都行。
      // ⚠️ 原站写的是 `/app.js?v=2.2`（有前导斜杠，版本号还是 2.2 这种非十六进制），
      // 早先的正则两点都没考虑到，静默匹配不上、一个字都没改。
      s = s.replace(
        new RegExp(`(${attr}=")(\\.?/?)${asset.replace(/\./g, '\\.')}(\\?v=[^"]*)?(")`, 'g'),
        `$1$2${asset}?v=${h}$4`
      );
    }
  }
  if (s !== before) { writeFileSync(p, s); changed++; }
  console.log(`  ${page} ${s !== before ? '已更新' : '无变化'}`);
}

console.log('\n版本戳:');
for (const [a, h] of Object.entries(stamps)) console.log(`  ${a.padEnd(12)} ?v=${h}`);
console.log(changed ? '\n完成。' : '\n没有需要改的引用（检查 HTML 里的 src/href 写法）。');
