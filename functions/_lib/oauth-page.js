/**
 * OAuth 流程里的错误页。
 *
 * 这些地址是浏览器直接跳转过去的，不是 fetch —— 返回 JSON 的话用户看到的是
 * 一屏裸 JSON，完全不知道该干什么。所以出错必须给 HTML，且要说清下一步。
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function errorPage(title, detail, status = 400) {
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · X-符离集</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:radial-gradient(1200px 600px at 50% -10%,#2a1533,#0c0710 60%);
    color:#f2e9f5;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .card{max-width:460px;width:100%;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.1);
    border-radius:18px;padding:32px 28px;backdrop-filter:blur(12px);box-shadow:0 24px 60px rgba(0,0,0,.45)}
  h1{margin:0 0 12px;font-size:19px;letter-spacing:.3px}
  p{margin:0 0 20px;color:#c7b3cf;word-break:break-word}
  a{display:inline-block;padding:10px 20px;border-radius:999px;text-decoration:none;
    background:linear-gradient(135deg,#c86dd7,#8b5cf6);color:#fff;font-weight:600;font-size:14px}
  a:hover{filter:brightness(1.1)}
</style></head><body>
<div class="card">
  <h1>${esc(title)}</h1>
  <p>${esc(detail)}</p>
  <a href="/">返回首页</a>
</div></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
