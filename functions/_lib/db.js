/**
 * D1 访问层 + 兼容映射。
 *
 * 关键职责: 把内部列结构映射回前端期待的 16 字段公开形状。
 * 前端 (app.js / admin.js) 沿用原站代码, 因此必须保持字段名与类型完全一致:
 *   - avatar_url / cover_url 是**单个字符串**, 内部却拆成了 key + origin 两列
 *   - total_clicks 是派生值, 内部不存列
 *   - verified / is_suspended / is_blocked 是 0/1(/2) 整数, 不是布尔
 */

/** 内部行 -> 公开 API 形状 */
export function toPublicShape(row) {
  return {
    id: row.id,
    screen_name: row.screen_name,
    name: row.name,
    avatar_url: mediaUrl(row.avatar_key, row.avatar_origin),
    cover_url: mediaUrl(row.cover_key, row.cover_origin),
    followers_count: row.followers_count,
    description: row.description,
    verified: row.verified,
    backed_up_at: row.backed_up_at,
    is_blocked: row.is_blocked,
    is_suspended: row.is_suspended,
    clicks_card: row.clicks_card,
    clicks_timeline: row.clicks_timeline,
    clicks_roulette: row.clicks_roulette,
    total_clicks: row.clicks_card + row.clicks_timeline + row.clicks_roulette,
    last_synced_at: row.last_synced_at,
  };
}

/** R2 key 优先(已归档的副本), 回落到源 URL(尚未归档), 都没有则空串 */
export function mediaUrl(key, origin) {
  if (key) return `/api/media?key=${encodeURIComponent(key)}`;
  if (origin) return origin;
  return '';
}

const COLS = `id, screen_name, name, description, followers_count, verified,
  is_suspended, is_blocked, avatar_key, avatar_origin, cover_key, cover_origin,
  backed_up_at, last_synced_at, clicks_card, clicks_timeline, clicks_roulette`;

/**
 * 公开画廊的全量读，供 GET /api/archive 与快照生成。
 *
 * 两条相互独立的过滤，缺任何一条都是数据泄露或功能失效：
 *
 * 1. **is_blocked = 0**（站长下架，全局）
 *    管理台的「屏蔽」写的就是这一列。曾经漏掉这个条件 —— 写入路径正常改了 88 行，
 *    读取路径完全不看，于是屏蔽在主页毫无效果。前端也没有兜底过滤，所以是彻底失效。
 *
 * 2. **至少有一个 public 归属**（per-owner，谁把它收录成公开的）
 *    只被人以 private 收录的必须排除，漏了等于把用户的私密档案公开。
 *
 * 两者语义不同，别合并理解：
 *    is_blocked        = 全站画廊下架，对所有人生效，只有站长能设
 *    visibility=private = 我不想公开它，只影响我这一条归属；
 *                        别人把同一位博主收录成 public，它照样出现在画廊
 *
 * 历史数据在 migration 0003 里已挂到 admin-legacy 名下并标记 public。
 */
export async function listAll(db) {
  const { results } = await db.prepare(
    `SELECT ${COLS} FROM bloggers b
      WHERE b.is_blocked = 0
        AND EXISTS (
          SELECT 1 FROM blogger_owners o
           WHERE o.blogger_id = b.id AND o.visibility = 'public'
        )
      ORDER BY followers_count DESC`
  ).all();
  return (results || []).map(toPublicShape);
}

const B_COLS = COLS.split(',').map((c) => 'b.' + c.trim()).join(', ');

/**
 * 每行带上「我给这位博主打的标签 id」。
 *
 * 用 GROUP_CONCAT 在同一条查询里取回，而不是前端再发一次请求或服务端 N+1：
 * 「我的收录」页要在一次请求里拿到全部数据，前端才能做**即时**的标签筛选
 * （不发请求、不闪烁）。分开取的话每次切标签都要等一次往返。
 *
 * 逗号分隔是安全的：tag id 是 UUID，不含逗号。
 */
const TAG_IDS = `(SELECT GROUP_CONCAT(bt.tag_id)
                    FROM blogger_tags bt
                   WHERE bt.blogger_id = b.id AND bt.user_id = ?1) AS tag_ids`;

const withTags = (r) => ({
  ...toPublicShape(r),
  tag_ids: r.tag_ids ? String(r.tag_ids).split(',') : [],
});

/** 某用户自己收录的（公开 + 私密都算），用于「我的收录」页 */
export async function listOwnedBy(db, userId) {
  const { results } = await db.prepare(
    `SELECT ${B_COLS}, o.visibility, o.created_at AS added_at, ${TAG_IDS}
       FROM bloggers b
       JOIN blogger_owners o ON o.blogger_id = b.id
      WHERE o.user_id = ?1
      ORDER BY o.created_at DESC`
  ).bind(userId).all();
  return (results || []).map((r) => ({ ...withTags(r), visibility: r.visibility, added_at: r.added_at }));
}

