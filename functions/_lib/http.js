/** 统一 JSON 响应 + 常量 */

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export const ok = (extra = {}) => json({ success: true, ...extra });
export const fail = (error, status = 400) => json({ success: false, error }, status);

/** ISO-8601 带毫秒 + Z —— 与现有 332 条数据的时间格式保持一致 */
export const nowIso = () => new Date().toISOString();

/** 只有 /api/media 需要跨域(头像 canvas 取色要求 crossorigin="anonymous") */
export const MEDIA_CORS = { 'access-control-allow-origin': '*' };
