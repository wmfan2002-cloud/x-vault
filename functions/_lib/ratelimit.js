/**
 * 轻量内存限流（isolate 级，尽力而为）。
 *
 * Workers 的隔离体之间没有共享内存 —— 同一 IP 打到不同 isolate 会各自计数，
 * isolate 回收后计数清零。所以它挡不住分布式刷子，只挡"单点脚本的最粗暴滥用"，
 * 换来的是零基础设施：不建表、不依赖 KV/DO。
 *
 * 需要精确限流的场景走数据库计数那条路（见 submit.js 的 submissions 表限流）；
 * 这里只给两个没有专属基础设施的写入口兜底：/api/track-click 与 /api/admin/login。
 */

const windows = new Map();
const MAX_KEYS = 10_000; // 防 Map 无限增长（伪造 XFF 的场景），超阈值整体清扫过期项

/**
 * 固定窗口计数。每 windowMs 内最多 max 次，超限返回 false。
 * bucket 是用途名，不同端点互不干扰。
 */
export function rateLimit(bucket, ip, max, windowMs) {
  const now = Date.now();
  if (windows.size > MAX_KEYS) {
    for (const [k, w] of windows) {
      if (now > w.reset) windows.delete(k);
    }
  }

  const key = `${bucket}:${ip}`;
  const w = windows.get(key);
  if (!w || now > w.reset) {
    windows.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  w.count += 1;
  return w.count <= max;
}

/** 客户端 IP。Cloudflare 上 cf-connecting-ip 不可伪造；自托管回退 x-forwarded-for 首段。 */
export const clientIp = (request) =>
  request.headers.get('cf-connecting-ip')
  || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
  || 'local';
