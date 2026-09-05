# 第三方来源说明

本项目以 MIT 授权（见 [LICENSE](LICENSE)）。本文件说明代码来源，供使用者判断可用范围。

## 完全由本项目编写

以下部分为本项目原创，MIT 授权明确覆盖：

| 路径 | 说明 |
|---|---|
| `functions/` | 全部后端。Pages Functions 路由、认证、OAuth、加密、X 抓取、引用计数存储层 |
| `migrations/` | 数据库结构与迁移 |
| `scripts/` | 同步、快照、灌数据、资源版本戳等工具 |
| `tests/` | 离线语义、jsdom 前端、端到端测试 |

后端不存在任何第三方代码来源 —— 被复刻的站点从未公开后端实现，本项目按其客户端调用点反推后从零编写。

## 派生自第三方，正在重构

`public/` 下的前端静态资源（`index.html`、`admin.html`、`app.js`、`admin.js`、`style.css`）
最初取自 [nv-pu-sa](https://nv-pu-sa.pages.dev/) 已公开发布的静态资源，并在此基础上大量修改。

截至目前的实测重合度（按去空白后的非空行比对）：

| 文件 | 与来源逐字相同的行占比 |
|---|---|
| `app.js` | 48% |
| `index.html` | 51% |
| `admin.js` | 56% |
| `admin.html` | 67% |
| `style.css` | 70% |

**该来源未附带任何许可证或版权声明**，其代码仓库亦不可访问。因此这部分的授权状态未经确认，
不应假定 MIT 覆盖它。重构正在进行，目标是让 `public/` 下不再残留来源代码。

如果你要复用本项目：

- 后端、迁移、脚本、测试 —— 按 MIT 自由使用
- `public/` 下的前端 —— 在重构完成前请自行评估，或只取后端自行实现界面

如果你是上述来源的权利人并对此有异议，请通过仓库 issue 联系，我会配合处理。

## 运行时依赖（不随仓库分发）

| 依赖 | 用途 | 授权 |
|---|---|---|
| [Chart.js](https://www.chartjs.org/) 4.4.x | 管理台图表，由 jsDelivr CDN 加载 | MIT |
| Google Fonts（Plus Jakarta Sans、JetBrains Mono） | 字体，由 Google CDN 加载 | SIL Open Font License 1.1 |
| [wrangler](https://developers.cloudflare.com/workers/wrangler/) | 开发与部署工具（devDependency） | MIT / Apache-2.0 |
| [jsdom](https://github.com/jsdom/jsdom)、[eslint](https://eslint.org/) | 测试与静态检查（devDependency） | MIT |

这些均通过 CDN 或 npm 引入，不包含在本仓库中。
