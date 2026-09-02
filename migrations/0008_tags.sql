-- 0008: 个人标签 / 文件夹
--
-- ── 一个设计决定：标签是"每用户对博主的标注"，收录与收藏**共用**同一套 ──
--
-- 另一种做法是收录一套标签、收藏另一套。不这么做的原因：同一位博主既可能被你
-- 收录、也可能被你收藏，两套标签就要给同一个人贴两次，而且"这个标签属于哪一边"
-- 会变成一个用户必须时刻记住的额外概念。
-- 共用一套之后：标签就是你对这个人的分类，在哪个页面看都是同一批标签。
--
-- ── 为什么 blogger_tags 里冗余存 user_id ──
-- user_id 能从 tag_id 推出来（tags.user_id），但每次按人查标签都要 JOIN tags。
-- 冗余一列换来 (user_id, blogger_id) 的直接索引 —— 列表页要一次取回
-- "我这些博主各自有哪些标签"，这个索引是关键。
-- 代价是写入时必须保证 user_id 与 tags.user_id 一致，由服务端强制（见 api/tags.js）。

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,                                  -- 前端色板的键名，不存具体色值
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- 同一用户下标签名唯一（大小写不敏感）。用 LOWER() 而不是 COLLATE NOCASE：
-- NOCASE 在 SQLite 里只对 ASCII 生效，而标签名大概率是中文，行为会不一致。
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_name ON tags (user_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags (user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS blogger_tags (
  user_id     TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  blogger_id  TEXT NOT NULL REFERENCES bloggers(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (tag_id, blogger_id)
);

CREATE INDEX IF NOT EXISTS idx_btags_user_blogger ON blogger_tags (user_id, blogger_id);
CREATE INDEX IF NOT EXISTS idx_btags_blogger ON blogger_tags (blogger_id);
