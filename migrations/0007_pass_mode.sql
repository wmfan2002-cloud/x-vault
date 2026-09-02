-- 0007: 补历史模式
--
-- 0005/0006 让同步能断点续跑了，但**救不了已经卡住的状态**：
-- 站长的账号在旧代码下撞到 MAX_PER_RUN=120 就停了，而旧代码从没写过游标 ——
-- 所以现在 cursor 是 NULL，resuming 判定为 false，「连续 3 位已知即停」照样触发，
-- 依然永远过不了第 120 位。
--
-- 缺的是一个显式模式：
--   incremental  从最新关注开始扫，连续 3 位已知就停。日常用，很快。
--   full         走完**整个**关注列表，不理"连续已知"判据。用来补历史 /
--                强制完整核对。跨多个批次保持，直到走到末尾才清掉。
--
-- 为什么不能靠 cursor 非空来推断：一轮 full 的**第一批**还没有游标。
--
-- 另外 full 模式下要**便宜地跳过**已收录的：只查一次归属就跳过，
-- 不跑 upsertBlogger（那要约 5 次查询）。站长的原话是
-- 「不是应该快速过滤已经同步过的然后继续吗」—— 就是这件事。

ALTER TABLE sync_state      ADD COLUMN pass_mode TEXT;
ALTER TABLE user_sync_state ADD COLUMN pass_mode TEXT;
