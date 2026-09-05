# [X-符离集 · x-vault](https://flj.wmxs.cloud/)

X (Twitter) 博主的策展画廊 + 永久归档。

核心目的不是浏览，而是**保险**：你关注的博主被封号、注销或改名之后，档案仍然在、
仍然找得到。消失的账号会进入「赛博坟场」筛选，而不是从库里蒸发。

跑在 Cloudflare 全家桶上（Pages + Functions + D1 + R2），免费档即可部署。
无构建步骤，前端是原生 HTML / CSS / JS。

> 前端脱胎自 [nv-pu-sa](https://nv-pu-sa.pages.dev/) 已发布的静态资源并做了大量改造；
> 后端（原站不存在）从零实现，功能已大幅扩展。

## 功能

### 公开画廊

- 瀑布流 + 无限滚动；搜索、筛选、排序、三种视图（网格 / 紧凑 / 列表）
- 随机探索：按日期取种子，当天结果稳定
- 三级数据降级：静态快照 `archive.json`（CDN 直出，零 D1 读）→ `/api/archive` →
  `localStorage`。后端整个挂掉，画廊照常工作
- 公开投稿：格式校验 → 限流 → 去重 → 去 X 核实存在 → 抓资料入库，无需人工审核
- 站点公告：级别 / 置顶 / 定时上下线 / 关闭后可重新提醒

### 账号

GitHub / Google OAuth 登录，不开放邮箱注册。

- 授权码流程 + PKCE + 一次性 state
- 身份键是 `(provider, sub)` 而非邮箱，不做跨提供方合并
- 可选白名单：`ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`

### 个人空间

| 路径 | 内容 |
|---|---|
| `/my` | 我的收录：公开 / 私密逐条或批量切换、标签分类、取消收录 |
| `/favorites` | 我的收藏：独立于收录的私人清单，与收录共用一套标签 |

两个页面复用画廊的全部能力（搜索、排序、视图切换、无限滚动、详情抽屉）。

### 管理台 `/admin`

账号密码登录，服务端门禁 —— 未登录不下发面板 HTML。

- 档案增删改；「全站下架」与「仅站长可见」严格区分
- 撤出公开仓 vs 彻底删除（后者要确认短语，并提示会牵连多少人的收录）
- 补回头像（进度弹窗 + 实时日志 + 429 自动冷却续跑）
- 一键同步（增量抓新关注）/ 完整核对（断点续跑，适配免费档查询预算）
- 粉丝数分析、投稿记录、公告管理

## 存储设计：一份数据 + 指针 + 引用计数

同一位博主（同一个 X id）在库里**永远只有一份** `bloggers` 行 + 一份 R2 媒体。
谁在用它由逐行「指针」表示：

```
bloggers (@alice)  ←── blogger_owners(公开仓, public)     公开仓的指针
                   ←── blogger_owners(用户A, private)     A 的私人指针
                   ←── blogger_owners(用户B, public)      B 的指针
                   ←── favorites(用户C)                   C 只是收藏
```

三条规则由此自然成立，不需要任何「这是谁上传的」判断：

1. **取消收录只删自己那行指针** —— 公开仓和其他人的收录纹丝不动
2. **可见性** —— 只要还剩任意一行 public 指针就在公开画廊；全是 private 时只对持有人可见
3. **数据何时真正删除** —— 引用计数归零（无归属、无收藏）时自动回收整份档案，
   变更时间线、粉丝快照、标签、R2 媒体一并清理

「管理员上传的只能管理员删」是第 3 条的推论：管理员那行指针本身就是一个引用。

账号从 X 消失时只落墓碑（`is_suspended`：0 正常 / 1 封号 / 2 注销），**绝不删档案**。

## 快速开始

前置：Node ≥ 22、一个 Cloudflare 账号。

```bash
npm install

# 1. 建 D1 与 R2，把返回的 database_id 填进 wrangler.toml
npm run db:create
npm run r2:create

# 2. 建表 + 灌样例数据
npm run setup:local

# 3. 生成密钥，把输出写进 .dev.vars（模板见 .dev.vars.example）
node scripts/gen-keys.mjs

# 4. 起服务
npm run dev            # http://localhost:8788
```

管理台在 `/admin`，默认用户名 `admin`（`.dev.vars` 里的 `ADMIN_USERNAME` 可改）。

真实数据快照不入库，所以克隆后库里是空的、画廊显示样例数据 —— 跑一次同步或从备份导入即可。

### 改完前端必须跑

```bash
npm run bump
```

给 `app.js` / `admin.js` / `style.css` 的引用打内容哈希。Cloudflare 区域级的
Browser Cache TTL 会覆盖源站 `Cache-Control`，不打戳会出现「新 HTML + 旧 JS」——
按钮在页面上但事件没绑上，而且不报任何错。

## 配置

Secrets（部署用 `wrangler pages secret put <NAME>`，本地写进 `.dev.vars`）：

| 名称 | 用途 |
|---|---|
| `ADMIN_PASSWORD_HASH` | 管理员密码的 PBKDF2 哈希 |
| `SESSION_SECRET` | 会话与 IP 哈希的盐（必填） |
| `CREDENTIAL_ENC_KEY` | X 凭据的 AES-GCM 密钥（32 字节 base64） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub 登录 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google 登录 |
| `GITHUB_PAT` | 派发全量刷新 workflow，需 `actions:write` |

OAuth 不配置则登录按钮置灰，其余功能不受影响。密钥统一用 `node scripts/gen-keys.mjs` 生成。

`wrangler.toml` 的 `[vars]`：`GITHUB_REPO`（`owner/repo`）、`GITHUB_WORKFLOW_FILE`。

其余可选项见 [.dev.vars.example](.dev.vars.example)：`SITE_ORIGIN`（建议填死，redirect_uri
要与提供方后台逐字一致）、`ADMIN_EMAILS`、`ALLOWED_EMAILS`、`ALLOWED_EMAIL_DOMAINS`。

**OAuth 回调地址**（结尾无斜杠）：

```
https://你的域名/api/auth/callback/github
https://你的域名/api/auth/callback/google
```

## 部署

```bash
npm run db:migrate     # 远端建表，migrations 按序号逐个执行
npm run seed           # 灌数据
npm run bump           # 打版本戳
npm run deploy
```

GitHub Actions 全量刷新另需仓库 secrets：`X_CT0`、`X_AUTH_TOKEN`、
`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。

## 测试

```bash
npm test          # 离线：语义 59 项 + jsdom 前端 27 项，不需要起服务
npm run test:e2e  # 端到端 27 项（先 npm run dev），自带测试数据创建与清理
npm run lint
```

| 文件 | 覆盖 |
|---|---|
| `tests/test-uncollect.mjs` | 内存 SQLite + D1 shim 直接跑真 handler：引用计数语义、公开仓保护、回收后全表无残留、越权与错误路径 |
| `tests/test-uncollect-ui.mjs` | 真 `index.html` + 真 `app.js` 跑在 jsdom：按钮可见性、确认框、请求体、就地移除、批量分片 |
| `tests/e2e-uncollect.mjs` | 打运行中的服务：真实画廊数据验证保护、假博主验证回收，跑完自清 |

## 项目结构

```
public/               前端：index.html（画廊）· admin.html（管理台）· app.js · admin.js · style.css
functions/api/        Pages Functions，一文件一路由
functions/_lib/       auth · user-auth · oauth · crypto · db · http · sync · ratelimit
functions/_lib/x-provider/    graphql.js（主，queryId 运行时发现 + 缓存）· official.js（X API v2 备选）
functions/admin.js    /admin 服务端门禁
migrations/           建表与数据迁移，按序号执行
scripts/              seed · snapshot · full-sync · refetch-avatars · bump-assets · gen-keys
tests/                离线语义 · jsdom 前端 · 端到端
```

## 安全

| 面 | 做法 |
|---|---|
| 会话 | 管理台与用户两套独立会话表，库里只存 SHA-256，可即时吊销；Cookie HttpOnly |
| 密码 | PBKDF2-SHA256 10 万轮 + 常数时间比较；登录失败不区分「用户不存在」与「密码错误」 |
| 暴力破解 | 管理台登录限流 5 次 / 分钟 / IP |
| 投稿限流 | 每 IP 每小时 5 次、每天 20 次；全站每小时 60 次；IP 只存加盐哈希 |
| SSRF | `/api/media?url=` 限 twimg 白名单；`?key=` 限 `avatars/` `covers/` 前缀 |
| SQL | 全部参数化查询；排序与状态枚举走白名单映射 |
| XSS | 公告与简介纯文本存储、渲染时转义；外链带 `rel="noopener noreferrer"` |
| X 凭据 | AES-GCM 加密入库，永不回传前端（只回 `has_credentials`），用户可随时清除 |

站长（能同时读 D1 与 Secret）技术上可以解密任何用户保存的 X 凭据 —— 前端已就此明确告知用户。

## 注意事项

- X 抓取走 web 客户端的内部 GraphQL 接口，`queryId` 会轮换（已做运行时发现 + 24h 缓存）。
  自动化访问受 X 服务条款约束；本项目的定位是**用你自己的凭据归档你自己关注的账号**，
  小规模、遵守速率限制。需要完全受许可的路径可切到 `official.js`（X API v2 付费档）
- D1 默认不强制外键，`ON DELETE CASCADE` 不会真的级联 —— 新增关联表时必须同步加进
  `purgeBlogger()`，否则回收会留下孤儿行
- 公开投稿默认进公开仓且公开（无审核是产品决定），护栏是限流 + X 存在性核实
- 部署前请确认仓库是否应当公开：`public/data/archive.json` 与 `backups/` 含真实创作者档案，
  默认已被 `.gitignore` 排除

## License

[MIT](LICENSE)。

后端（`functions/`）、迁移（`migrations/`）、脚本（`scripts/`）与测试（`tests/`）为本项目原创，
MIT 明确覆盖 —— 被复刻的站点从未公开后端，这部分是按其客户端调用点反推后从零编写的。

`public/` 下的前端资源最初派生自 [nv-pu-sa](https://nv-pu-sa.pages.dev/) 已发布的静态资源，
该来源未附带任何许可证，重构仍在进行中。复用这部分前请先读
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，那里有逐文件的实测重合度与当前状态。
