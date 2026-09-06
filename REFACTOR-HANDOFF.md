# 前端去派生与重构 · 任务清单

> 建立 2026-09-06 · 最后更新 2026-09-06
> 跨会话的唯一进度来源。每做完一个条目就地打勾，并更新下面的尺子读数。

## 一句话

`public/` 下的前端仍有大段逐字复制自 nv-pu-sa 的代码。要把它换成自己的表达，
**同时一个像素都不改变外观**。2026-09-05 那次「重构」把设计一起删了，已回退。

## 两个目标，别混在一起

| 轴 | 要什么 | 怎么算完成 |
|---|---|---|
| A 去派生 | `public/` 里不再有实质性的复制表达 | 块级重合趋零（见尺子） |
| B 结构重构 | 6000 行的 style.css、3300 行的 app.js 拆成模块 | 每个文件单一职责、能独立读懂 |

关键判断：**外观不属于要换掉的东西。** 要换的是逐字相同的源码表达，不是渲染结果。
同一套视觉完全可以用自己的 token 命名、自己的选择器组织、自己的模块结构重写一遍，
块级重合照样降到 0。把设计砍掉不是目标要求的。

## 现状

- `public/` 与 README、THIRD-PARTY-NOTICES 已全部回退到 `894af3e`，站点外观完好。
- 2026-09-05 那版 clean-room 重写在 `git stash@{0}`（`前端 clean-room 重写…`）。
  别丢，里面有能捞的，见最后一节。

## 三把尺子

```bash
node _reference/measure-overlap.mjs   # 与来源的重合度（依赖本地 _reference/nvpusa/，不入库）
node scripts/css-census.mjs           # style.css 每条规则归谁用；--list=unused 查死样式
node scripts/visual-snap.mjs snap X   # 采一套外观快照到 .visual/X/
node scripts/visual-snap.mjs diff A B # 比对两套
```

外观回归网（`visual-snap`）是这次重构最关键的一件工具，用法：

```bash
node scripts/visual-snap.mjs snap before   # 动手之前
# ...改 public/ 下的代码...
node scripts/visual-snap.mjs snap after
node scripts/visual-snap.mjs diff before after   # 要看到「外观完全一致」
```

`.visual/head/` 已经存着对应 `894af3e` 的基线，22 个场景（三档桌面 + 平板 + 手机 + 浅色
+ 列表视图 + 筛选态 + 抽屉 + 转盘 + 登录面板 + 公告中心 + 管理台五个面板 + 移动端管理台
+ 门禁页 + 四个悬停态）。它同时看两层：

- **计算样式**：每个元素 68 条关键属性（含 transition/animation 全套）+ 盒子位置 + 叶子文字，
  零容差比对。删掉一条 `backdrop-filter`、丢一个 hover 态、改一句文案，都会被点名。
- **截图**：pixelmatch 逐点比，噪声地板 256 点（瀑布流有 ±1px 舍入抖动，见工具里的注释）。

实测过它抓得住东西：故意把 `.blogger-card` 的 `backdrop-filter` 与 `transition` 删掉，
样式层立刻报出 11 个场景各 60 处 —— 而截图那层一个点都没变（纯黑底上模糊等于不模糊）。
这正是 2026-09-05 那次损失的形状，也说明为什么两层缺一不可。

**它盖不到的地方**（这些只能人眼看）：
- `#bg-particles-canvas` 的粒子背景 —— canvas 逐帧画的，截图时被藏掉了
- `:focus-visible` 键盘焦点态
- 字体用的是首次联网抓下来缓存在 `.visual/.fonts/` 的 Plus Jakarta Sans；换字体栈会在
  计算样式里报出来，但字体文件本身的渲染差异不在网内

盯**块级重合**（>=5 行连续相同）。行级重合把 `}`、`display: flex;` 这种谁都会写的行
也算进去，虚高，且不可能也不必降到 0。

进度（2026-09-06，完成管理台模态框样式迁移之后。括号里是起点）：

| 文件 | 我方行数 | 块级重合 | 最长连续相同 | 目标 |
|---|---|---|---|---|
| style.css | 5545 | 78% | 582 行 | <5% |
| admin.js | 2648 | **51%** (60%) | 167 行 | <5% |
| app.js | 2950 | 53% (54%) | 281 行 | <5% |
| admin.html | 776 | **38%** (75%) | **32 行** (259) | <5% |
| index.html | 561 | **39%** (56%) | **21 行** (121) | <5% |

## 交战规则

1. **原地改，不重排。** 同优先级的 CSS 规则谁在后面谁生效，跨段搬动会静默改变渲染。
   拆文件（轴 B）留到轴 A 做完，且拆之前先做冲突分析。
2. **DOM id 是契约。** index.html 的 106 个 id、admin.html 的 141 个 id 被 app.js/admin.js
   和 tests/ 直接引用。要改就三处一起改，`npm test` 必须仍然全绿。
3. **每个条目做完必须肉眼验收。** 测试通过不代表外观没坏 —— 2026-09-05 那版 106 项测试
   全绿，界面已经面目全非（id 契约保住了，样式全没了）。