/** 某用户的收藏（仅自己可见） */
export async function listFavoritesBy(db, userId) {
  const { results } = await db.prepare(
    `SELECT ${B_COLS}, f.created_at AS favorited_at, ${TAG_IDS}
       FROM bloggers b
       JOIN favorites f ON f.blogger_id = b.id
      WHERE f.user_id = ?1
      ORDER BY f.created_at DESC`
  ).bind(userId).all();
  return (results || []).map((r) => ({ ...withTags(r), favorited_at: r.favorited_at }));
}

/** 管理台分页查询。参数取值见下面 SORTS 与 status 分支 */
const SORTS = {
  backed_up_at_desc: 'backed_up_at DESC',
  backed_up_at_asc: 'backed_up_at ASC',
  followers_desc: 'followers_count DESC',
  followers_asc: 'followers_count ASC',
  clicks_desc: '(clicks_card + clicks_timeline + clicks_roulette) DESC',
  clicks_asc: '(clicks_card + clicks_timeline + clicks_roulette) ASC',
  name_asc: 'name ASC',
};

const ADMIN_OWNER = 'admin-legacy';

/**
 * 保证一条博主有归属行。**每一个往 bloggers 插行的地方都必须调它。**
 *
 * 为什么必须：`listAll()` 要求「至少一条 public 归属」才进公开画廊。
 * 插了 bloggers 却没插 blogger_owners，那条记录就是**不可见的孤儿** ——
 * 管理台看得到、画廊看不到、也不属于任何人，用户会以为添加失败了。
 *
 * 这个 bug 已经犯过三次（sync-following.js、admin/blogger.js PUT、archive.js 导入），
 * 所以抽成一个函数而不是每处手写 SQL。
 *
 * visibility 默认读 settings.sync_default_visibility（站长在同步面板上的那个开关），
 * 让"新进来的博主先不公开"这件事只有一个总闸，不会各处行为不一致。
 *
 * ON CONFLICT DO NOTHING：已有归属就不动，绝不覆盖站长手工设过的可见性。
 */
export async function ensureOwnership(db, bloggerId, { userId = ADMIN_OWNER, visibility } = {}) {
  let v = visibility;
  if (v !== 'public' && v !== 'private') {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'sync_default_visibility'").first();
    v = row?.value === 'public' ? 'public' : 'private';
  }
  await db.prepare(
    `INSERT INTO blogger_owners (user_id, blogger_id, visibility, created_at)
     VALUES (?,?,?,?) ON CONFLICT DO NOTHING`
  ).bind(userId, bloggerId, v, new Date().toISOString()).run();
  return v;
}

/** 无归属的博主数。>0 就是上面那个 bug 又发生了，管理台会显示告警。 */
export async function countOrphans(db) {
  const row = await db.prepare(
    `SELECT COUNT(*) n FROM bloggers b
      WHERE NOT EXISTS (SELECT 1 FROM blogger_owners o WHERE o.blogger_id = b.id)`
  ).first();
  return row?.n || 0;
}


/**
 * 每行都带上 my_visibility（站长自己那条归属的可见性）与 in_gallery
 * （这一刻是否真的出现在公开画廊）。
 *
 * in_gallery 是算出来的、不是某一列 —— 一条博主进公开画廊要同时满足
 * is_blocked=0 且至少一个 public 归属。管理台以前只显示 is_blocked，
 * 于是「明明没屏蔽却不在画廊里」（私密归属）看不出来，得靠猜。
 */
