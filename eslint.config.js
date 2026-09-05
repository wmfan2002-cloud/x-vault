/**
 * ESLint 平面配置。
 *
 * 项目风格约定（与 .editorconfig 一致，这里只管 JS 语义层面）：
 *   · 2 空格缩进、单引号、分号 —— 与存量代码一致，冲突时以存量为准
 *   · functions/ 是 Cloudflare Workers 环境（没有 process，顶层有 crypto/Request/Response）
 *   · public/*.js 是浏览器脚本（document/window/localStorage）
 *   · scripts/ 与 tests/ 跑在 Node
 *
 * 刻意不开的规则：stylistic 类（引号/分号/缩进交给 .editorconfig 与 review，
 * 对一个 5000 行的存量 CSS/JS 混合仓库，格式化噪音大于收益）。
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    ignores: [
      'node_modules/',
      '.wrangler/',
      'public/data/',       // 构建产物（真实数据快照）
      '_reference/',        // 本地参考资料，不入库、不检查
    ],
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: { ...globals.worker },
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, Chart: 'readonly' },  // admin.html 从 CDN 引入 Chart.js
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // 存量代码在"错误分支里 return fail(...)"这类地方存在函数出口后仍有 return 的写法
      'no-unreachable': 'error',
      // db.js 等地方用 catch {} 吞掉错误是有意的（媒体失败不中断整批）
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
];