4. **不动后端。** `functions/`、`migrations/`、`scripts/`（除本清单提到的工具）不在范围内。
5. 每完成一个条目：跑两把尺子 + `npm test` + `npm run lint`，更新本文件读数，单独提交。

## 任务清单

### 阶段 0 · 准备
- [x] 回退 2026-09-05 的重写，原版存进 stash
- [x] 建立两把尺子
- [x] 删掉 20 条死样式（-69 行，106 项测试全绿，lint 干净）
- [x] 装 playwright + 建外观回归网（`scripts/visual-snap.mjs`），三次空跑互相比对为零差异
- [x] 采下 `894af3e` 的外观基线 `.visual/head/`

### 阶段 1 · 管理台（最脏，且没有视觉包袱，先在这里把方法跑通）
- [x] 图标抽成 `public/icons.svg` 精灵图（`scripts/extract-icons.mjs`，181 处 -> 99 个 symbol）。
      顺带把 index.html/app.js/admin.js 的图标一起抽了 —— 它们共用同一批图形，分批抽会重复。
      admin.html 最长块 259 -> 44 行，index.html 121 -> 21 行。外观零变化。
- [x] `admin.html` 重写标记结构（1036 -> 778 行）。分区注释按职责重写；七个排序项、
      六张 KPI 卡、四个健康度胶囊搬进 `admin.js` 按数据生成（SORT_OPTIONS / KPI_CARDS /
      HEALTH_PILLS）。块级重合 62% -> 39%，最长块 44 -> 32 行。外观零变化。
- [x] `admin.html` 剩下的内联 style：三个模态框的静态布局已迁入样式表末尾，动态进度/反馈仍由脚本写入；三种窗口浏览器断言通过，22 个既有场景零差异。
- [ ] `admin.js` 去派生：分析图表配置与两套排行榜骨架已抽成共享构造器；还剩 51% 块级重合、最长块 167 行 @1717，后续继续按面板职责推进。
- [ ] `admin.js` 按面板拆模块（overview / bloggers / analytics / announcements / submissions / danger）
- [ ] 管理台 CSS 重新组织：现在散在第 10 节和第 13-18 节两处，共 1884 行

### 阶段 2 · style.css（最大，也是外观所在，最需要小心）
5442 行，80% 落在连续相同块里，最长 582 行。按节推进，一节一验收。
- [ ] 第 1-3 节 tokens / baseline / motion（约 300 行）：先立自己的 token 命名体系
- [ ] 第 4-5 节 header / hero
- [ ] 第 6-7 节 筛选工具条 / 瀑布流卡片（最核心的视觉）
- [ ] 第 8 节 抽卡转盘
- [ ] 第 9 节 inspector 抽屉 + 变更时间线
- [ ] 第 11-13 节 toast / footer / 响应式断点

### 阶段 3 · app.js
2954 行，54% 块级重合。
- [ ] 拆成 ES 模块放 `public/js/`：数据层、卡片渲染、瀑布流、筛选排序、抽屉、转盘、
      公告、标签、收藏与收录、点击埋点、头像主色提取、粒子背景
- [ ] 拆的过程中同时换掉复制的表达：281 行块 @1545 卡片渲染、278 行块 @124 hsl 换算、
      261 行块 @1047 瀑布流重排、208 行块 @450 视图切换

### 阶段 4 · index.html
574 行，56% 块级重合，最长 121 行 @279（discovery-bar）。
- [ ] 重写标记结构，同步 style.css 选择器与 app.js 的 id 引用

### 阶段 5 · 收尾
- [ ] ⚠️ 尺子达标之前**不许动** README 和 THIRD-PARTY-NOTICES。现在这两份如实披露了
      派生关系；2026-09-05 那次是先删披露、再靠删代码把话说圆，顺序反了
- [ ] 轴 B：style.css 拆 base / gallery / admin 三层（现有归属：无 class 351 行、
      共用 877 行、仅画廊 3051 行、仅管理台 1884 行）。先做冲突分析，见交战规则 1
- [ ] `scripts/bump-assets.mjs` 的 ASSETS 列表和 `public/_headers` 要跟着新文件名走

## 可以从 stash 里捞什么

`git stash show -p 'stash@{0}' -- public/index.html`：那版把 106 个 id 全保住、元素从 482
压到 206，标记结构确实是自己写的，阶段 4 可以参考它的组织方式 —— 但不能直接用，它删掉的
276 个元素里有一部分是富样式需要的容器层。`admin.js` 那版 96 行的分面板框架同理，阶段 1 可参考。
CSS 那版不用看：设计系统是从零另写的（token 1064 → 149、transition 93 → 6、
backdrop-filter 50 → 5、@keyframes 26 → 4），跟现有外观没有关系。

## 环境备注

- 新增 devDependency：`playwright` 1.63.0、`pixelmatch` 7.2.0、`pngjs` 7.0.0，都锁死版本 ——
  截图比对的工具一升级渲染就变，会冒出一堆假差异。
- Chromium 装在 `~/.cache/ms-playwright/`；系统库是 `sudo npx playwright install-deps chromium`
  装的（libatk、libgbm、libasound 等 9 个）。
- `.visual/` 已进 .gitignore（一套基线约 48MB）。
