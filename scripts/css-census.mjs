#!/usr/bin/env node
/**
 * style.css 归属普查：每条规则到底服务于画廊、管理台，还是两者都要，还是没人用。
 *
 * 用途有两个：
 *   1. 拆分 style.css 前先拿到按选择器（而不是按注释分段）的真实归属 —— 文件里那些
 *      "10. Admin Shell" 之类的分段标题早就漂移了，照它切会把画廊样式切进管理台。
 *   2. 找出死样式。删掉它们是纯收益，不影响任何页面。
 *
 * 用法: node scripts/css-census.mjs [--list=unused|shared|gallery|admin]
 */
import { readFileSync } from 'node:fs';

const CSS = 'public/style.css';
const GALLERY = ['public/index.html', 'public/app.js'];
const ADMIN = ['public/admin.html', 'public/admin.js'];

const read = (p) => readFileSync(p, 'utf8');
const galleryText = GALLERY.map(read).join('\n');
const adminText = ADMIN.map(read).join('\n');

/** 把样式表切成顶层规则块，@media / @supports 递归进去，@keyframes 整块当一条 */
function parse(css, offset = 0) {
  const out = [];
  let i = 0;
  const lineAt = (pos) => css.slice(0, pos).split('\n').length + offset;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    let j = brace, level = 0;
    while (j < css.length) {
      if (css[j] === '{') level++;
      else if (css[j] === '}' && --level === 0) break;
      j++;
    }
    const prelude = css.slice(i, brace).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = css.slice(brace + 1, j);
    const lines = body.split('\n').length + 1;
    if (/^@(media|supports|layer)/.test(prelude)) {
      out.push({ kind: 'at', prelude, line: lineAt(brace), lines, children: parse(body, lineAt(brace) - 1) });
    } else if (prelude.startsWith('@')) {
      out.push({ kind: 'raw', prelude, line: lineAt(brace), lines, selectors: [] });
    } else if (prelude) {
      out.push({ kind: 'rule', prelude, line: lineAt(brace), lines, selectors: prelude.split(',').map((s) => s.trim()) });
    }
    i = j + 1;
  }
  return out;
}

const classesOf = (sel) => [...sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
const esc = (v) => v.replace(/-/g, '\\-');
/** 类名在标记/脚本里直接出现 */
const literal = (cls, text) => new RegExp(`["'\\s\`.]${esc(cls)}["'\\s\`.,;)\\]]`).test(text);
/** 类名由脚本按 - 边界拼出来，例如 `tag-c-${color}` 或 'tag-c-' + color */
const composed = (cls, text) => {
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== '-') continue;
    const p = esc(cls.slice(0, i + 1));
    if (new RegExp(`${p}\\$\\{|${p}["'\`]\\s*\\+`).test(text)) return true;
  }
  return false;
};
const used = (cls, text) => literal(cls, text) || composed(cls, text);

const buckets = { gallery: [], admin: [], shared: [], unused: [], base: [] };

function classify(rules) {
  for (const r of rules) {
    if (r.kind === 'at') { classify(r.children); continue; }
    if (r.kind === 'raw') { buckets.base.push(r); continue; }
    const cls = [...new Set(r.selectors.flatMap(classesOf))];
    if (!cls.length) { buckets.base.push(r); continue; }
    const inG = cls.some((c) => used(c, galleryText));
    const inA = cls.some((c) => used(c, adminText));
    if (inG && inA) buckets.shared.push(r);
    else if (inG) buckets.gallery.push(r);
    else if (inA) buckets.admin.push(r);
    else buckets.unused.push(r);
  }
}

const tree = parse(read(CSS));
classify(tree);

const totalLines = read(CSS).split('\n').length;
const sum = (b) => b.reduce((s, r) => s + r.lines, 0);
console.log(`\n${CSS} —— ${totalLines} 行\n`);
console.log('归属            规则数    约行数   占比');
console.log('─'.repeat(44));
for (const [k, label] of [['base', '无 class（基础层）'], ['shared', '画廊+管理台共用'], ['gallery', '仅画廊'], ['admin', '仅管理台'], ['unused', '没人用（死样式）']]) {
  const b = buckets[k];
  console.log(`${label.padEnd(20)}${String(b.length).padStart(5)}${String(sum(b)).padStart(9)}${((sum(b) / totalLines) * 100).toFixed(0).padStart(6)}%`);
}

const want = process.argv.find((a) => a.startsWith('--list='))?.split('=')[1];
if (want && buckets[want]) {
  console.log(`\n${want} 明细（${buckets[want].length} 条）：`);
  for (const r of buckets[want]) console.log(`  @${String(r.line).padStart(5)}  ${r.prelude.replace(/\s+/g, ' ').slice(0, 96)}`);
}
console.log();
