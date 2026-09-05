/**
 * GET /api/media?key=<r2-key>   从 R2 取已归档的图
 * GET /api/media?url=<remote>   代理远端图 (仅 twimg 白名单)
 *
 *
 * 必须带 CORS: app.js 的头像 <img> 用 crossorigin="anonymous" 以便 canvas 取色,
 * 缺 CORS 头会导致取色静默失败并回落到 hash 调色板。
 */
import { MEDIA_CORS } from '../_lib/http.js';

// ?url= 是 SSRF 面, 只放行 X 的图片 CDN
const ALLOWED_HOSTS = new Set(['pbs.twimg.com', 'abs.twimg.com']);
const IMMUTABLE = 'public, max-age=31536000, immutable';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const key = u.searchParams.get('key');
  const remote = u.searchParams.get('url');

  if (key) return fromR2(env, key);
  if (remote) return fromRemote(remote);
  return new Response('缺少 key 或 url 参数', { status: 400, headers: MEDIA_CORS });
}

async function fromR2(env, key) {
  if (!env.MEDIA) {
    return new Response('R2 未绑定', { status: 503, headers: MEDIA_CORS });
  }
  // key 只会由 archiveMedia() 生成：avatars/<xId>/<hash>.jpg | covers/<xId>/<hash>.jpg。
  // 前缀白名单 + 防穿越：就算将来往桶里放了别的对象，也不会被这个公开端点读出去。
  if (key.includes('..') || !/^(avatars|covers)\//.test(key)) {
    return new Response('非法 key', { status: 400, headers: MEDIA_CORS });
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) {
    return new Response('未找到', { status: 404, headers: MEDIA_CORS });
  }
  const headers = new Headers(MEDIA_CORS);
  headers.set('content-type', obj.httpMetadata?.contentType || 'image/jpeg');
  headers.set('cache-control', IMMUTABLE);
  if (obj.httpEtag) headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

async function fromRemote(remote) {
  let target;
  try {
    target = new URL(remote);
  } catch {
    return new Response('url 不合法', { status: 400, headers: MEDIA_CORS });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return new Response('该来源不在白名单内', { status: 403, headers: MEDIA_CORS });
  }

  const upstream = await fetch(target.toString(), {
    headers: { accept: 'image/*' },
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!upstream.ok) {
    return new Response('上游取图失败', { status: upstream.status, headers: MEDIA_CORS });
  }

  const headers = new Headers(MEDIA_CORS);
  headers.set('content-type', upstream.headers.get('content-type') || 'image/jpeg');
  headers.set('cache-control', IMMUTABLE);
  return new Response(upstream.body, { headers });
}
