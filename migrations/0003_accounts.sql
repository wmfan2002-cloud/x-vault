-- 账号系统：注册/登录、按用户归属的博主档案、公开/私密可见性、私人收藏
--
-- 设计参考 /home/fcs/stylekit 的 003_user_binding.sql：
--   · dual-mode identity —— user_id 与 session_id 各自建 partial unique index，
--     让匿名访客与登录用户共用同一张表（收藏、投稿都用这个模式）
--   · 归属关系单独建表 + CASCADE，而不是往主表塞 owner 列
-- 差异：stylekit 用 Supabase Auth（auth.users + RLS），这里没有，所以
--   密码哈希（PBKDF2-SHA256）与不透明会话令牌自己实现，复用管理台那套。
--
-- ⚠️ 关键约束：bloggers.screen_name 是 UNIQUE，所以**不能**给每个用户存一份副本。
-- 因此：一条共享的 bloggers 归档行 + 一张 blogger_owners 归属表。
-- 好处是同一个博主被多人添加时，R2 媒体和 X 请求都只发生一次，归档保持唯一权威。

-- ============================================================
-- 用户
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id             TEXT    PRIMARY KEY,          -- UUID
  email          TEXT    NOT NULL UNIQUE,      -- 统一小写存储
  password_hash  TEXT    NOT NULL,             -- pbkdf2$iters$salt$hash，绝不明文
  display_name   TEXT    NOT NULL DEFAULT '',
  role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at     TEXT    NOT NULL,
  last_login_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- ============================================================
-- 用户会话（与 admin_sessions 同构：只存令牌哈希，库泄露也无法冒用）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usess_user   ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_usess_expiry ON user_sessions(expires_at);

-- ============================================================
-- 博主归属 + 可见性
--
-- 可见性规则：只要**有任一** owner 标记 public，该博主就出现在公开画廊。
-- 用户自己的页面只列自己的归属行。
-- ============================================================
CREATE TABLE IF NOT EXISTS blogger_owners (
  user_id     TEXT    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  blogger_id  TEXT    NOT NULL REFERENCES bloggers(id)  ON DELETE CASCADE,
  visibility  TEXT    NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (user_id, blogger_id)
);

CREATE INDEX IF NOT EXISTS idx_owners_user    ON blogger_owners(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owners_blogger ON blogger_owners(blogger_id);
-- 公开画廊的核心查询：某博主是否存在任一 public 归属
CREATE INDEX IF NOT EXISTS idx_owners_public  ON blogger_owners(blogger_id, visibility);

-- ============================================================
-- 收藏（仅自己可见）
-- 用 stylekit 的 dual-mode：登录用 user_id，未登录用 session_id，
-- 各自 partial unique index，同一张表服务两种身份。
-- ============================================================
CREATE TABLE IF NOT EXISTS favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    REFERENCES users(id) ON DELETE CASCADE,
  session_id  TEXT,                                  -- 匿名访客的浏览器本地 id
  blogger_id  TEXT    NOT NULL REFERENCES bloggers(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL,
  CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS fav_user_blogger
  ON favorites(user_id, blogger_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fav_session_blogger
  ON favorites(session_id, blogger_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id, created_at DESC);

-- ============================================================
-- 每用户的 X 凭据（加密存储）
--
-- ⚠️ 安全权衡：把 X Cookie 配置开放给普通注册用户，意味着本站要为每个人
-- 保管一份"等同其 X 账号完全控制权"的密文。这是显著的责任。
-- 缓解措施：AES-GCM 加密（密钥走 Workers Secret，不在库里）、
-- 永不回传前端（只回 has_credentials + handle）、用户可随时清除。
-- ============================================================
CREATE TABLE IF NOT EXISTS user_x_credentials (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ct0_enc        TEXT NOT NULL,
  auth_token_enc TEXT NOT NULL,
  x_handle       TEXT,          -- 验证成功时缓存，供 UI 回显（非敏感）
  x_user_id      TEXT,
  updated_at     TEXT NOT NULL
);

-- ============================================================
-- 每用户的同步任务状态（原 sync_state 是全局单行表，多用户下会互相踩）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sync_state (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  running      INTEGER NOT NULL DEFAULT 0,
  current      INTEGER NOT NULL DEFAULT 0,
  new_fetched  INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  last_item    TEXT,
  cursor       TEXT,
  error        TEXT,
  started_at   TEXT,
  finished_at  TEXT
);

-- ============================================================
-- 投稿表补 user_id（沿用 stylekit 的做法：加列 + 索引，匿名投稿仍然可用）
-- ============================================================
ALTER TABLE submissions ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE submissions ADD COLUMN visibility TEXT DEFAULT 'public';
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id, created_at DESC);

-- ============================================================
-- 把已有 708 条归档挂到一个哨兵管理员账号名下，全部标记 public
--
-- 这个账号 password_hash 写 '!' —— PBKDF2 校验器只认 'pbkdf2$' 前缀，
-- 所以它永远无法登录，只作为历史数据的归属锚点。
-- 管理台走的是独立的 ADMIN_PASSWORD_HASH，不受影响。
-- ============================================================
INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, is_active, created_at)
VALUES ('admin-legacy', 'admin@localhost', '!', '站长', 'admin', 1, datetime('now') || 'Z');

INSERT OR IGNORE INTO blogger_owners (user_id, blogger_id, visibility, created_at)
SELECT 'admin-legacy', id, 'public', COALESCE(backed_up_at, datetime('now') || 'Z') FROM bloggers;