export async function listPaged(db, { keyword = '', status = 'all', sort = 'backed_up_at_desc', page = 1, limit = 30 }) {
  const where = [];
  const bind = [];

  if (keyword) {
    where.push('(b.screen_name LIKE ?1 OR b.name LIKE ?1 OR b.description LIKE ?1)');
    bind.push(`%${keyword}%`);
  }

  const MINE = `(SELECT o.visibility FROM blogger_owners o
                  WHERE o.blogger_id = b.id AND o.user_id = '${ADMIN_OWNER}')`;
  const ANY_PUBLIC = `EXISTS (SELECT 1 FROM blogger_owners o2
                               WHERE o2.blogger_id = b.id AND o2.visibility = 'public')`;

  // status 有三个互不相同的维度, 别混：
  //   active/blocked  -> is_blocked, 站长全局下架
  //   private/public  -> 站长自己那条归属的可见性
  //   in_gallery/off  -> 综合结果, 即公开画廊此刻到底看不看得到
  if (status === 'active') where.push('b.is_blocked = 0');
  else if (status === 'blocked') where.push('b.is_blocked = 1');
  else if (status === 'private') where.push(`${MINE} = 'private'`);
  else if (status === 'public') where.push(`${MINE} = 'public'`);
  else if (status === 'in_gallery') where.push(`b.is_blocked = 0 AND ${ANY_PUBLIC}`);
  else if (status === 'off_gallery') where.push(`NOT (b.is_blocked = 0 AND ${ANY_PUBLIC})`);

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[sort] || SORTS.backed_up_at_desc;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 1000);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pg - 1) * lim;

  const cols = COLS.split(',').map((c) => 'b.' + c.trim()).join(', ');
  const rows = await db.prepare(
    `SELECT ${cols},
            COALESCE(${MINE}, '') AS my_visibility,
            CASE WHEN b.is_blocked = 0 AND ${ANY_PUBLIC} THEN 1 ELSE 0 END AS in_gallery,
            (SELECT COUNT(*) FROM blogger_owners o3 WHERE o3.blogger_id = b.id) AS owner_count
       FROM bloggers b ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...bind, lim, offset).all();

  const counted = await db.prepare(
    `SELECT COUNT(*) AS n FROM bloggers b ${clause}`
  ).bind(...bind).first();

  // stats 是全库统计, 不受筛选与分页影响 —— 前端拿去驱动 Tab 角标
  const stats = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN b.is_blocked = 0 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN b.is_blocked = 1 THEN 1 ELSE 0 END) AS blocked,
            SUM(CASE WHEN ${MINE} = 'private' THEN 1 ELSE 0 END) AS mine_private,
            SUM(CASE WHEN ${MINE} = 'public'  THEN 1 ELSE 0 END) AS mine_public,
            SUM(CASE WHEN b.is_blocked = 0 AND ${ANY_PUBLIC} THEN 1 ELSE 0 END) AS in_gallery,
            SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM blogger_owners o4 WHERE o4.blogger_id = b.id)
                     THEN 1 ELSE 0 END) AS orphans
     FROM bloggers b`
  ).first();

  const total = counted?.n || 0;
  return {
    data: (rows.results || []).map((r) => ({
      ...toPublicShape(r),
      my_visibility: r.my_visibility || '',
      in_gallery: r.in_gallery,
      owner_count: r.owner_count,
    })),
    stats: {
      total: stats?.total || 0,
      active: stats?.active || 0,
      blocked: stats?.blocked || 0,
      mine_private: stats?.mine_private || 0,
      mine_public: stats?.mine_public || 0,
      in_gallery: stats?.in_gallery || 0,
      // >0 = 某个插入路径漏建归属行，那些记录是不可见的孤儿。管理台会显示告警条。
      orphans: stats?.orphans || 0,
    },
    total,
    page: pg,
    limit: lim,
    totalPages: Math.max(Math.ceil(total / lim), 1),
  };
}


/* ============================================================
 * 引用计数：共享一份数据 + 「指针」式归属
 * ============================================================
 *
 * 同一位博主（同一个 X id）在库里永远**只有一份** bloggers 行 + 一份 R2 媒体。
 * 谁"拥有"它由 blogger_owners 一行一行地表示 —— 那就是指针：
 *
 *     bloggers (@alice)  ←── blogger_owners(admin-legacy, public)   公开仓的指针
 *                        ←── blogger_owners(用户A, private)          A 的私人指针
 *                        ←── blogger_owners(用户B, public)           B 的指针
 *                        ←── favorites(用户C)                        C 只是收藏
 *
 * 由此三条规则自然成立，不需要额外判断"这是谁上传的"：
 *
 *   1. 取消收录 = 只删自己那一行指针。别人的指针（含公开仓 admin-legacy 那行）
 *      纹丝不动，所以**个人退出绝不可能把公开仓的副本删掉**。
 *   2. 可见性 = 只要还剩任意一行 public 指针，它就在公开画廊里；
 *      全部指针都是 private 时，它只对持有指针的人可见。
 *   3. 真实数据什么时候删 = 引用计数归零时（没有任何归属、也没有任何收藏）。
 *      "admin 上传的只能由 admin 删" 是这条规则的推论：admin-legacy 那行指针
 *      本身就是一个引用，别人删自己的指针时计数不会归零，数据就删不掉。
 *
 * 收藏也算引用：有人把它收藏了却没人收录时，删掉行会让那个人的收藏页凭空少一条。
 * 那种行会以"孤儿"形式出现在管理台（无归属），站长可一键接管或彻底删除。
 */

export { ADMIN_OWNER };

