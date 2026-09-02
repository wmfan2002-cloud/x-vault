-- 0004: (a) 同步默认可见性  (b) 账号改为仅 OAuth
--
-- 背景（两个都是实际踩出来的）：
--
-- (a) 站长在管理台点「一键同步」抓进来的博主，之前**没有任何 blogger_owners 行**
--     —— sync-following.js 只写 bloggers，不写归属。而 listAll() 要求至少一个
--     public 归属，所以同步进来的博主直接就是不可见的孤儿（库里已有 1 条：
--     @shenyexulaoshi）。这里补两件事：补回孤儿的归属，并让同步默认落成 private，
--     由站长挑选后再公开。
--
--     为什么不能靠「屏蔽」来做筛选：is_blocked 是 bloggers 表上的**全局**列，
--     一旦置 1，别人后来收录同一位博主也进不了公开画廊。用 per-owner 的
--     visibility='private' 才只影响站长自己这一条归属。
--
-- (b) 账号只允许 GitHub / Google 登录，禁止邮箱注册。
--     oauth_sub 是提供方的稳定用户 ID（GitHub 的 id、Google 的 sub）；
--     **不能用邮箱做主键** —— 用户可以在 GitHub 改邮箱，改完就成了另一个人。
--     partial unique index 而非普通 unique：历史行（admin-legacy 等）这两列是
--     NULL，普通 unique 在 SQLite 里允许多个 NULL，但写成 partial 更明确。

-- ── (a) 同步默认可见性 ────────────────────────────────────────
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('sync_default_visibility', 'private', datetime('now') || 'Z');

-- 补回孤儿：同步进来但没有归属行的，挂到站长名下并设为 private
INSERT OR IGNORE INTO blogger_owners (user_id, blogger_id, visibility, created_at)
SELECT 'admin-legacy', b.id, 'private', COALESCE(b.backed_up_at, datetime('now') || 'Z')
  FROM bloggers b
 WHERE NOT EXISTS (SELECT 1 FROM blogger_owners o WHERE o.blogger_id = b.id);

-- ── (b) OAuth 身份 ───────────────────────────────────────────
ALTER TABLE users ADD COLUMN oauth_provider TEXT;
ALTER TABLE users ADD COLUMN oauth_sub      TEXT;
ALTER TABLE users ADD COLUMN avatar_url     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
  ON users (oauth_provider, oauth_sub)
  WHERE oauth_provider IS NOT NULL AND oauth_sub IS NOT NULL;

-- OAuth 回调用的一次性 state，防 CSRF；Google 还要存 PKCE verifier。
-- 存库而不是只放 Cookie：Cookie 会被 SameSite=Lax 在跨站跳回时带上，
-- 但存库能保证 state 只能用一次（用完即删），Cookie 做不到这点。
CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  code_verifier TEXT,
  redirect_to   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states (created_at);
