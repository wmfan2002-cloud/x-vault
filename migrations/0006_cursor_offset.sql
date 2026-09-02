-- 0006: 页内断点
--
-- 0005 把断点做在页边界上，理由是"游标含义是下一页从这里取，页中间存它会漏人"。
-- 那个理由仍然成立，但**实测 X 的 Following 端点完全无视 count 参数**：
-- 传 5 / 20 / 100 都固定返回 50 人一页。
--
-- 后果：只按页边界断点的话，最小一批就是 50 位 × 约 8 次 D1 查询 = 400 次，
-- 而 Cloudflare Free 每次 Worker 调用只有 50 次额度 —— 超了 8 倍，分批等于没做。
--
-- 所以断点必须能落在页**内部**。状态从「一个游标」变成一对：
--   cursor        取到当前这一页所用的游标（NULL = 第一页）
--   cursor_offset 这一页里已经处理完的人数
-- 含义：下一个待处理的人 = 用 cursor 取到的那页的第 cursor_offset 个。
--
-- 恢复时重新取同一页（1 次 HTTP，不花 D1 查询），跳过前 cursor_offset 个，
-- 从那里继续。重复取页的代价远小于超配额。

ALTER TABLE sync_state      ADD COLUMN cursor_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_sync_state ADD COLUMN cursor_offset INTEGER NOT NULL DEFAULT 0;
