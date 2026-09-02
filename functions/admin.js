/**
 * GET /admin —— 服务端门禁。
 *
 * 原站（以及未加这层之前的本站）把 admin.html 整页直接下发给任何访客：Cookie 配置表单、
 * 同步控制台、博主管理表格、危险区、全部中文文案、全部元素 id 都在 DOM 里，登录门只是
 * 一个 CSS class（admin.js 的 showGate() 加/去 .hidden）。
 * 拿不到数据（/api/admin/* 都要令牌），但整个界面结构、字段名、端点路径对外全公开 ——
 * 本项目的后端契约就是这么被反推出来的。
 *
 * 这里改成：未登录只返回一个精简登录页，面板 HTML 根本不下发。
 * 登录成功后 admin.js 会 location.reload()，届时带着 Cookie 拿到完整页面。
 */
import { requireAdmin } from './_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env, next } = context;

  if (await requireAdmin(request, env)) {
    return next(); // 已登录：下发完整 admin.html
  }

  return new Response(LOGIN_PAGE, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

// 自包含登录页：不引用 admin.js / style.css，避免泄露面板结构。
// 视觉上沿用主站的 OLED 配色与字体，登录成功后 reload 进真正的控制台。
const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>管理控制台 · X-符离集</title>
<link rel="icon" type="image/png" href="/logo-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{min-height:100vh;display:grid;place-items:center;background:#000;color:#f8fafc;
    font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;padding:24px}
  .card{width:100%;max-width:380px;background:hsla(0,0%,5%,.85);border:1px solid hsla(0,0%,100%,.1);
    border-radius:20px;padding:32px;backdrop-filter:blur(20px);
    box-shadow:0 24px 50px -12px hsla(0,0%,0%,.95)}
  .logo{width:46px;height:46px;border-radius:13px;margin-bottom:18px;object-fit:cover}
  h1{font-size:20px;font-weight:800;letter-spacing:-.02em}
  p{color:hsl(215,16%,50%);font-size:13px;margin-top:6px;line-height:1.6}
  label{display:block;font-size:12px;font-weight:600;color:hsl(215,20%,70%);margin:18px 0 7px}
  input{width:100%;padding:11px 13px;background:hsla(0,0%,100%,.05);
    border:1px solid hsla(0,0%,100%,.18);border-radius:11px;color:#f8fafc;font-size:14px;
    font-family:inherit;transition:border-color .15s}
  input:focus{outline:none;border-color:hsla(199,89%,60%,.55);background:hsla(0,0%,100%,.08)}
  button{width:100%;margin-top:22px;padding:12px;background:hsl(199,89%,60%);color:#000;
    border:none;border-radius:11px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;
    transition:background .15s}
  button:hover:not(:disabled){background:hsl(199,89%,50%)}
  button:disabled{opacity:.6;cursor:not-allowed}
  .err{margin-top:14px;padding:10px 12px;background:hsla(350,89%,60%,.14);
    border:1px solid hsla(350,89%,60%,.3);border-radius:9px;color:hsl(350,89%,72%);
    font-size:12.5px;display:none}
  .foot{margin-top:20px;text-align:center;font-size:12px}
  .foot a{color:hsl(215,16%,50%);text-decoration:none}
  .foot a:hover{color:hsl(199,89%,60%)}
</style>
</head>
<body>
  <main class="card">
    <img src="/logo-icon.png" alt="" class="logo" onerror="this.style.display='none'">
    <h1>管理控制台</h1>
    <p>需要通行鉴权后才能进入。</p>
    <form id="f" autocomplete="on">
      <label for="u">管理员账号</label>
      <input id="u" name="username" type="text" required autocomplete="username" autofocus>
      <label for="p">通行密码</label>
      <input id="p" name="password" type="password" required autocomplete="current-password">
      <button type="submit" id="b">解密并进入控制台</button>
      <div class="err" id="e"></div>
    </form>
    <div class="foot"><a href="/">← 返回画廊</a></div>
  </main>
<script>
const f=document.getElementById('f'),b=document.getElementById('b'),e=document.getElementById('e');
f.addEventListener('submit',async(ev)=>{
  ev.preventDefault();
  b.disabled=true;b.textContent='正在解密...';e.style.display='none';
  try{
    const r=await fetch('/api/admin/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:document.getElementById('u').value.trim(),
                           password:document.getElementById('p').value})
    });
    const j=await r.json();
    if(j.success&&j.token){
      // admin.js 仍从 localStorage 读令牌（兼容旧头），同时服务端已下发 HttpOnly Cookie
      localStorage.setItem('x_archive_admin_token',j.token);
      location.reload();
      return;
    }
    e.textContent=j.error||'账号或通行密码错误';e.style.display='block';
  }catch(err){
    e.textContent='网络错误，请稍后重试';e.style.display='block';
  }
  b.disabled=false;b.textContent='解密并进入控制台';
});
</script>
</body>
</html>`;

