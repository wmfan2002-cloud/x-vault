/**
 * X 抓取 provider —— Web 客户端 GraphQL 实现。
 *
 * 定位: 归档**你自己关注的账号**,
 * 用你自己的会话凭据, 小规模, 遵守速率限制。
 *
 * 脆弱点: Following 的 queryId 会被 X 轮换, 只存在于其 web bundle 里, 所以必须
 * 运行时发现 + 缓存, 不能写死。这是整条管线唯一真正易碎的地方。
 *
 * 备选实现见 ./official.js (X API v2, 需付费档位)。两者共享同一接口:
 *   verifyCredentials(creds)        -> { screen_name, name, avatar_url }
 *   iterateFollowingPages(creds, env, opts) -> async generator of { users, cursor, page, exhausted }
 *   iterateFollowing(creds, env, opts)      -> async generator of normalized users (兼容旧调用)
 */
import { getSetting, setSetting } from '../crypto.js';

// X web 前端内嵌的公开 bearer, 不是机密 —— 每个 x.com 页面的 JS 里都有。
// 可用 env.X_BEARER_TOKEN 覆盖, 以防其轮换。
const DEFAULT_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const QUERY_ID_KEY = 'x_query_id_following';
const QUERY_ID_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * queryId 缓存的读写抽象。
 * Workers 侧传 env.DB (走 settings 表); Node 脚本侧传 env.store = {get,set}
 * (见 scripts/full-sync.mjs), 这样同一份抓取逻辑两端共用, 不必复制。
 */