/** 一条归档行当前的引用情况。GC 判据与提示文案都基于它。 */
export async function countRefs(db, bloggerId) {
  const r = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM blogger_owners WHERE blogger_id = ?1)                          AS owners,
       (SELECT COUNT(*) FROM blogger_owners WHERE blogger_id = ?1 AND visibility = 'public') AS public_owners,
       (SELECT COUNT(*) FROM blogger_owners WHERE blogger_id = ?1 AND user_id = ?2)          AS admin_owns,
       (SELECT COUNT(*) FROM favorites      WHERE blogger_id = ?1)                          AS favorites`
  ).bind(bloggerId, ADMIN_OWNER).first();
  const owners = r?.owners || 0;
  const favorites = r?.favorites || 0;
  return {
    owners,
    publicOwners: r?.public_owners || 0,
    adminOwns: (r?.admin_owns || 0) > 0,
    favorites,
    // 引用总数归零 = 没有任何人在用这份数据，可以回收
    unused: owners === 0 && favorites === 0,
  };
}

/**
 * 物理删除一条归档行及其全部附属数据。**调用方负责先确认没人还在用。**
 *
 * D1 默认不强制外键，声明了 ON DELETE CASCADE 也不会真的级联，
 * 所以关联表必须逐张显式处理。漏掉哪张就留孤儿行 —— blogger_owners 尤其要紧：
 * 留着的话同一位博主日后被重新收录（X 的 userId 稳定不变）会直接继承旧归属，
 * 包括别人设过的可见性。
 *
 * submissions 是例外：那是投稿/限流事件日志（按 ip_hash 与 handle 计数），
 * 删行会绕过冷却。只把 blogger_id 置空，断开悬空指针。
 */
export async function purgeBlogger(db, bloggerId, { media = null, avatarKey = null, coverKey = null } = {}) {
  // 先删 R2 对象。失败不阻断 —— 留下孤儿对象比留下孤儿数据库行好处理。
  let mediaDeleted = 0;
  if (media) {
    for (const key of [avatarKey, coverKey].filter(Boolean)) {
      try { await media.delete(key); mediaDeleted++; } catch { /* 忽略 */ }
    }
  }
  await db.batch([
    db.prepare('DELETE FROM blogger_history    WHERE blogger_id = ?').bind(bloggerId),
    db.prepare('DELETE FROM follower_snapshots WHERE blogger_id = ?').bind(bloggerId),
    db.prepare('DELETE FROM blogger_owners     WHERE blogger_id = ?').bind(bloggerId),
    db.prepare('DELETE FROM favorites          WHERE blogger_id = ?').bind(bloggerId),
    db.prepare('DELETE FROM blogger_tags       WHERE blogger_id = ?').bind(bloggerId),
    db.prepare('UPDATE submissions SET blogger_id = NULL WHERE blogger_id = ?').bind(bloggerId),
    db.prepare('DELETE FROM bloggers           WHERE id = ?').bind(bloggerId),
  ]);
  return { mediaDeleted };
}

/**
 * 解除一个人对一条归档行的归属（"取消收录"），必要时回收数据。
 *
 * userId 传 ADMIN_OWNER 就是"把它撤出公开仓"，逻辑完全一样 —— 站长和普通用户
 * 走同一条代码路径，不存在"管理员的删除更彻底"这种特例。想彻底删（连别人的
 * 收录一起删）是另一个动作，见 DELETE /api/admin/blogger 的 purge 模式。
 *
 * 返回 { released, gcd, refs, reason } —— reason 说明数据为什么被留下，
 * 调用方据此生成人话提示。用户最需要知道的就是"我删的是我自己那份还是全部"。
 */
export async function releaseOwnership(db, blogger, userId, { media = null } = {}) {
  const del = await db.prepare(
    'DELETE FROM blogger_owners WHERE user_id = ? AND blogger_id = ?'
  ).bind(userId, blogger.id).run();
  if (!del.meta?.changes) return { released: false, gcd: false, refs: null, reason: 'not_owned' };

  // 我给它打的标签在我不再收录、也没收藏它之后就没有任何界面会显示了 —— 顺手清掉。
  // 但**还收藏着就得留**：/favorites 页同样按标签筛选，删了会让收藏页的标签凭空消失。
  const stillFav = await db.prepare(
    'SELECT 1 FROM favorites WHERE user_id = ? AND blogger_id = ?'
  ).bind(userId, blogger.id).first();
  if (!stillFav) {
    await db.prepare('DELETE FROM blogger_tags WHERE user_id = ? AND blogger_id = ?')
      .bind(userId, blogger.id).run();
  }

  const refs = await countRefs(db, blogger.id);
  if (refs.unused) {
    await purgeBlogger(db, blogger.id, {
      media, avatarKey: blogger.avatar_key, coverKey: blogger.cover_key,
    });
    return { released: true, gcd: true, refs, reason: 'gc' };
  }
  return {
    released: true, gcd: false, refs,
    reason: refs.adminOwns ? 'kept_admin'
      : refs.owners > 0 ? 'kept_owners'
      : 'kept_favorites',
  };
}
