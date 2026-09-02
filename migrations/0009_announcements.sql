-- 0009: 站点公告（只有管理台能发）
--
-- ── 为什么正文只存纯文本 ──────────────────────────────────────
-- 公告是**管理员写、渲染到每个访客页面上**的内容。如果允许 HTML，
-- 那就是一个覆盖全站的存储型 XSS 面：管理台会话一旦被劫，攻击者不需要改代码，
-- 发一条公告就能在所有访客浏览器里执行脚本。
-- 所以正文存纯文本，前端用 escapeHtml + 自动链接化渲染（复用 formatBioWithLinks
-- 的同一套做法），换行靠 white-space: pre-wrap，不需要任何标签。
--
-- ── starts_at / ends_at ───────────────────────────────────────
-- 可选的定时上线/下线。留空表示"立即生效、永不过期"。
-- 判定放在**查询里**（SQL 的 datetime 比较），不靠后台任务 ——
-- 边缘环境没有常驻进程，定时任务会是另一套要维护的东西。

CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  body        TEXT NOT NULL,                       -- 纯文本，渲染时转义
  level       TEXT NOT NULL DEFAULT 'info'
              CHECK (level IN ('info', 'warn', 'urgent')),
  pinned      INTEGER NOT NULL DEFAULT 0,          -- 置顶：横幅优先展示它
  is_active   INTEGER NOT NULL DEFAULT 1,          -- 下线但保留（区别于删除）
  starts_at   TEXT,                                -- NULL = 立即
  ends_at     TEXT,                                -- NULL = 不过期
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 公开读的排序键：置顶优先、然后按创建时间倒序
CREATE INDEX IF NOT EXISTS idx_ann_live
  ON announcements (is_active, pinned DESC, created_at DESC);
