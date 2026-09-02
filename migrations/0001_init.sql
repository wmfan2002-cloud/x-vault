-- x-vault · initial schema
-- 类型选择依据: _reference/spec/04-data-model.md (对齐 332 条真实数据实测)

-- ============================================================
-- 主表: 博主归档
-- ============================================================
CREATE TABLE IF NOT EXISTS bloggers (
  -- X 数字 id, 实测最长 19 位, 超出 IEEE754 安全整数范围 -> 必须 TEXT
  id                TEXT    PRIMARY KEY,
  -- handle 会改名, 不能当主键; 但同一时刻唯一
  screen_name       TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL DEFAULT '',
  description       TEXT    NOT NULL DEFAULT '',
  followers_count   INTEGER NOT NULL DEFAULT 0,
  -- 0/1 整数, 不是布尔; 现代 X 由 is_blue_verified 派生
  verified          INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verified_type     TEXT,
  -- 三态: 0 正常 / 1 封号 / 2 注销。账号消失也绝不删记录 —— 这是产品的全部意义
  is_suspended      INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0,1,2)),
  -- 管理员手动屏蔽, 与 X 状态无关
  is_blocked        INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0,1)),
  -- 媒体双存: 原站只存 key, R2 一挂 324/332 条图片永久丢失。key 用于取图, origin 用于灾难恢复
  avatar_key        TEXT,
  avatar_origin     TEXT,
  cover_key         TEXT,
  cover_origin      TEXT,
  -- ISO-8601 带毫秒 + Z
  backed_up_at      TEXT    NOT NULL,   -- 首次归档, UPSERT 时不可覆盖
  last_synced_at    TEXT,
  clicks_card       INTEGER NOT NULL DEFAULT 0,
  clicks_timeline   INTEGER NOT NULL DEFAULT 0,
  clicks_roulette   INTEGER NOT NULL DEFAULT 0
  -- total_clicks 不建列: 实测恒等于三者之和, 查询时 SUM
);

CREATE INDEX IF NOT EXISTS idx_bloggers_followers ON bloggers(followers_count DESC);
CREATE INDEX IF NOT EXISTS idx_bloggers_backed_up ON bloggers(backed_up_at DESC);
CREATE INDEX IF NOT EXISTS idx_bloggers_suspended ON bloggers(is_suspended);
CREATE INDEX IF NOT EXISTS idx_bloggers_blocked   ON bloggers(is_blocked);
CREATE INDEX IF NOT EXISTS idx_bloggers_name      ON bloggers(name);
CREATE INDEX IF NOT EXISTS idx_bloggers_clicks
  ON bloggers((clicks_card + clicks_timeline + clicks_roulette) DESC);

-- ============================================================
-- 字段变更时间线 (支撑 GET /api/history)
-- 原站有读取方却无写入方, 时间线永远空。这里由同步 diff 真正写入。
-- ============================================================
CREATE TABLE IF NOT EXISTS blogger_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  blogger_id  TEXT    NOT NULL REFERENCES bloggers(id) ON DELETE CASCADE,
  -- 冗余一份, 便于改名后仍能按旧 handle 检索
  screen_name TEXT    NOT NULL,
  -- 前端已实现中文标签的取值:
  -- name / screen_name / avatar_url / cover_url / description / is_suspended
  field       TEXT    NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_blogger ON blogger_history(blogger_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_handle  ON blogger_history(screen_name, changed_at DESC);

-- ============================================================
-- 粉丝数快照 (原站缺失, analytics 图表本该有的数据源)
-- ============================================================
CREATE TABLE IF NOT EXISTS follower_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  blogger_id      TEXT    NOT NULL REFERENCES bloggers(id) ON DELETE CASCADE,
  followers_count INTEGER NOT NULL,
  captured_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_blogger ON follower_snapshots(blogger_id, captured_at DESC);

-- ============================================================
-- 同步任务状态 (支撑 GET /api/sync-status) —— 单行表
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  running       INTEGER NOT NULL DEFAULT 0,
  current       INTEGER NOT NULL DEFAULT 0,
  new_fetched   INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  last_item     TEXT,     -- JSON {screen_name,name,followers_count}
  cursor        TEXT,     -- X 分页游标, 中断可续
  error         TEXT,
  started_at    TEXT,
  finished_at   TEXT
);

INSERT OR IGNORE INTO sync_state (id, running) VALUES (1, 0);

-- ============================================================
-- 配置与凭据
-- 原站把 X 的 ct0/auth_token 明文回传前端并写进 localStorage。这里只存加密态, 永不出网。
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,   -- 敏感项存 AES-GCM 密文, 密钥走 Secret
  updated_at  TEXT NOT NULL
);
-- 约定 key:
--   admin_password_hash    PBKDF2-SHA256 (>=100k 轮), 绝不明文
--   x_ct0_enc              加密后的 ct0
--   x_auth_token_enc       加密后的 auth_token
--   x_account_handle       验证成功时缓存的 @handle, 供 UI 回显 (非敏感)
--   x_query_id_following   运行时发现的 GraphQL queryId, 缓存 24h
--   snapshot_generated_at  静态快照最后生成时间

-- ============================================================
-- 管理台会话 (令牌走 HttpOnly Cookie, 服务端校验)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,   -- 只存令牌的 SHA-256, 库泄露也无法冒用
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
