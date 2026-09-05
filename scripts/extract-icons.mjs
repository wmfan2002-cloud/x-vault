#!/usr/bin/env node
/**
 * 把散在 HTML/JS 里的 181 处内联 lucide 图标抽成一张 SVG 精灵图。
 *
 * 为什么做：
 *   · 去派生 —— 逐字复制的行里最大的一块就是这些 svg（admin.html 的 29% 字节、
 *     全站 45KB）。图形本身是 lucide 的 ISC 开源资产，不是来源站的创作，
 *     换成 <use> 引用之后这部分重合直接归零。
 *   · 结构 —— 100 个图形出现 181 次，同一个图标在四个文件里各写一遍。
 *
 * 只做机械替换，不改渲染：
 *   <svg width=16 height=16 ...><path d="..."/></svg>
 *   -> <svg class="i" width=16 height=16 ...><use href="/icons.svg#name"/></svg>
 *   外壳的 width/height/class/其它属性原样保留，stroke-width 等表现属性写进 symbol。
 *
 * 用法: node scripts/extract-icons.mjs [--write]
 *       不带 --write 只报告，不动文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['public/admin.html', 'public/index.html', 'public/app.js', 'public/admin.js'];
const SPRITE = 'public/icons.svg';
const WRITE = process.argv.includes('--write');

/**
 * 表现属性留在引用点，不进 symbol。
 * 原因：同一个图形在站内配了多套描边（users 有 stroke-width 2 / 2.2 三种，flame 有六种，
 * 还有一处描边是 var(--accent-spark)）。把它们并进 symbol 的身份，99 个图形会裂成 138 个，
 * 精灵图里全是同图不同边的重复。symbol 只存几何形状，粗细与颜色由引用点的 <svg> 继承下来 ——
 * 这些属性本来就是可继承的，渲染结果一致。
 */
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity'];

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

/** 图形几何 + viewBox = 图标身份。尺寸、class、描边都不参与，那些是引用点的事。 */
function identity(svg) {
  const open = svg.match(/^<svg[^>]*>/)[0];
  const a = attrs(open);
  const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  const paint = PAINT.filter((k) => a[k] !== undefined).map((k) => `${k}=${a[k]}`).join(' ');
  const box = a.viewBox || '0 0 24 24';
  return { body, paint, box, key: `${box}|${body}`, open, a };
}

/**
 * 名字表。键是图形在「按 FILES 顺序扫描、首次出现」时的序号，值是图标名。
 *
 * 为什么用序号而不是几何指纹当键：名字是人工定的。试过拿 lucide/feather 官方图标集
 * 做几何比对自动配名，只配上 64/99，而且错得很难看 —— 七个不同图标都被叫 minus，
 * 四个叫 circle-slash。这些图形是站内改过描边和笔画的变体，跟上游对不齐。
 * 现在的名字是逐个看调用点（按钮文案、id、title）定的，比上游名字更贴合这里的用途。
 *
 * ⚠️ 序号会随着新增/删除内联 svg 而漂移。脚本每次都会核对总数与全表命中，
 * 对不上就直接报错退出，不会悄悄给错名字。
 */
const NAMES = JSON.parse(readFileSync('scripts/data/icon-names.json', 'utf8'));

// ── 收集 ──────────────────────────────────────────────────────────────
const seen = new Map();   // key -> { name, id, count }
const sources = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));

let ordinal = 0;
for (const src of sources.values()) {
  for (const svg of src.match(/<svg[\s\S]*?<\/svg>/g) || []) {
    const id = identity(svg);
    if (!id.body) continue;             // 空 svg（只有外壳）不管
    if (seen.has(id.key)) { seen.get(id.key).count++; continue; }
    const name = NAMES[ordinal];
    if (!name) {
      console.error(`第 ${ordinal} 个图形在 scripts/data/icon-names.json 里没有名字。`);
      console.error(`  ${id.body.slice(0, 100)}`);
      console.error('图形集变了：补上这一条，或先跑一遍确认序号没错位。');
      process.exit(1);
    }
    seen.set(id.key, { name, id, count: 1 });
    ordinal++;
  }
}
if (ordinal !== Object.keys(NAMES).length) {
  console.error(`图形数 ${ordinal} 与名字表的 ${Object.keys(NAMES).length} 条对不上 —— 序号已经错位，名字会配错。`);
  process.exit(1);
}

// ── 替换 ──────────────────────────────────────────────────────────────
let replaced = 0, skipped = 0;
const results = [];
for (const [file, src] of sources) {
  let n = 0;
  const out = src.replace(/<svg[\s\S]*?<\/svg>/g, (svg) => {
    const id = identity(svg);
    const hit = seen.get(id.key);
    if (!id.body || !hit) { skipped++; return svg; }
    // 原样保留引用点上的每个属性（尺寸、class、描边都在内），只去掉 viewBox —— symbol 自带
    const keep = Object.entries(id.a)
      .filter(([k]) => k !== 'viewBox')
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    n++; replaced++;
    return `<svg ${keep ? keep + ' ' : ''}aria-hidden="true"><use href="/icons.svg#${hit.name}"/></svg>`;
  });
  results.push([file, n, src.length, out.length]);
  if (WRITE && n) writeFileSync(file, out);
}

// ── 精灵图 ────────────────────────────────────────────────────────────
const symbols = [...seen.values()]
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  .map(({ name, id }) => `<symbol id="${name}" viewBox="${id.box}">${id.body}</symbol>`);

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<!-- 图标精灵图。图形取自 lucide (https://lucide.dev)，ISC 授权。
     由 scripts/extract-icons.mjs 从各页面的内联 svg 抽取生成 —— 不要手改，
     改图标请改源文件再重新跑一遍脚本。 -->
${symbols.join('\n')}
</svg>
`;
if (WRITE) writeFileSync(SPRITE, sprite);

console.log(`\n${seen.size} 个不同图标，共 ${replaced} 处引用${WRITE ? '（已写入）' : '（预演，未写文件）'}\n`);
console.log('文件                  替换  原大小   新大小   省下');
for (const [f, n, a, b] of results)
  console.log(`${f.replace('public/', '').padEnd(20)}${String(n).padStart(5)}${String(a).padStart(9)}${String(b).padStart(9)}${String(a - b).padStart(8)}`);
const [oa, ob] = results.reduce(([x, y], [, , a, b]) => [x + a, y + b], [0, 0]);
console.log(`${'合计'.padEnd(19)}${String(replaced).padStart(5)}${String(oa).padStart(9)}${String(ob).padStart(9)}${String(oa - ob).padStart(8)}`);
console.log(`精灵图 ${SPRITE} ${sprite.length} 字节；未能替换的 svg ${skipped} 处`);
console.log(`净变化 ${ob + sprite.length - oa} 字节\n`);
