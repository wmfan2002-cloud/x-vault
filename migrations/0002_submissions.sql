-- 公开投稿：任何访客都能提交想收录的博主，后台自动去重 + 校验后直接入库（无人工审核）

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_name   TEXT    NOT NULL,
  -- accepted  已入库
  -- duplicate 已在库中
  -- rejected  X 上不存在 / 已封号 / 格式不合法
  -- failed    抓取异常（可重试）
  status        TEXT    NOT NULL,
  reason        TEXT,
  blogger_id    TEXT,
  -- 只存访客 IP 的哈希用于限流，不留原始 IP
  ip_hash       TEXT,
  created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sub_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_handle  ON submissions(LOWER(screen_name));
-- 限流查询: 某 IP 在时间窗内的提交数
CREATE INDEX IF NOT EXISTS idx_sub_ip      ON submissions(ip_hash, created_at DESC);
