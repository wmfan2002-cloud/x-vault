/**
 * X 抓取 provider —— 官方 API v2 实现（受许可路径，需付费档位）。
 *
 * 与 ./graphql.js 接口一致，可直接替换：
 *   verifyCredentials(creds, env) -> { id, screen_name, name, avatar_url }
 *   iterateFollowing(creds, env, opts) -> async generator
 *
 * 差异：
 *   - creds 用 { bearer } 而不是 { ct0, authToken }
 *   - 没有 queryId 轮换问题，稳定得多
 *   - user.fields 需显式声明，否则不返回
 *
 * 启用方式：把调用处的 import 从 './x-provider/graphql.js' 换成 './x-provider/official.js'，
 * 并在 secrets 里配 X_API_BEARER。
 */

const API = 'https://api.x.com/2';
const USER_FIELDS = 'id,name,username,description,profile_image_url,public_metrics,verified,verified_type';

function headers(creds, env) {
  const bearer = creds?.bearer || env?.X_API_BEARER;
  if (!bearer) throw new Error('缺少 X API bearer（配置 X_API_BEARER）');
  return { authorization: `Bearer ${bearer}`, accept: 'application/json' };
}

export async function verifyCredentials(creds, env) {
  const res = await fetch(`${API}/users/me?user.fields=${USER_FIELDS}`, { headers: headers(creds, env) });
  if (!res.ok) {
    throw new Error(res.status === 401 ? 'API bearer 无效或已过期' : `X 返回 ${res.status}`);
  }
  const u = (await res.json()).data;
  return {
    id: String(u.id),
    screen_name: u.username,
    name: u.name,
    avatar_url: (u.profile_image_url || '').replace('_normal', '_400x400'),
  };
}

/** API v2 的用户对象 -> 我们的列。字段名与 GraphQL 版不同，映射在此收敛 */
export function normalizeUser(u) {
  if (!u?.id) return null;
  const avatar = u.profile_image_url || '';
  return {
    id: String(u.id),
    screen_name: u.username || '',
    name: u.name || '',
    description: u.description || '',
    followers_count: Number(u.public_metrics?.followers_count ?? 0),
    verified: u.verified ? 1 : 0,
    verified_type: u.verified_type || null,
    avatar_origin: avatar ? avatar.replace(/_normal(\.\w+)$/, '_400x400$1') : null,
    // v2 不返回 banner，需要另外请求；缺失是可接受的（实测原始数据 23/332 本就无 banner）
    cover_origin: null,
  };
}

export async function* iterateFollowing(creds, env, opts = {}) {
  const { userId, log = () => {}, pageSize = 100, cursor: startCursor = null } = opts;
  if (!userId) throw new Error('缺少 userId');

  let token = startCursor;
  let page = 0;

  while (true) {
    const url = new URL(`${API}/users/${encodeURIComponent(userId)}/following`);
    url.searchParams.set('user.fields', USER_FIELDS);
    url.searchParams.set('max_results', String(Math.min(pageSize, 1000)));
    if (token) url.searchParams.set('pagination_token', token);

    let res = await fetch(url, { headers: headers(creds, env) });

    let attempt = 0;
    while (res.status === 429 && attempt < 3) {
      const waitMs = 8000 * 2 ** attempt;
      log(`[POLICY] 命中 429, ${waitMs / 1000}s 后重试 (${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, waitMs));
      res = await fetch(url, { headers: headers(creds, env) });
      attempt++;
    }
    if (!res.ok) {
      throw Object.assign(new Error(`X 返回 ${res.status}`), { status: res.status, cursor: token });
    }

    const body = await res.json();
    const users = body.data || [];
    page++;
    log(`[PAGE ${page}] 本页 ${users.length} 人`);

    for (const u of users) {
      const n = normalizeUser(u);
      if (n?.screen_name) yield n;
    }

    token = body.meta?.next_token || null;
    if (!token) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
