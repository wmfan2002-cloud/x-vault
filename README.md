# X-符离集 · x-vault

X (Twitter) 博主的策展画廊 + 永久归档。核心目的不是浏览，而是**保险**：
你关注的博主被封号、注销或改名之后，档案仍然在、仍然找得到。消失的账号进入
「赛博坟场」筛选，而不是从库里蒸发。

> 脱胎自 [nv-pu-sa](https://nv-pu-sa.pages.dev/)：前端沿用其已发布的 HTML/CSS/JS 并做了
> 大量改造，后端（原站不存在）从客户端调用点反推后从零实现。运行在 Cloudflare Pages
> 全家桶上：Pages Functions + D1 + R2，免费档即可跑起来。

## 功能

**画廊（公开）**

- 瀑布流 + 无限滚动，搜索 / 筛选 / 排序 / 三种视图切换，随机探索（按日期取种子，当天稳定）
- 三级数据降级链：静态快照 `archive.json`（CDN 直出，零 D1 读）→ `/api/archive` → `localStorage`
  —— 后端整个挂掉画廊照常工作
- 公开投稿：格式校验 → 限流 → 去重 → 去 X 核实存在性 → 抓资料入库，无需人工审核
- 站点公告：级别/置顶/定时上下线/关闭后可重新提醒，正文纯文本渲染（防存储型 XSS）

**账号（GitHub / Google OAuth）**

- 授权码流程 + PKCE + 一次性 state（存库用后即删）
- 身份键是 `(provider, sub)` 而不是邮箱，**不做跨提供方邮箱合并**（防账号接管）
- 可选白名单：`ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`，不配则任何账号可登录

**个人空间（登录后）**

- **我的收录** `/my`：公开/私密逐条或批量切换、标签/文件夹（即时筛选）、批量取消收录
- **我的收藏** `/favorites`：独立于收录的私人清单，与收录共用一套标签
- **取消收录 = 引用计数回收**（本项目存储层的核心设计，见下文）

**管理台 `/admin`**（账号密码登录，服务端门禁，未登录不下发面板 HTML）

- 档案增删改、全站下架（屏蔽）与「仅站长可见」严格区分、撤出公开仓 vs 彻底删除
- 补回头像（进度弹窗 + 实时日志 + 429 自动冷却续跑）
- 一键同步（增量抓新关注）/ 完整核对（断点续跑）、粉丝数分析、投稿记录、公告管理

## 存储模型：一份数据 + 指针 + 引用计数

同一位博主（同一个 X id）在库里**永远只有一份** `bloggers` 行 + 一份 R2 媒体。
谁在用它由逐行「指针」表示：

```
bloggers (@alice)  ←── blogger_owners(admin-legacy, public)   公开仓的指针
                   ←── blogger_owners(用户A, private)          A 的私人指针
                   ←── blogger_owners(用户B, public)           B 的指针
                   ←── favorites(用户C)                        C 只是收藏
```

三条规则由此自然成立，不需要任何「这是谁上传的」特殊判断：

1. **个人取消收录只删自己那行指针** —— 靠 SQL 作用域（`WHERE user_id = 调用者`）保证，
   公开仓和别人的收录纹丝不动；
2. **可见性** —— 只要还有任意一行 public 指针就在公开画廊；全是 private 时只对持有人可见；
3. **真实数据何时删除** —— 引用计数归零（无归属、无收藏）时自动回收整份档案
   （时间线、粉丝快照、标签、R2 媒体一并清掉）。「admin 上传的只能 admin 删」是推论：
   admin 的指针本身就是一个引用。

归档系统的立身之本是**永不丢失**：账号从 X 消失只落墓碑（`is_suspended` 三态：0 正常 /
1 封号 / 2 注销），绝不删除档案。

## 快速开始

前置：Node ≥ 22（测试用到 `node:sqlite`）、一个 Cloudflare 账号（D1 和 R2 免费档即可）。

```bash
npm install

# 1. 建库与桶，把返回的 database_id 填进 wrangler.toml
npm run db:create
npm run r2:create

# 2. 建表（本地 D1）
npm run setup:local          # = db:migrate:local + seed:local

# 3. 生成密钥，把输出的几行写进 .dev.vars（模板见 .dev.vars.example）
node scripts/gen-keys.mjs

# 4. 起服务
npm run dev                  # http://localhost:8788
```

管理台在 `/admin`，默认用户名 `admin`（`.dev.vars` 里的 `ADMIN_USERNAME` 可改）。

> **注意**：真实数据快照 `public/data/archive.json` 不入库（含真实创作者档案，
> 见下面「仓库边界」）。克隆后库里是空的，画廊会显示样例数据；跑一次全量同步或
> 从备份导入即可。

## 测试

```bash
npm test        # 离线两套：语义（48 项）+ 前端 jsdom（14 项），不需要起服务
npm run test:e2e  # 打真服务（先 npm run dev），27 项，自带测试数据创建与清理
npm run lint    # eslint
```

| 文件 | 覆盖 |
|---|---|
| `tests/test-uncollect.mjs` | 内存 SQLite + D1 shim 直接跑真 handler：引用计数语义、公开仓保护、GC 全表无残留、越权/校验错误路径 |
| `tests/test-uncollect-ui.mjs` | 真 `index.html` + 真 `app.js` 跑在 jsdom：按钮可见性、确认框、请求体、就地移除、失败路径、批量分片 |
| `tests/e2e-uncollect.mjs` | 对运行中的服务端到端：临时用户注入会话、真实画廊数据验证、假博主验证回收、自清理 |

## 环境变量

Secrets（`wrangler pages secret put <NAME>`，值用 `node scripts/gen-keys.mjs` 生成，**不进仓库**）：

| 名称 | 用途 |
|---|---|
| `ADMIN_PASSWORD_HASH` | 管理员密码的 PBKDF2 哈希 |
| `SESSION_SECRET` | 会话/CSRF state 等安全场景的盐（必须配置，IP 哈希也用它） |
| `CREDENTIAL_ENC_KEY` | X 凭据 AES-GCM 加密密钥（32 字节 base64） |
| `GITHUB_PAT` | 派发全量刷新 workflow 用，需 `actions:write` |
| `GITHUB_CLIENT_ID/SECRET`、`GOOGLE_CLIENT_ID/SECRET` | OAuth 登录（不配则按钮置灰，其余功能不受影响） |

`wrangler.toml` 的 `[vars]`：`GITHUB_REPO`（owner/repo）、`GITHUB_WORKFLOW_FILE`。

`.dev.vars` 其余可选项见 [.dev.vars.example](.dev.vars.example)：`SITE_ORIGIN`（建议填死，
redirect_uri 要与提供方后台逐字一致）、`ADMIN_EMAILS`（命中即管理员）、
`ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`（白名单）。

**OAuth 回调登记**：GitHub → `https://你的域名/api/auth/callback/github`；Google →
`.../api/auth/callback/google`。结尾无斜杠。

## 部署到 Cloudflare Pages

```bash
npm run db:migrate          # 远端建表（其余 migrations 按序号逐个执行）
npm run seed                # 灌数据（需要 public/data/archive.json）
npm run deploy
```

GitHub Actions 全量刷新另需：`X_CT0`、`X_AUTH_TOKEN`、`CLOUDFLARE_API_TOKEN`、
`CLOUDFLARE_ACCOUNT_ID`（仓库 secrets），并配好 `GITHUB_REPO`。

## 安全模型

| 面 | 做法 |
|---|---|
| 会话 | 两套独立会话表（管理台/用户），库里只存 SHA-256，可即时吊销；Cookie HttpOnly（管理台 SameSite=Strict） |
| 密码 | PBKDF2-SHA256 10 万轮 + 常数时间比较；登录失败不区分「用户不存在/密码错误」 |
| 暴力破解 | `/api/admin/login` 内存窗口限流（5 次/分钟/IP） |
| 投稿限流 | 每 IP 每小时 5 次 / 每天 20 次，全站每小时 60 次，被拒 24h 冷却；IP 只存哈希（`SESSION_SECRET` 加盐） |
| 点击埋点 | 批量 ≤100 条、单事件 clamp 100、单 handle 每请求 ≤500、请求级限流 60 次/分钟/IP |
| SSRF | `/api/media?url=` 白名单 `pbs.twimg.com` / `abs.twimg.com`；`?key=` 前缀白名单 `avatars/|covers/` |
| SQL | 全部参数化查询；排序/状态枚举走白名单映射 |
| XSS | 公告正文纯文本存储 + 前端转义渲染；卡片字段统一 `escapeHtml`；外链带 `rel="noopener noreferrer"` |
| CSRF | 变更接口全部 JSON body + fetch（浏览器跨站预检必败）+ SameSite Cookie |
| X 凭据 | AES-GCM 加密入库，永不回传前端（只回 `has_credentials`），用户可随时清除 |

**已知权衡**（代码内有注释，这里如实列出）：

- 管理台令牌仍在 localStorage 存了一份（兼容沿用的 admin.js），有 XSS 就可读 —— Cookie 优先
  已在服务端实现，逐步迁移可去掉
- 内存限流是 isolate 级的，尽力而为；需要精确限流的投稿走数据库计数
- 站长（能读 D1 + Secret）技术上可解密任何用户保存的 X 凭据 —— 前端有显著风险告知
- 匿名投稿默认归公开仓且公开（无审核是产品决定），护栏靠限流 + X 存在性核实

## 仓库边界（哪些东西故意不入库）

| 路径 | 原因 |
|---|---|
| `.dev.vars` | 真实密钥（模板见 `.dev.vars.example`） |
| `STATE.md` | 运维日志：服务器 IP、历史密码、内部细节 |
| `public/data/archive.json` | 334 条真实创作者档案的公开快照。要公开请自行评估；private 仓库可 `git add -f` |
| `_reference/nvpusa/` | 原站客户端源码拷贝（第三方版权），仅本地比对 |
| `backups/`、`migrations/seed.generated.sql` | 真实数据导出 |

`_reference/spec/`（6 份规格文档，约 5500 行）是这个项目自己的反推笔记与 API 契约，
已入库，读懂系统的最佳入口。

## 项目结构

```
public/               前端（画廊 index.html + 管理台 admin.html + app.js/admin.js/style.css）
functions/api/        Pages Functions，一文件一路由
functions/_lib/       auth / user-auth / oauth / crypto / db / http / sync / ratelimit
functions/_lib/x-provider/   graphql.js（主，queryId 运行时发现+缓存）· official.js（API v2 备选）
functions/admin.js    /admin 服务端门禁（未登录只下发 3.9KB 登录页）
migrations/           0001～0009 建表与数据迁移
scripts/              seed / snapshot / full-sync / refetch-avatars / delete-by-date
                      bump-assets（给 js/css 引用打内容哈希，改完前端必跑）/ gen-keys
tests/                离线语义 + jsdom 前端 + 端到端（npm test / npm run test:e2e）
```

## 相对原站修掉的问题

原站后端从未公开（私有仓库 + 线上未部署 Functions），这里按客户端调用点反推实现，
并顺手修掉了一批原站的真实缺陷：

| 问题 | 原站 | 这里 |
|---|---|---|
| 归档图片不可恢复 | 只存 R2 key，源 URL 丢弃 → 324/332 条图片永久丢失 | `avatar_key` + `avatar_origin` 双存，随时可补抓 |
| X 凭据明文回传 | GET credentials 原样返回 ct0/auth_token，前端写 localStorage | AES-GCM 加密入库，只回 hasCredentials |
| 屏蔽功能整体失效 | 88 行写了 `is_blocked`，三处读取路径全都不过滤 | 写读两侧同一过滤条件，快照 SQL 逐字一致 |
| 孤儿数据 | 同步/添加/导入都可能插行漏建归属 | `ensureOwnership()` 统一入口 + 管理台孤儿告警一键修复 |
| 删除留孤儿 | 外键声明了 CASCADE，但 D1 默认不强制 | 七张关联表显式清理（`purgeBlogger`） |
| 时间线永远为空 | history 有读无写 | 同步时真正写入字段 diff |
| 「今日精选」每次刷新都变 | `Math.random()` | 按日期取种子，当天稳定 |
| SSRF | `/api/media?url=` 无限制 | twimg 白名单 |
| 静态快照陈旧 | 投稿/改可见性后首页永远旧的 | stale-while-revalidate：快照先出图，再与 API 核对换新 |

## 已知限制

- X 抓取走 web 客户端内部 GraphQL 接口，`queryId` 会轮换（已做运行时发现 + 24h 缓存），
  自动化访问受 X ToS 约束 —— 本项目的定位是**用你自己的凭据归档你自己关注的账号**，
  小规模、遵守速率限制。想走完全受许可的路径可切换到 `official.js`（X API v2 付费档）
- D1 默认不强制外键（`ON DELETE CASCADE` 不生效），所有级联删除都是显式 SQL ——
  新增关联表时记得进 `purgeBlogger()`，这是本项目最容易踩的坑
- 公告时间判定依赖 SQL 的 `datetime()` 归一化，ISO 与 `datetime('now')` 不能直接字符串比较
  （`'T'` > `' '`，同天内任意时间都会被判成未来）—— 已在查询里处理，改 SQL 前先读注释

## License

未指定开源许可证（保留所有权利）。如需开源发布，请自行添加许可证文件。