async function cacheGet(env, key) {
  if (env?.store) return env.store.get(key);
  if (env?.DB) return getSetting(env.DB, key);
  return null;
}
async function cacheSet(env, key, value) {
  if (env?.store) return env.store.set(key, value);
  if (env?.DB) return setSetting(env.DB, key, value);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function headers(creds, env) {
  return {
    authorization: env?.X_BEARER_TOKEN || DEFAULT_BEARER,
    cookie: `auth_token=${creds.authToken}; ct0=${creds.ct0}`,
    // X 的双提交 CSRF 校验: 这个头必须与 ct0 完全一致, 否则 403
    'x-csrf-token': creds.ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'zh-cn',
    // ⚠️ 必须带 UA。实测: 缺 UA 时 X 对 GraphQL 返回 404(而不是 401), 极易被误判成
    // "端点不存在"。curl 默认发 UA 所以手工测试是通的, Node fetch / Workers fetch 不发。
    'user-agent': UA,
    referer: 'https://x.com/home',
    origin: 'https://x.com',
    'content-type': 'application/json',
    accept: '*/*',
  };
}

/**
 * 校验凭据, 顺带拿到当前登录账号 —— 也用于 POST /api/verify-cookie
 *
 * ⚠️ 实测(2026-09) v1.1 API 面已整体下线:
 *   api.x.com/1.1/account/verify_credentials.json -> 404 code 34
 *   api.x.com/1.1/account/settings.json           -> 404 code 34
 *   api.x.com/1.1/users/show.json                 -> 403 Cloudflare 挑战页
 * 所以这里改走 GraphQL Viewer 查询。
 */
export async function verifyCredentials(creds, env) {
  const queryId = await discoverQueryId(env, { operation: 'Viewer', creds });
  const variables = encodeURIComponent(JSON.stringify({ withCommunitiesMemberships: false }));
  const features = encodeURIComponent(JSON.stringify({
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  }));

  const res = await fetch(
    `https://x.com/i/api/graphql/${queryId}/Viewer?variables=${variables}&features=${features}`,
    { headers: headers(creds, env) }
  );
  if (!res.ok) {
    throw new Error(res.status === 401 || res.status === 403
      ? 'Cookie 已失效或无效'
      : `X 返回 ${res.status}`);
  }

  const body = await res.json();
  if (body.errors?.length) throw new Error(`GraphQL 错误: ${body.errors[0].message}`);

  const result = body?.data?.viewer?.user_results?.result;
  if (!result) throw new Error('Cookie 无效: Viewer 未返回用户');

  const u = mapUserResult(result);
  return {
    id: u.id,
    screen_name: u.screen_name,
    name: u.name,
    avatar_url: u.avatar_origin || '',
  };
}

/**
 * 运行时发现 Following 的 queryId。
 * 流程: 拉 x.com 主文档 -> 找入口 bundle -> 在 bundle 里匹配 operationName:"Following"。
 * 命中后缓存 24h。失败时抛错, 由调用方决定是否降级。
 */
export async function discoverQueryId(env, { force = false, operation = 'Following', creds = null } = {}) {
  const cacheKey = `${QUERY_ID_KEY}_${operation}`;
  if (!force) {
    const cached = await cacheGet(env, cacheKey);
    if (cached) {
      try {
        const { id, at } = JSON.parse(cached);
        if (id && Date.now() - at < QUERY_ID_TTL_MS) return id;
      } catch { /* 缓存坏了就重新发现 */ }
    }
  }

  // ⚠️ 必须带 Cookie。实测(2026-09) 登出态的 x.com 返回的是新版
  // x-web/entry-client-logged-out-*.js (22KB 加载器, 0 个 queryId, queryId 散在 94 个
  // 分包里且不含 Following); 登录态才返回老版 responsive-web/client-web/main.*.js,
  // 那里面 104 个 queryId 一应俱全。
  const xc = creds || env?.credsForDiscovery;
  const docHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
    accept: 'text/html',
  };
  if (xc?.authToken && xc?.ct0) {
    docHeaders.cookie = `auth_token=${xc.authToken}; ct0=${xc.ct0}`;
  }

  const doc = await (await fetch('https://x.com/home', { headers: docHeaders })).text();

  // main.* 优先(登录态, queryId 都在里面), 其余 responsive-web 兜底
  const bundles = [...new Set([
    ...(doc.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"']*?\/main\.[^"']+?\.js/g) || []),
    ...(doc.match(/https:\/\/abs\.twimg\.com\/responsive-web\/[^"']+?\.js/g) || []),
  ])].filter((u) => !/i18n|vendor/.test(u)).slice(0, 6);

  if (!bundles.length) {
    throw new Error(
      '未能在 x.com 定位到 main bundle。若未带 Cookie, 拿到的是登出态的新版分包结构(不含 Following queryId) —— 请确认已配置 X 凭据。'
    );
  }

  for (const url of bundles) {
    let js;
    try {
      js = await (await fetch(url)).text();
    } catch {
      continue;
    }
    // {queryId:"xxxx",operationName:"Following"} —— 两种字段顺序都可能出现
    const m =
      js.match(new RegExp(`queryId:"([A-Za-z0-9_-]{18,26})",operationName:"${operation}"`)) ||
      js.match(new RegExp(`operationName:"${operation}",queryId:"([A-Za-z0-9_-]{18,26})"`));
    if (m) {
      await cacheSet(env, cacheKey, JSON.stringify({ id: m[1], at: Date.now(), src: url }));
      return m[1];
    }
  }
  throw new Error(`未能在 bundle 中匹配到 ${operation} 的 queryId (X 可能改了结构)`);
}

// features blob 缺字段会 400。这里给一份保守集合, 可用 env.X_FEATURES 覆盖。
const FEATURES = {
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  responsive_web_edit_tweet_api_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读 x-rate-limit-* 头, 余量不足时主动等到重置 */
async function respectRateLimit(res, log) {
  const remaining = parseInt(res.headers.get('x-rate-limit-remaining') || '', 10);
  const reset = parseInt(res.headers.get('x-rate-limit-reset') || '', 10);
  if (Number.isFinite(remaining) && remaining <= 5 && Number.isFinite(reset)) {
    const waitMs = Math.max(reset * 1000 - Date.now(), 0) + 1000;
    if (waitMs > 0 && waitMs < 15 * 60 * 1000) {
      log?.(`[POLICY] 速率余量仅剩 ${remaining}, 主动等待 ${Math.ceil(waitMs / 1000)}s 到窗口重置`);
      await sleep(waitMs);
    }
  }
}

/**
 * X 用户对象 -> 我们的列。
 *
 * ⚠️ 实测(2026-09) X 已把 `legacy` 整块拿掉, 字段搬到了新位置:
 *   legacy.screen_name / name        -> core.screen_name / core.name
 *   legacy.profile_image_url_https   -> avatar.image_url
 *   legacy.profile_banner_url        -> banner.image_url
 *   legacy.followers_count           -> relationship_counts.followers
 *   legacy.description               -> profile_bio.description
 *   legacy.verified                  -> is_blue_verified (蓝标) / verification.verified (旧金标)
 * 两种形状都兼容: 新结构优先, legacy 兜底, 以防 X 回滚或不同端点形状不一。
 */
export function mapUserResult(result, fallbackHandle = '') {
  if (!result) return null;
  const legacy = result.legacy || {};
  const core = result.core || {};
  const id = String(result.rest_id || result.id_str || legacy.id_str || '');
  if (!id) return null;

  const avatar = result.avatar?.image_url || legacy.profile_image_url_https || '';
  const banner = result.banner?.image_url || legacy.profile_banner_url || '';

  // 原始 332 条数据的 description 是 bio + 网址 + 位置 三段拼接, 这里按同样格式还原
  const bio = result.profile_bio?.description ?? legacy.description ?? '';
  const site = result.profile_bio?.entities?.url?.urls?.[0]?.expanded_url
    || legacy.entities?.url?.urls?.[0]?.expanded_url || '';
  const loc = result.location?.location ?? legacy.location ?? '';
  const description = [bio, site && `网址: ${site}`, loc && `位置: ${loc}`]
    .filter(Boolean).join('\n');

  return {
    id,
    screen_name: core.screen_name || legacy.screen_name || fallbackHandle,
    name: core.name || legacy.name || '',
    description,
    followers_count: Number(
      result.relationship_counts?.followers ?? legacy.followers_count ?? 0
    ),
    verified: (result.is_blue_verified || result.verification?.verified || legacy.verified) ? 1 : 0,
    verified_type: result.verified_type || null,
    // _normal 是 48px 缩略图, 归档必须换成 _400x400
    avatar_origin: avatar ? avatar.replace(/_normal(\.\w+)$/, '_400x400$1') : null,
    cover_origin: banner ? `${banner}/600x200` : null,
  };
}

/** X 用户对象 -> 我们的列。映射表见 05-sync-pipeline.md §5 */

/**
 * 按 handle 查单个用户 —— 用于"去博主主页重新取头像"。
 *
 * 为什么必须带凭据: 实测(2026-09) x.com 个人主页已是登录墙后的 SPA, HTML 里既没有
 * og:image 也没有 profile_images 链接; 老的 syndication followbutton 接口返回 0 字节。
 * 所以无凭据的 handle -> 头像解析已经没有官方路径。
 *
 * 返回 null 表示账号不可用(被封/注销), 调用方据此落墓碑状态。
 */
export async function lookupUserByHandle(creds, env, handle) {
  const queryId = await discoverQueryId(env, { operation: 'UserByScreenName', creds });
  const variables = encodeURIComponent(JSON.stringify({
    screen_name: handle,
    withSafetyModeUserFields: true,
  }));
  const features = encodeURIComponent(JSON.stringify({
    hidden_profile_likes_enabled: true,
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  }));

  const url = `https://x.com/i/api/graphql/${queryId}/UserByScreenName?variables=${variables}&features=${features}`;
  let res = await fetch(url, { headers: headers(creds, env) });

  // 429 指数退避。之前这里没有退避, 批量补图时每个 429 直接抛错、脚本立刻打下一个,
  // 等于顶着限流猛冲 —— 实测一轮 138 成功伴随大量 429 失败就是这么来的。
  let attempt = 0;
  while (res.status === 429 && attempt < 3) {
    await sleep(15000 * 2 ** attempt);
    res = await fetch(url, { headers: headers(creds, env) });
    attempt++;
  }

  if (res.status === 401) throw new Error('Cookie 已失效或无权访问');
  if (res.status === 429) {
    throw Object.assign(new Error('X 速率限制 (429), 请稍后再试'), { status: 429, rateLimited: true });
  }
  if (!res.ok) throw new Error(`X 返回 ${res.status}`);

  await respectRateLimit(res);

  const body = await res.json();

  // 账号消失时 X 走两条路: errors[] 或 __typename 标记
  const errCode = body?.errors?.[0]?.code;
  if (errCode === 63) return { unavailable: 1 };
  if (errCode === 50) return { unavailable: 2 };

  const result = body?.data?.user?.result;
  if (!result) return { unavailable: 2 };
  if (result.__typename === 'UserUnavailable') {
    return { unavailable: result.reason === 'Suspended' ? 1 : 2 };
  }

  return mapUserResult(result, handle);
}

export function normalizeUser(result) {
  return mapUserResult(result);
}

/**
 * 遍历「我关注的人」。按关注时间倒序, 最新关注的在最前 ——
 * 智能增量正是靠这个顺序才能提前停止。
 *
 * opts.shouldStop(user, index) 返回 true 时立即结束遍历。
 */
/**
 * 按**页**产出关注列表：`{ users: [...], cursor, page, exhausted }`。
 *
 * 为什么要有按页的版本（而不是只有逐个产出的 iterateFollowing）：
 *
 * 断点续跑只能在**页边界**上做。游标 `cursor-bottom` 的含义是"下一页从这里取"，
 * 所以只有把一整页处理完，保存这个游标才是安全的。如果在页中间停下来并保存了
 * 这个游标，恢复时会跳过本页剩下的人；保存上一页的游标又会把本页已处理的人重跑。
 *
 * 逐个产出的版本做不到这件事：消费方 break 之后，生成器里 yield 之后的代码
 * 根本不会执行，消费方拿不到"到这里为止都处理完了"的那个游标。
 *
 * 产出对象：
 *   users       本页的用户数组
 *   pageCursor  **取到本页所用的**游标（第一页是 null）—— 页内断点要存这个
 *   cursor      下一页的游标（null = 本页是最后一页）
 *   exhausted   本页是最后一页
 *
 * ⚠️ **X 完全无视 `count`/pageSize**：实测传 5 / 20 / 100 都固定返回 50 人一页。
 * 所以调用方不能靠 pageSize 控制单次处理量，必须自己在页内计数并用
 * (pageCursor, offset) 记断点。pageSize 仍然传，万一 X 哪天开始认。
 */
export async function* iterateFollowingPages(creds, env, opts = {}) {
  const { userId, log = () => {}, pageSize = 20, cursor: startCursor = null } = opts;
  if (!userId) throw new Error('缺少 userId');

  let queryId = await discoverQueryId(env, { creds });
  let cursor = startCursor;
  let page = 0;
  let retriedQueryId = false;

  while (true) {
    const variables = {
      userId: String(userId),
      count: pageSize,
      includePromotedContent: false,
      ...(cursor ? { cursor } : {}),
    };
    const url = `https://x.com/i/api/graphql/${queryId}/Following`
      + `?variables=${encodeURIComponent(JSON.stringify(variables))}`
      + `&features=${encodeURIComponent(JSON.stringify(env?.X_FEATURES ? JSON.parse(env.X_FEATURES) : FEATURES))}`;

    let res = await fetch(url, { headers: headers(creds, env) });

    // queryId 被轮换 -> 重新发现一次
    if ((res.status === 404 || res.status === 400) && !retriedQueryId) {
      retriedQueryId = true;
      log('[WARN] queryId 可能已轮换, 正在重新发现...');
      queryId = await discoverQueryId(env, { force: true, creds });
      continue;
    }

    // 429: 指数退避, 最多 3 次
    let attempt = 0;
    while (res.status === 429 && attempt < 3) {
      const waitMs = 8000 * 2 ** attempt;
      log(`[POLICY] 命中 429, ${waitMs / 1000}s 后重试 (${attempt + 1}/3)`);
      await sleep(waitMs);
      res = await fetch(url, { headers: headers(creds, env) });
      attempt++;
    }

    if (!res.ok) {
      throw Object.assign(new Error(`X 返回 ${res.status}`), { status: res.status, cursor });
    }

    const body = await res.json();
    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message).join('; ');
      // ⚠️ 游标失效时 X 不给 200+空列表，而是回 GraphQL 错误
      // （实测伪造游标 -> "Dependency: Unspecified"）。
      // 如果不在这里识别出来，断点就永远清不掉 —— 调用方每次带着坏游标重试、
      // 每次都抛错，用户被永久卡住，除了手动 restart 没有出路。
      if (cursor) {
        log(`[WARN] 带游标请求失败（${msg}）—— 判定游标已失效`);
        yield { users: [], pageCursor: cursor, cursor: null, page: page + 1, exhausted: true, staleCursor: true };
        return;
      }
      throw new Error(`GraphQL 错误: ${msg}`);
    }

    const instructions =
      body?.data?.user?.result?.timeline?.timeline?.instructions ||
      body?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];

    const entries = instructions.flatMap((i) => i.entries || []);
    const pageUsers = [];
    let nextCursor = null;

    for (const e of entries) {
      const id = e.entryId || '';
      if (id.startsWith('user-')) {
        const u = normalizeUser(e.content?.itemContent?.user_results?.result);
        if (u?.screen_name) pageUsers.push(u);
      } else if (id.startsWith('cursor-bottom')) {
        nextCursor = e.content?.value || null;
      }
    }

    page++;
    log(`[PAGE ${page}] 本页 ${pageUsers.length} 人`);

    // 终止判定: 本页没有 user 条目, 或游标没前进。
    // ⚠️ HTTP 200 但 users===0 且是第一页 -> 大概率是 X 改了响应结构, 必须报错而不是当成"没有新增"。
    //    例外: 带着 startCursor 恢复时第一页可能确实是空的(游标已到末尾或已失效),
    //    那种情况不能报错, 要当成"走完了"并让调用方清空游标。
    if (pageUsers.length === 0) {
      if (page === 1 && !startCursor) {
        throw new Error('响应中没有任何用户条目 —— X 可能已变更响应结构, 请检查解析逻辑');
      }
      yield { users: [], pageCursor: cursor, cursor: null, page, exhausted: true, staleCursor: page === 1 && !!startCursor };
      return;
    }

    const isLast = !nextCursor || nextCursor === cursor;
    // pageCursor = 取到本页所用的游标。调用方在页中间停下时存它 + 页内偏移，
    // 恢复时重新取同一页、跳过已处理的部分。
    yield {
      users: pageUsers,
      pageCursor: cursor,
      cursor: isLast ? null : nextCursor,
      page,
      exhausted: isLast,
    };
    if (isLast) return;
    cursor = nextCursor;

    // 页间节奏: 1.5-3s 抖动, 不贴着速率上限跑
    await respectRateLimit(res, log);
    await sleep(1500 + Math.floor(Math.random() * 1500));
  }
}

/**
 * 逐个产出用户的旧接口，保留给 scripts/full-sync.mjs（离线全量刷新，
 * 一次跑到底、不需要断点续跑，用页边界反而啰嗦）。
 * 新代码请用 iterateFollowingPages —— 只有它能安全地做断点续跑。
 */
export async function* iterateFollowing(creds, env, opts = {}) {
  for await (const pg of iterateFollowingPages(creds, env, opts)) {
    for (const u of pg.users) yield u;
  }
}



