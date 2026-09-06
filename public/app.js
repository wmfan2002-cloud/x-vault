/**
 * X-符离集 (x-vault) — 画廊前端
 *
 * 画廊 / 我的收录 / 我的收藏 三个视图共用同一条渲染管线：
 *   rawUsers -> applyFilterAndSort -> 瀑布流渲染
 * 所以换视图只是换 rawUsers 的来源，搜索、排序、视图切换、无限滚动、
 * 详情抽屉全都白拿。
 */

document.addEventListener('DOMContentLoaded', () => {

  // ==================== Sample Data for Instant Preview ====================
  const defaultSampleData = [
    {
      "id": "1280938963541221376",
      "screen_name": "afukadou7",
      "name": "阿芙卡豆",
      "avatar_url": "https://pbs.twimg.com/profile_images/2033912326085349377/WEkPM9t7_400x400.jpg",
      "cover_url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80",
      "followers_count": 102939,
      "description": "阿芙卡豆 | 官方指路 💓 TG & Fansone 专属记录页，分享日常与数码生活。https://fansone.co/afuka",
      "verified": true,
      "category": "Design & Lifestyle",
      "backed_up_at": "2026-08-11T15:21:30.336Z"
    },
    {
      "id": "15354924",
      "screen_name": "sama",
      "name": "Sam Altman",
      "avatar_url": "https://pbs.twimg.com/profile_images/1605336338520281088/8p7c1m-b_400x400.jpg",
      "cover_url": "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=800&auto=format&fit=crop&q=80",
      "followers_count": 3240000,
      "description": "CEO at OpenAI. Working on AGI to benefit all of humanity. https://openai.com",
      "verified": true,
      "category": "AI & Tech",
      "backed_up_at": "2026-08-11T16:00:00.000Z"
    },
    {
      "id": "33838201",
      "screen_name": "karpathy",
      "name": "Andrej Karpathy",
      "avatar_url": "https://pbs.twimg.com/profile_images/1799516629949603840/z0HquzC__400x400.jpg",
      "cover_url": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80",
      "followers_count": 1120000,
      "description": "Building Eureka Labs. Formerly OpenAI and Tesla AI lead. Passionate about LLMs, deep learning and education. https://eurekalabs.ai",
      "verified": true,
      "category": "AI Research",
      "backed_up_at": "2026-08-11T16:05:00.000Z"
    },
    {
      "id": "1157097323",
      "screen_name": "levelsio",
      "name": "Pieter Levels",
      "avatar_url": "https://pbs.twimg.com/profile_images/1783777553942007808/3Z__tM50_400x400.jpg",
      "cover_url": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80",
      "followers_count": 542000,
      "description": "Indie hacker. Building Nomad List, Remote OK, PhotoAI, and Interior AI. Shipping fast as a solo founder. https://levels.io",
      "verified": true,
      "category": "Indie Hacker",
      "backed_up_at": "2026-08-11T16:10:00.000Z"
    },
    {
      "id": "14499829",
      "screen_name": "ylecun",
      "name": "Yann LeCun",
      "avatar_url": "https://pbs.twimg.com/profile_images/1498642738902507523/wU2a74cE_400x400.jpg",
      "cover_url": "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop&q=80",
      "followers_count": 890000,
      "description": "Chief AI Scientist at Meta. Professor at NYU. Turing Award Laureate for Deep Learning. https://yann.lecun.com",
      "verified": true,
      "category": "AI Research",
      "backed_up_at": "2026-08-11T16:15:00.000Z"
    },
    {
      "id": "96135824",
      "screen_name": "gregkamradt",
      "name": "Greg Kamradt",
      "avatar_url": "https://pbs.twimg.com/profile_images/1614761011884392451/7fHlO12T_400x400.jpg",
      "cover_url": "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=800&auto=format&fit=crop&q=80",
      "followers_count": 185000,
      "description": "Building AI data tools & benchmarks. Needle in a Haystack evaluation creator. Exploring LLM capabilities.",
      "verified": false,
      "category": "AI & Data",
      "backed_up_at": "2026-08-11T16:20:00.000Z"
    }
  ];

  // SVG Icon Templates (Iconify / Lucide & Phosphor Standard)
  const ICONS = {
    verifiedNative: `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3.2" aria-hidden="true"><use href="/icons.svg#check-badge"/></svg>`,
    users: `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#users"/></svg>`,
    external: `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#external-link"/></svg>`,
    eye: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#eye"/></svg>`,
    ghost: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#ghost"/></svg>`,
    history: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#history"/></svg>`,
    stamp: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#stamp"/></svg>`,
    candle: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#candle"/></svg>`,
    markdown: `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#markdown"/></svg>`,
    copy: `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#copy"/></svg>`,
    chevronDown: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#chevron-down-thick"/></svg>`
  };

  // Canvas Color Extraction Engine for Dynamic Ambient Glow
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 16;
  sampleCanvas.height = 16;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  // 12 Evenly Distributed Spectral Neon Accents for Creators
  const VIBRANT_ACCENTS = [
    '244, 63, 94',    // Rose Red (350°)
    '236, 72, 153',   // Neon Pink (330°)
    '217, 70, 239',   // Vivid Fuchsia (290°)
    '168, 85, 247',   // Electric Purple (270°)
    '129, 140, 248',  // Periwinkle Indigo (235°)
    '14, 165, 233',   // Sky Cyan (195°)
    '20, 184, 166',   // Mint Teal (175°)
    '16, 185, 129',   // Emerald Green (150°)
    '132, 204, 22',   // Lime Green (85°)
    '245, 158, 11',   // Amber Gold (40°)
    '249, 115, 22',   // Orange Flame (25°)
    '239, 68, 68'     // Ruby Crimson (0°)
  ];

  function rgbToHsl(r, g, b) {
    const [red, green, blue] = [r, g, b].map(channel => channel / 255);
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const lightness = (maximum + minimum) / 2;
    if (maximum === minimum) return [0, 0, lightness];

    const delta = maximum - minimum;
    const saturation = lightness > 0.5
      ? delta / (2 - maximum - minimum)
      : delta / (maximum + minimum);
    let hue;
    if (maximum === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;

    return [hue * 60, saturation, lightness];
  }

  function hslToRgb(h, s, l) {
    const channelAtHue = (low, high, offset) => {
      const t = offset < 0 ? offset + 1 : offset > 1 ? offset - 1 : offset;
      if (t < 1 / 6) return low + (high - low) * 6 * t;
      if (t < 1 / 2) return high;
      if (t < 2 / 3) return low + (high - low) * (2 / 3 - t) * 6;
      return low;
    };
    const high = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const low = 2 * l - high;
    const hue = h / 360;
    const red = channelAtHue(low, high, hue + 1 / 3);
    const green = channelAtHue(low, high, hue);
    const blue = channelAtHue(low, high, hue - 1 / 3);
    return `${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}`;
  }

  function getFallbackAccent(key) {
    let hash = 0;
    const str = String(key || 'creator');
    for (let index = 0; index < str.length; index++) {
      hash = (hash << 5) - hash + str.charCodeAt(index);
      hash |= 0;
    }
    return VIBRANT_ACCENTS[Math.abs(hash) % VIBRANT_ACCENTS.length];
  }

  // Chrominance-Peak HSL Dominant Color Extractor
  function extractDominantColor(img, defaultKey = 'creator') {
    try {
      sampleCtx.clearRect(0, 0, 16, 16);
      sampleCtx.drawImage(img, 0, 0, 16, 16);
      const imgData = sampleCtx.getImageData(0, 0, 16, 16).data;
      const buckets = new Array(12).fill(0);
      const hueSums = new Array(12).fill(0);
      let totalVibrantWeight = 0;

      for (let i = 0; i < imgData.length; i += 4) {
        const pr = imgData[i];
        const pg = imgData[i + 1];
        const pb = imgData[i + 2];
        const pa = imgData[i + 3];
        if (pa < 100) continue;

        const [h, s, l] = rgbToHsl(pr, pg, pb);
        // Ignore gray, pure white, pure black
        if (s < 0.18 || l < 0.12 || l > 0.90) continue;

        // Exponential weight for high-chroma pixels (e.g. neon, hair, apparel, background highlights)
        const weight = Math.pow(s, 2.2) * (1 - Math.abs(l - 0.5) * 1.4);
        const bIdx = Math.floor(h / 30) % 12;
        buckets[bIdx] += weight;
        hueSums[bIdx] += h * weight;
        totalVibrantWeight += weight;
      }

      if (totalVibrantWeight < 0.1) {
        return getFallbackAccent(defaultKey);
      }

      let bestBucket = -1, maxWeight = 0;
      for (let i = 0; i < 12; i++) {
        if (buckets[i] > maxWeight) {
          maxWeight = buckets[i];
          bestBucket = i;
        }
      }

      if (bestBucket === -1 || buckets[bestBucket] === 0) {
        return getFallbackAccent(defaultKey);
      }

      const winningHue = Math.round(hueSums[bestBucket] / buckets[bestBucket]);
      // Optimize vibrancy for OLED: high saturation (82%) and optimal lightness (58%)
      return hslToRgb(winningHue, 0.82, 0.58);
    } catch (e) {
      return getFallbackAccent(defaultKey);
    }
  }

  // ==================== 1. Canvas Starfield Particles Background ====================
  function initCanvasParticles() {
    const canvas = document.getElementById('bg-particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const numParticles = Math.min(Math.floor((width * height) / 24000), 45);
    const particles = [];

    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.4 + 0.6,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        alpha: Math.random() * 0.5 + 0.2
      });
    }

    function render() {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56, 189, 248, ${p.alpha})`;
        ctx.fill();

        for (let j = idx + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 105) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - dist / 105) * 0.12})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });

      requestAnimationFrame(render);
    }

    render();
  }

  initCanvasParticles();

  // ==================== 1.5 Blogger Click Tracking Engine (Anti-Spam + Offline Queue + Smart Batch Flush) ====================
  const CLICK_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes anti-spam per blogger per browser
  const OFFLINE_QUEUE_KEY = 'x_offline_click_queue';
  const TIMESTAMPS_KEY = 'x_blogger_click_timestamps';
  let clickFlushTimer = null;
  let isFlushingClicks = false;

  function getOfflineClickQueue() {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveOfflineClickQueue(queue) {
    try {
      if (Object.keys(queue).length === 0) {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
      } else {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (e) {}
  }

  function getBloggerClickTimestamps() {
    try {
      const raw = localStorage.getItem(TIMESTAMPS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveBloggerClickTimestamps(map) {
    try {
      localStorage.setItem(TIMESTAMPS_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function trackBloggerClick(screenName, source = 'card') {
    if (!screenName) return;
    const handleKey = screenName.toLowerCase();
    const now = Date.now();

    // 1. 同博主 10 分钟防刷检查 (Anti-Spam 10-Minute Cooldown)
    const timestamps = getBloggerClickTimestamps();
    const lastClick = timestamps[handleKey] || 0;
    if (now - lastClick < CLICK_COOLDOWN_MS) {
      // 冷却期内：照常允许用户跳转推特，但跳过热度上报，彻底杜绝刷榜
      return;
    }
    timestamps[handleKey] = now;
    saveBloggerClickTimestamps(timestamps);

    // 2. 本地即时响应：直接更新内存数据
    const targetUser = state.rawUsers.find(u => (u.screen_name || '').toLowerCase() === handleKey);
    if (targetUser) {
      targetUser.clicks_card = targetUser.clicks_card || 0;
      targetUser.clicks_timeline = targetUser.clicks_timeline || 0;
      targetUser.clicks_roulette = targetUser.clicks_roulette || 0;
      targetUser.total_clicks = targetUser.total_clicks || 0;
      if (source === 'timeline') targetUser.clicks_timeline++;
      else if (source === 'roulette') targetUser.clicks_roulette++;
      else targetUser.clicks_card++;
      targetUser.total_clicks++;
    }

    // 3. 写入本地离线队列 (Offline Queue)
    const queue = getOfflineClickQueue();
    if (!queue[handleKey]) {
      queue[handleKey] = {
        screen_name: screenName,
        card: 0,
        timeline: 0,
        roulette: 0,
        total: 0
      };
    }
    if (source === 'timeline') queue[handleKey].timeline++;
    else if (source === 'roulette') queue[handleKey].roulette++;
    else queue[handleKey].card++;
    queue[handleKey].total++;
    saveOfflineClickQueue(queue);

    // 4. 触发 15 秒节流防抖合并上报
    scheduleClickFlush(15000);
  }

  function scheduleClickFlush(delayMs = 15000) {
    if (clickFlushTimer) clearTimeout(clickFlushTimer);
    clickFlushTimer = setTimeout(() => {
      flushPendingClickQueue();
    }, delayMs);
  }

  async function flushPendingClickQueue() {
    if (isFlushingClicks) return;
    const queue = getOfflineClickQueue();
    const keys = Object.keys(queue);
    if (keys.length === 0) return;

    isFlushingClicks = true;
    // 制作本次提交快照 (Snapshot for Ack verification)
    const batchList = keys.map(k => queue[k]);
    const snapshotKeys = new Set(keys);

    try {
      const res = await fetch('/api/track-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: batchList }),
        keepalive: true
      });

      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        if (json.success) {
          // 收到 200 OK 确认：安全销毁本次成功提交的快照项，防止重复提交
          const currentQueue = getOfflineClickQueue();
          snapshotKeys.forEach(k => delete currentQueue[k]);
          saveOfflineClickQueue(currentQueue);
        }
      }
    } catch (err) {
      // 遇到 1027 额度耗尽或网络离线：保留本地队列，等待下次补发
      console.warn('[Track Engine] Click batch report deferred (offline/rate-limited):', err);
    } finally {
      isFlushingClicks = false;
    }
  }

  // 监听页面生命周期：页面切到后台或关闭前，立即发送待处理队列
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingClickQueue();
    }
  });
  window.addEventListener('beforeunload', () => {
    flushPendingClickQueue();
  });

  window.trackBloggerClick = trackBloggerClick;

  // ==================== 2. State Store (Default Theme: OLED) ====================
  const PAGE_SIZE = 12;
  const state = {
    rawUsers: [],
    filteredUsers: [],
    renderedCount: 0,
    columnElements: [],
    spotlightUser: null,
    currentFilter: 'all',
    currentSort: 'followers-desc',
    currentView: 'grid', // 'grid' | 'compact' | 'list'
    currentTheme: localStorage.getItem('x_archive_v2_theme') || 'oled',
    searchQuery: '',
    isShuffling: false,
    isLoadingMore: false,
    // ── 视图（三个真实路径 / · /my · /favorites）──────────────
    // 画廊管线本身是数据源无关的：rawUsers -> applyFilterAndSort -> 渲染。
    // 所以"我的收录/收藏"不需要另建页面，只要换 rawUsers 的来源，
    // 搜索、排序、视图切换、瀑布流、无限滚动、详情抽屉全都白拿。
    viewMode: 'all',        // 'all' | 'mine' | 'fav'
    currentTag: '',         // '' = 全部；'__untagged' = 未分类；否则 tag id
    visFilter: '',          // 仅「我的收录」：'' | 'public' | 'private'
    myTags: [],             // 我的标签列表（含 count）
    tagsLoaded: false
  };

  const fallbackCovers = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=800&auto=format&fit=crop&q=80'
  ];

  // DOM Elements Cache
  const htmlRoot = document.documentElement;
  const bloggerWall = document.getElementById('blogger-wall');
  const emptyStateDb = document.getElementById('empty-state-db');
  const emptyStateSearch = document.getElementById('empty-state-search');
  const infiniteSentinel = document.getElementById('infinite-scroll-sentinel');
  const btnLoadSampleData = document.getElementById('btn-load-sample-data');
  const globalSearch = document.getElementById('global-search');
  const searchClearBtn = document.getElementById('search-clear-btn');
  
  // Hero & Stats
  const statTotalChip = document.getElementById('stat-total-chip');
  const statVerifiedChip = document.getElementById('stat-verified-chip');
  const statMaxChip = document.getElementById('stat-max-chip');
  const heroSpotlightCard = document.getElementById('hero-spotlight-card');
  const spotlightContent = document.getElementById('spotlight-dynamic-content');
  const btnShuffleSpotlight = document.getElementById('btn-shuffle-spotlight');

  // Filter Pills & Badges
  const filterPills = document.querySelectorAll('.f-pill');
  const badgeCountAll = document.getElementById('badge-count-all');
  const badgeCountHot = document.getElementById('badge-count-hot');
  const badgeCountVerified = document.getElementById('badge-count-verified');
  const badgeCountRecent = document.getElementById('badge-count-recent');
  const badgeCountLost = document.getElementById('badge-count-lost');
  const resultsCountText = document.getElementById('results-count-text');
  const btnResetFilters = document.getElementById('btn-reset-filters');

  // Sort Menu
  const sortTriggerBtn = document.getElementById('sort-trigger-btn');
  const sortMenu = document.getElementById('sort-menu');
  const sortCurrentText = document.getElementById('sort-current-text');

  // View Switchers
  const viewTabs = document.querySelectorAll('.view-tab-btn');

  // Pure Icon Dual-Theme Toggle Button
  const themeBtn = document.getElementById('theme-btn');
  const themeIconSun = document.getElementById('theme-icon-sun');
  const themeIconMoon = document.getElementById('theme-icon-moon');

  // Lucky Pick Frameless Roulette Modal Elements
  const btnLuckyPick = document.getElementById('btn-lucky-pick');
  const rouletteBackdrop = document.getElementById('random-roulette-backdrop');
  const rouletteCardContainer = document.getElementById('roulette-card-container');
  const rouletteBanner = document.getElementById('roulette-banner');
  const rouletteAvatar = document.getElementById('roulette-avatar');
  const rouletteTag = document.getElementById('roulette-tag');
  const rouletteName = document.getElementById('roulette-name');
  const rouletteVerified = document.getElementById('roulette-verified');
  const rouletteHandle = document.getElementById('roulette-handle');
  const rouletteBio = document.getElementById('roulette-bio');
  const rouletteOutsideActions = document.getElementById('roulette-outside-actions');
  const rouletteDismissHint = document.getElementById('roulette-dismiss-hint');
  const btnReshuffleAgain = document.getElementById('btn-reshuffle-again');
  const btnRouletteVisit = document.getElementById('btn-roulette-visit');

  // Standard Inspector Drawer (for regular card click)
  const inspectorBackdrop = document.getElementById('inspector-backdrop');
  const drawerCloseBtn = document.getElementById('drawer-close-btn');
  const drawerBody = document.getElementById('drawer-body-content');
  const toastContainer = document.getElementById('toast-container');

  // ==================== 3. React-Bits Motion Modules ====================

  function animateCountUp(element, endVal, duration = 1000, isPercent = false, isFollowers = false) {
    if (!element) return;
    const startVal = 0;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentVal = Math.floor(startVal + (endVal - startVal) * easeProgress);

      if (isPercent) {
        element.textContent = `${currentVal}%`;
      } else if (isFollowers) {
        element.textContent = formatFollowers(currentVal);
      } else {
        element.textContent = currentVal.toLocaleString();
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        if (isPercent) element.textContent = `${endVal}%`;
        else if (isFollowers) element.textContent = formatFollowers(endVal);
        else element.textContent = endVal.toLocaleString();
      }
    }

    requestAnimationFrame(update);
  }

  function triggerClickSpark(e, sparkCount = 12, color = 'var(--pink)') {
    const x = e ? (e.clientX || window.innerWidth / 2) : window.innerWidth / 2;
    const y = e ? (e.clientY || window.innerHeight / 2) : window.innerHeight / 2;

    for (let i = 0; i < sparkCount; i++) {
      const spark = document.createElement('div');
      spark.className = 'click-spark-particle';

      const angle = (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.5;
      const distance = 35 + Math.random() * 40;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      const size = 3 + Math.random() * 4;

      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.style.width = `${size}px`;
      spark.style.height = `${size}px`;
      spark.style.backgroundColor = color;
      spark.style.boxShadow = `0 0 12px ${color}`;
      spark.style.setProperty('--dx', `${dx}px`);
      spark.style.setProperty('--dy', `${dy}px`);

      document.body.appendChild(spark);

      setTimeout(() => spark.remove(), 650);
    }
  }

  function triggerLuxuryCelebrationFireworks(originElement) {
    let cx = window.innerWidth / 2;
    let cy = window.innerHeight / 2;

    if (originElement) {
      const rect = originElement.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
    }

    const colors = [
      '#f59e0b', // Luxury Gold
      '#fbbf24', // Amber
      '#38bdf8', // Electric Cyan
      '#ec4899', // Cyber Pink
      '#a855f7', // Purple Neon
      '#ffffff', // Diamond Sparkle
      '#10b981'  // Emerald
    ];

    const shapes = ['star', 'diamond', 'circle', 'ribbon'];
    const particleCount = 52;

    for (let i = 0; i < particleCount; i++) {
      const p = document.createElement('div');
      p.className = 'celebration-burst-particle';

      const color = colors[Math.floor(Math.random() * colors.length)];
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.45;
      const distance = 85 + Math.random() * 240;
      const vx = Math.cos(angle) * distance;
      const vy = Math.sin(angle) * distance - (35 + Math.random() * 45); // Natural pop with upward velocity

      const duration = 0.95 + Math.random() * 0.75;
      const rotMid = `${(Math.random() - 0.5) * 360}deg`;
      const rotLate = `${(Math.random() - 0.5) * 720}deg`;
      const rotEnd = `${(Math.random() - 0.5) * 1080}deg`;

      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty('--vx', `${vx}px`);
      p.style.setProperty('--vy', `${vy}px`);
      p.style.setProperty('--duration', `${duration}s`);
      p.style.setProperty('--rot-mid', rotMid);
      p.style.setProperty('--rot-late', rotLate);
      p.style.setProperty('--rot-end', rotEnd);
      p.style.color = color;

      if (shape === 'star') {
        p.classList.add('celebration-star-particle');
        const size = 12 + Math.random() * 10;
        p.innerHTML = `<svg width="${size}" height="${size}" fill="${color}" stroke="${color}" stroke-width="1" aria-hidden="true"><use href="/icons.svg#star"/></svg>`;
      } else if (shape === 'diamond') {
        p.classList.add('celebration-star-particle');
        const size = 10 + Math.random() * 8;
        p.innerHTML = `<svg width="${size}" height="${size}" fill="${color}" aria-hidden="true"><use href="/icons.svg#diamond"/></svg>`;
      } else if (shape === 'ribbon') {
        p.classList.add('celebration-confetti-ribbon');
        const w = 5 + Math.random() * 5;
        const h = 10 + Math.random() * 10;
        p.style.width = `${w}px`;
        p.style.height = `${h}px`;
        p.style.backgroundColor = color;
      } else {
        const size = 6 + Math.random() * 6;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;
        p.style.borderRadius = '50%';
        p.style.backgroundColor = color;
        p.style.boxShadow = `0 0 12px ${color}, 0 0 22px ${color}`;
      }

      document.body.appendChild(p);

      setTimeout(() => {
        p.remove();
      }, duration * 1000 + 100);
    }
  }

  function attachSpotlightEffect(cardElement) {
    if (!cardElement) return;
    cardElement.classList.add('spotlight-interactive');

    cardElement.addEventListener('mousemove', (e) => {
      const rect = cardElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cardElement.style.setProperty('--mouse-x', `${x}px`);
      cardElement.style.setProperty('--mouse-y', `${y}px`);
    });
  }

  function attach3DTilt(element, maxTilt = 7) {
    if (!element) return;
    element.classList.add('tilt-card-wrap');

    element.addEventListener('mousemove', (e) => {
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = ((y - centerY) / centerY) * -maxTilt;
      const rotateY = ((x - centerX) / centerX) * maxTilt;

      element.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px)`;
    });

    element.addEventListener('mouseleave', () => {
      element.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)';
    });
  }

  if (heroSpotlightCard) {
    attachSpotlightEffect(heroSpotlightCard);
    attach3DTilt(heroSpotlightCard, 6);
  }

  // ==================== 4. Pure Icon Dual-Theme Toggle Engine (OLED by Default) ====================
  function applyTheme(theme) {
    state.currentTheme = theme === 'light' ? 'light' : 'oled';
    htmlRoot.setAttribute('data-theme', state.currentTheme);
    localStorage.setItem('x_archive_v2_theme', state.currentTheme);

    if (state.currentTheme === 'light') {
      themeIconSun?.classList.remove('hidden');
      themeIconMoon?.classList.add('hidden');
      themeBtn?.setAttribute('title', '当前: 清爽浅色 · 点击切换为纯黑极简 (OLED) [快捷键: T]');
    } else {
      themeIconSun?.classList.add('hidden');
      themeIconMoon?.classList.remove('hidden');
      themeBtn?.setAttribute('title', '当前: 纯黑极简 · 点击切换为清爽浅色 (Light) [快捷键: T]');
    }
  }

  themeBtn?.addEventListener('click', (e) => {
    triggerClickSpark(e, 8, 'var(--cyan)');
    const nextTheme = state.currentTheme === 'oled' ? 'light' : 'oled';
    applyTheme(nextTheme);
    showToast(`已切换至 ${nextTheme === 'light' ? '清爽浅色' : '纯黑极简 (OLED)'} 模式`);
  });

  applyTheme(state.currentTheme);

  // Close Sort menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!sortMenu?.contains(e.target) && !sortTriggerBtn?.contains(e.target)) {
      sortMenu?.classList.add('hidden');
      sortTriggerBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  // ==================== 5. Fetch Archive Data (HA Dual-Track: Static CDN First + Dynamic API Fallback) ====================
  // ── 视图路由 ──────────────────────────────────────────────
  //
  // 用 history.pushState 做前端路由：地址栏是真的 /my、/favorites，
  // 可收藏、可前进后退、可直接粘链接打开。Pages 对未匹配静态文件的路径
  // 默认回退 index.html（实测），所以不需要任何服务端重写规则。
  const VIEW_BY_PATH = { '/': 'all', '/my': 'mine', '/favorites': 'fav', '/collection': 'mine' };
  const PATH_BY_VIEW = { all: '/', mine: '/my', fav: '/favorites' };
  const VIEW_META = {
    all:  { title: '', sub: '' },
    mine: { title: '我的收录', sub: '你收录的博主。公开的会出现在画廊，私密的只有你看得见。' },
    fav:  { title: '我的收藏', sub: '只有你看得见，不会出现在公开画廊。' },
  };

  function resolveViewFromUrl() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    return VIEW_BY_PATH[p] || 'all';
  }

  /** 只有这三个 section 属于公开画廊首页，其它视图要藏起来 */
  function applyViewChrome() {
    const isAll = state.viewMode === 'all';
    document.querySelector('.hero-section')?.classList.toggle('hidden', !isAll);
    document.getElementById('submit-section')?.classList.toggle('hidden', !isAll);
    document.getElementById('mylist-head')?.classList.toggle('hidden', isAll);
    // 公开/私密只有「我的收录」有；收藏没有可见性概念
    document.getElementById('mine-tools')?.classList.toggle('hidden', state.viewMode !== 'mine');

    document.querySelectorAll('#view-switch .vs-btn').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === state.viewMode);
    });

    if (!isAll) {
      const m = VIEW_META[state.viewMode];
      document.getElementById('mh-title').textContent = m.title;
      let sub = m.sub;
      if (state.viewMode === 'mine' && state.rawUsers.length) {
        const pub = state.rawUsers.filter((u) => (u.visibility || 'public') === 'public').length;
        sub = `共 ${state.rawUsers.length} 位 · 公开 ${pub} · 仅自己可见 ${state.rawUsers.length - pub}`;
      }
      document.getElementById('mh-sub').textContent = sub;
    }
    // 随机探索按钮在"我的"视图下仍然有意义（在自己的收藏里抽一个），保留
  }

  /**
   * 切换视图。fromPop=true 表示是浏览器前进/后退触发的，不能再 pushState。
   */
  async function switchView(view, { push = true } = {}) {
    if (!PATH_BY_VIEW[view]) view = 'all';
    // 未登录访问 /my 或 /favorites：不静默回首页（那样用户会以为链接坏了），
    // 而是留在该页并弹登录框，登录完成后 loadSession 会重新载入数据。
    if (view !== 'all' && !currentUser) {
      state.viewMode = view;
      applyViewChrome();
      state.rawUsers = [];
      applyFilterAndSort();
      if (push && location.pathname !== PATH_BY_VIEW[view]) history.pushState({ view }, '', PATH_BY_VIEW[view]);
      btnOpenAuth?.click();
      return;
    }

    state.viewMode = view;
    state.currentTag = '';
    if (push && location.pathname !== PATH_BY_VIEW[view]) {
      history.pushState({ view }, '', PATH_BY_VIEW[view]);
    }
    applyViewChrome();
    await loadViewData();
  }

  /** 按当前视图装载 rawUsers */
  async function loadViewData() {
    if (state.viewMode === 'all') {
      await initArchiveData();
      return;
    }
    const url = state.viewMode === 'mine' ? '/api/my-bloggers' : '/api/favorites';
    try {
      const res = await fetch(url);
      if (res.status === 401) { state.rawUsers = []; applyFilterAndSort(); btnOpenAuth?.click(); return; }
      const json = await res.json();
      state.rawUsers = Array.isArray(json.data) ? json.data : [];
    } catch {
      state.rawUsers = [];
      showToast('加载失败，请检查网络');
    }
    await loadMyTags();
    renderTagBar();
    applyViewChrome();      // 副标题里的公开/私密统计要用刚拿到的数据重算
    updateHeroAndMetrics();
    updateSortMenuForFilter(state.currentFilter);
    applyFilterAndSort();
  }

  document.querySelectorAll('#view-switch .vs-btn').forEach((a) => {
    a.addEventListener('click', (e) => {
      // 允许 Ctrl/Cmd/中键点击走浏览器默认行为（新标签页打开）
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      switchView(a.dataset.view);
    });
  });
  window.addEventListener('popstate', () => {
    switchView(resolveViewFromUrl(), { push: false });
  });

  /**
   * 公开画廊的数据装载。
   *
   * ⚠️ 这里曾有一个把所有写入都变成"看不见"的缺陷：
   * `public/data/archive.json` 是**构建产物**，只有手动跑
   * `scripts/generate-snapshot.mjs` 才更新。而原来的逻辑是"快照取到就不再看 API"。
   * 于是投稿、改可见性、屏蔽、同步 —— 所有改动都写进了 D1，但首页永远显示旧快照。
   * 站长投稿 @grok 选了「公开」，D1 里确实是 public、`/api/archive` 有 334 条，
   * 而快照停在 333 条，首页就是找不到它。
   *
   * 现在是 stale-while-revalidate：
   *   1. 先用快照立刻出图（CDN 直出、零 D1 读、后端全挂也能看）
   *   2. 紧接着向 `/api/archive` 核对，不一致就换掉并重渲染
   *   3. API 失败则保留快照 —— 原来的容灾能力一点没丢
   *
   * 重渲染有个副作用：applyFilterAndSort() 会把 renderedCount 归零、瀑布流重建，
   * 用户滚过的位置会丢。所以只在**用户还没开始操作**时才重渲染（核对通常在
   * 首屏几百毫秒内完成，那时用户还没动）；已经滚动或搜索过的，就只静默换数据，
   * 等下一次筛选/搜索自然生效。
   */
  async function initArchiveData({ force = false } = {}) {
    let loaded = false;

    // 自动补发可能积攒的离线点击队列 (Auto-flush offline clicks)
    try {
      flushPendingClickQueue();
    } catch (e) {}

    // Track 1: Static CDN JSON (100% Free, Zero Rate-Limits, Unlimited Traffic — 优先加载)
    try {
      const staticRes = await fetch('/data/archive.json');
      if (staticRes.ok) {
        const staticData = await staticRes.json();
        if (Array.isArray(staticData) && staticData.length > 0) {
          state.rawUsers = staticData;
          localStorage.setItem('x_archive_cached_data', JSON.stringify(staticData));
          loaded = true;
        }
      }
    } catch (staticErr) {
      console.warn('[HA Data Loader] Static CDN fetch failed, falling back to dynamic API:', staticErr);
    }

    // Track 2: Dynamic API Fallback (D1 Database + Edge CDN Cache — 仅在静态文件失败时降级)
    if (!loaded) {
      try {
        const res = await fetch('/api/archive');
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            state.rawUsers = json.data;
            localStorage.setItem('x_archive_cached_data', JSON.stringify(json.data));
            loaded = true;
          }
        }
      } catch (err) {
        console.warn('[HA Data Loader] Dynamic API fetch also failed:', err);
      }
    }

    // Track 3: LocalStorage offline cache
    if (!loaded) {
      fallbackToLocalStorage();
    }

    updateHeroAndMetrics();
    pickSpotlightCreator();
    updateSortMenuForFilter('all');
    applyFilterAndSort();

    // 后台核对。force=true 时绕过边缘缓存（刚投稿完要立刻看到自己加的那位）
    revalidateArchive({ force, hadSnapshot: loaded });
  }

  let revalidating = false;

  async function revalidateArchive({ force = false, hadSnapshot = true } = {}) {
    if (revalidating || state.viewMode !== 'all') return;
    revalidating = true;
    try {
      // /api/archive 带 max-age=60，正常访问由 CDN 兜住，不会次次打 D1。
      // force 时加时间戳绕过缓存 —— 只在用户刚写入后用。
      const url = force ? `/api/archive?t=${Date.now()}` : '/api/archive';
      const res = await fetch(url, force ? { cache: 'no-store' } : undefined);
      if (!res.ok) return;
      const json = await res.json();
      const fresh = Array.isArray(json.data) ? json.data : null;
      if (!fresh || !fresh.length) return;

      // 只比条数和 id 集合的签名，不做深比较 —— 点击数这类字段一直在变，
      // 深比较会导致每次核对都判定"有变化"从而无意义重渲染。
      const sig = (arr) => arr.length + '|' + arr.map((x) => x.id).join(',');
      if (hadSnapshot && sig(fresh) === sig(state.rawUsers)) return;

      state.rawUsers = fresh;
      localStorage.setItem('x_archive_cached_data', JSON.stringify(fresh));

      // 用户已经动过（滚动/搜索/筛选）就不打断他，只换数据
      const untouched = window.scrollY < 200 && !state.searchQuery && state.currentFilter === 'all';
      updateHeroAndMetrics();
      if (untouched || force) {
        pickSpotlightCreator();
        applyFilterAndSort();
      }
    } catch { /* 核对失败无所谓，快照还在 */ } finally {
      revalidating = false;
    }
  }

  function fallbackToLocalStorage() {
    const cached = localStorage.getItem('x_archive_cached_data');
    if (cached) {
      try {
        const list = JSON.parse(cached);
        if (Array.isArray(list) && list.length > 0) {
          state.rawUsers = list;
        }
      } catch (e) {}
    }
  }

  btnLoadSampleData?.addEventListener('click', (e) => {
    triggerClickSpark(e, 14, 'var(--amber)');
    state.rawUsers = defaultSampleData;
    localStorage.setItem('x_archive_cached_data', JSON.stringify(defaultSampleData));
    updateHeroAndMetrics();
    pickSpotlightCreator();
    applyFilterAndSort();
    showToast('已成功载入样例博主数据进行画廊体验！');
  });

  // ==================== 6. Metrics & Hero Spotlight ====================
  function formatFollowers(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  function updateHeroAndMetrics() {
    const total = state.rawUsers.length;
    animateCountUp(statTotalChip, total, 1000);

    if (total === 0) {
      statVerifiedChip.textContent = '0%';
      statMaxChip.textContent = '0';
      badgeCountAll.textContent = '0';
      badgeCountVerified.textContent = '0';
      if (badgeCountRecent) badgeCountRecent.textContent = '0';
      if (badgeCountLost) badgeCountLost.textContent = '0';
      return;
    }

    const verifiedCount = state.rawUsers.filter(u => u.verified).length;
    const verifiedPercent = Math.round((verifiedCount / total) * 100);
    animateCountUp(statVerifiedChip, verifiedPercent, 1200, true);

    const maxFollowers = Math.max(...state.rawUsers.map(u => u.followers_count || 0));
    animateCountUp(statMaxChip, maxFollowers, 1400, false, true);

    // 计算 7 天内最新归档的博主数
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 3600 * 1000;
    const recentCount = state.rawUsers.filter(u => {
      if (!u.backed_up_at) return false;
      const t = new Date(u.backed_up_at).getTime();
      return !isNaN(t) && (now - t) <= sevenDaysMs;
    }).length;

    const clickedCount = state.rawUsers.filter(u => (u.total_clicks || 0) > 0).length;
    const lostCount = state.rawUsers.filter(u => u.is_suspended === 1 || u.is_suspended === 2).length;

    badgeCountAll.textContent = total.toString();
    if (badgeCountHot) badgeCountHot.textContent = (clickedCount || total).toString();
    badgeCountVerified.textContent = verifiedCount.toString();
    if (badgeCountRecent) badgeCountRecent.textContent = (recentCount || Math.min(total, 5)).toString();
    if (badgeCountLost) badgeCountLost.textContent = lostCount.toString();
  }

  function resolveMediaUrl(url) {
    if (!url) return '';
    if (url.startsWith('/api/media') || url.startsWith('data:') || url.startsWith('/')) {
      return url;
    }
    if (url.includes('twimg.com')) {
      return `/api/media?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function pickSpotlightCreator() {
    if (state.rawUsers.length === 0) {
      spotlightContent.innerHTML = `
        <div style="padding: 6px 0; color: var(--ink-soft); font-size: 13px; line-height: 1.6;">
          <div style="font-weight: 700; color: var(--ink); margin-bottom: 4px;">准备好探索精选博主了吗？</div>
          <div>在控制台配置 Cookie 并点击一键同步后，此处将为您自动推送主页优质创作者。</div>
        </div>
      `;
      return;
    }

    // 过滤掉已封号 (is_suspended = 1) 和已注销 (is_suspended = 2) 的博主
    const activeUsers = state.rawUsers.filter(u => !u.is_suspended || u.is_suspended === 0);
    const basePool = activeUsers.length > 0 ? activeUsers : state.rawUsers;
    const candidates = basePool.filter(u => u.followers_count >= 50000 || u.verified);
    const pool = candidates.length > 0 ? candidates : basePool;

    // "今日精选" 按日期取种子：同一天刷新页面得到同一位博主，换天自动轮换。
    // (原站用 Math.random()，每次刷新都变，与"今日"的语义不符。)
    // shuffleSpotlight=true 时才真正随机，用于"换一位推荐"按钮。
    const randomUser = spotlightShuffleRequested
      ? pool[Math.floor(Math.random() * pool.length)]
      : pool[dailySeedIndex(pool.length)];
    spotlightShuffleRequested = false;

    renderSpotlightCard(randomUser);
  }

  // 让"今日精选"在同一天内稳定：用 YYYY-MM-DD 做种子
  let spotlightShuffleRequested = false;
  function dailySeedIndex(len) {
    if (len <= 0) return 0;
    const today = new Date();
    const key = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % len;
  }

  function renderSpotlightCard(user) {
    const rawAvatar = user.avatar_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const avatar = resolveMediaUrl(rawAvatar);
    const isTopTier = (user.followers_count >= 500000);
    const tag = isTopTier ? 'Top Creator' : 'Creator';

    spotlightContent.innerHTML = `
      <div class="spotlight-avatar-wrap" onclick="window.trackBloggerClick('${escapeHtml(user.screen_name)}', 'card'); window.open('https://x.com/${user.screen_name}', '_blank')">
        <img class="spotlight-avatar" src="${avatar}" alt="${escapeHtml(user.name)}" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';">
        ${user.verified ? `<div class="badge-verified-native" style="bottom: 2px; right: 2px;" title="Twitter 官方认证">${ICONS.verifiedNative}</div>` : ''}
      </div>
      <div class="spotlight-meta">
        <div class="spotlight-name-row">
          <span class="spotlight-name" title="${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
          <span class="card-influence-pill ${isTopTier ? 'top-tier' : ''}">${escapeHtml(tag)}</span>
        </div>
        <a class="spotlight-handle" href="https://x.com/${user.screen_name}" target="_blank" onclick="window.trackBloggerClick('${escapeHtml(user.screen_name)}', 'card');">@${escapeHtml(user.screen_name)} · ${formatFollowers(user.followers_count)} 关注</a>
        <div class="spotlight-bio-snippet">${formatBioWithLinks(user.description)}</div>
      </div>
    `;
  }

  btnShuffleSpotlight?.addEventListener('click', (e) => {
    triggerClickSpark(e, 12, 'var(--cyan)');
    // 手动"换一位推荐"才真正随机，页面加载时保持当日稳定
    spotlightShuffleRequested = true;
    pickSpotlightCreator();
  });

  // ==================== 7. Filtering & Sorting Engine ====================
  function applyFilterAndSort() {
    const query = state.searchQuery.trim().toLowerCase();

    state.filteredUsers = state.rawUsers.filter(user => {
      const matchesQuery = !query ||
        (user.screen_name && user.screen_name.toLowerCase().includes(query)) ||
        (user.name && user.name.toLowerCase().includes(query)) ||
        (user.description && user.description.toLowerCase().includes(query));

      // 公开/私密筛选只在「我的收录」里有意义（收藏没有可见性，画廊全是公开的）
      if (state.viewMode === 'mine' && state.visFilter) {
        if ((user.visibility || 'public') !== state.visFilter) return false;
      }

      // 标签筛选只在「我的收录 / 我的收藏」里有意义（公开画廊没有标签概念）
      if (state.viewMode !== 'all' && state.currentTag) {
        const tags = user.tag_ids || [];
        const matchesTag = state.currentTag === '__untagged' ? tags.length === 0 : tags.includes(state.currentTag);
        if (!matchesTag) return false;
      }

      let matchesFilter = true;
      if (state.currentFilter === 'verified') {
        matchesFilter = !!user.verified;
      } else if (state.currentFilter === 'top') {
        matchesFilter = (user.followers_count || 0) >= 500000;
      } else if (state.currentFilter === '100k') {
        matchesFilter = (user.followers_count || 0) >= 100000;
      } else if (state.currentFilter === 'hot') {
        matchesFilter = true;
      } else if (state.currentFilter === 'recent') {
        matchesFilter = true;
      } else if (state.currentFilter === 'lost') {
        matchesFilter = (user.is_suspended === 1 || user.is_suspended === 2);
      }

      return matchesQuery && matchesFilter;
    });

    state.filteredUsers.sort((a, b) => {
      if (state.currentSort === 'clicks-desc') {
        const clickDiff = (b.total_clicks || 0) - (a.total_clicks || 0);
        if (clickDiff !== 0) return clickDiff;
        return (b.followers_count || 0) - (a.followers_count || 0);
      } else if (state.currentSort === 'clicks-asc') {
        const clickDiff = (a.total_clicks || 0) - (b.total_clicks || 0);
        if (clickDiff !== 0) return clickDiff;
        return (a.followers_count || 0) - (b.followers_count || 0);
      } else if (state.currentSort === 'recent' || state.currentFilter === 'recent') {
        const timeA = a.backed_up_at ? new Date(a.backed_up_at).getTime() : 0;
        const timeB = b.backed_up_at ? new Date(b.backed_up_at).getTime() : 0;
        if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
          return timeB - timeA;
        }
        return (b.id || '').toString().localeCompare((a.id || '').toString());
      } else if (state.currentSort === 'followers-desc') {
        return (b.followers_count || 0) - (a.followers_count || 0);
      } else if (state.currentSort === 'followers-asc') {
        return (a.followers_count || 0) - (b.followers_count || 0);
      } else if (state.currentSort === 'name-asc') {
        return (a.name || a.screen_name).localeCompare(b.name || b.screen_name);
      }
      return 0;
    });

    resultsCountText.textContent = state.viewMode === 'all'
      ? `共呈现 ${state.filteredUsers.length} 位博主归档`
      : `${state.viewMode === 'mine' ? '我的收录' : '我的收藏'} · ${state.filteredUsers.length} 位`;
    
    // Reset columns and start fresh render
    state.renderedCount = 0;
    initMasonryStructure();
    renderMoreCards();
  }

  const SORT_OPTIONS = {
    hot: [
      { val: 'clicks-desc', text: '热度从高到低' },
      { val: 'clicks-asc', text: '热度从低到高' }
    ],
    default: [
      { val: 'followers-desc', text: '粉丝数从高到低' },
      { val: 'followers-asc', text: '粉丝数从低到高' },
      { val: 'name-asc', text: '博主名称 (A → Z)' },
      { val: 'recent', text: '归档时间最近' }
    ]
  };

  function updateSortMenuForFilter(filterName) {
    const isHot = filterName === 'hot';
    const options = isHot ? SORT_OPTIONS.hot : SORT_OPTIONS.default;

    // 检查当前排序值是否在当前类目的合法列表中
    const isValid = options.some(o => o.val === state.currentSort);
    if (!isValid) {
      if (isHot) {
        state.currentSort = 'clicks-desc';
      } else if (filterName === 'recent') {
        state.currentSort = 'recent';
      } else {
        state.currentSort = 'followers-desc';
      }
    }

    const currentOpt = options.find(o => o.val === state.currentSort) || options[0];
    if (sortCurrentText) sortCurrentText.textContent = currentOpt.text;

    if (sortMenu) {
      sortMenu.innerHTML = options.map(opt => {
        const isActive = opt.val === state.currentSort;
        return `
          <div class="menu-item ${isActive ? 'active' : ''}" data-val="${opt.val}" role="option">
            <span>${opt.text}</span>
            <svg class="check-icon ${isActive ? '' : 'hidden'}" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><use href="/icons.svg#check"/></svg>
          </div>
        `;
      }).join('');

      sortMenu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
          const val = item.getAttribute('data-val');
          const txt = item.querySelector('span')?.textContent || '';
          setSortMenuSelection(val, txt);
          sortMenu.classList.add('hidden');
          sortTriggerBtn?.setAttribute('aria-expanded', 'false');
          applyFilterAndSort();
        });
      });
    }
  }

  function setSortMenuSelection(sortVal, sortText) {
    state.currentSort = sortVal;
    if (sortCurrentText) sortCurrentText.textContent = sortText;
    sortMenu?.querySelectorAll('.menu-item').forEach(item => {
      const match = item.getAttribute('data-val') === sortVal;
      item.classList.toggle('active', match);
      item.querySelector('.check-icon')?.classList.toggle('hidden', !match);
    });
  }

  // 首屏数据请求尚未完成时，排序菜单也要有完整选项。
  updateSortMenuForFilter(state.currentFilter);

  globalSearch?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    searchClearBtn.classList.toggle('hidden', !state.searchQuery);
    applyFilterAndSort();
  });

  searchClearBtn?.addEventListener('click', () => {
    globalSearch.value = '';
    state.searchQuery = '';
    searchClearBtn.classList.add('hidden');
    globalSearch.focus();
    applyFilterAndSort();
  });

  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.currentFilter = pill.getAttribute('data-filter');

      updateSortMenuForFilter(state.currentFilter);
      applyFilterAndSort();
    });
  });

  btnResetFilters?.addEventListener('click', (e) => {
    triggerClickSpark(e, 8, 'var(--cyan)');
    globalSearch.value = '';
    state.searchQuery = '';
    searchClearBtn.classList.add('hidden');
    state.currentFilter = 'all';
    filterPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-filter') === 'all'));
    updateSortMenuForFilter('all');
    applyFilterAndSort();
    showToast('已重置所有筛选条件');
  });

  sortTriggerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isClosed = sortMenu.classList.toggle('hidden');
    sortTriggerBtn.setAttribute('aria-expanded', String(!isClosed));
  });

  viewTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      viewTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentView = tab.getAttribute('data-view');
      state.renderedCount = 0;
      initMasonryStructure();
      renderMoreCards();
    });
  });

  // ==================== 8. 分列布局与增量渲染 ====================
  function getResponsiveColumnCount(view) {
    if (view === 'list') return 1;
    const width = window.innerWidth;
    const gridColumns = width <= 640 ? 1 : width <= 1024 ? 2 : 3;
    return gridColumns + (view === 'compact' ? 1 : 0);
  }

  function initMasonryStructure() {
    bloggerWall.innerHTML = '';
    bloggerWall.className = `blogger-wall ${state.currentView}-view`;
    state.columnElements = state.currentView === 'list' ? [bloggerWall]
      : Array.from({ length: getResponsiveColumnCount(state.currentView) }, () => {
        const column = document.createElement('div');
        column.className = 'masonry-column';
        bloggerWall.appendChild(column);
        return column;
      });
  }

  function nextCardColumn() {
    if (state.currentView === 'list') return bloggerWall;
    let target = state.columnElements[0];
    let height = target.offsetHeight;
    for (const column of state.columnElements.slice(1)) {
      const candidateHeight = column.offsetHeight;
      if (candidateHeight < height) {
        target = column;
        height = candidateHeight;
      }
    }
    return target;
  }

  // 每插入一张卡后再测列高；批量预计算会改变后续卡片的归属。等高时取最左列。
  function appendCardRange(start, end) {
    for (let index = start; index < end; index++) {
      const card = createBloggerCardElement(state.filteredUsers[index], index);
      nextCardColumn().appendChild(card);
    }
    state.renderedCount = end;
    infiniteSentinel?.classList.toggle('hidden', end >= state.filteredUsers.length);
  }

  let resizeDebounceTimer = null;
  let activeColCount = getResponsiveColumnCount(state.currentView);
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      const columns = getResponsiveColumnCount(state.currentView);
      if (columns === activeColCount) return;
      activeColCount = columns;
      const end = Math.min(Math.max(PAGE_SIZE, state.renderedCount), state.filteredUsers.length);
      state.renderedCount = 0;
      initMasonryStructure();
      appendCardRange(0, end);
    }, 180);
  });

  function renderMoreCards() {
    if (state.rawUsers.length === 0) {
      emptyStateDb?.classList.remove('hidden');
      emptyStateSearch?.classList.add('hidden');
      infiniteSentinel?.classList.add('hidden');
      return;
    }
    emptyStateDb?.classList.add('hidden');

    if (state.filteredUsers.length === 0) {
      emptyStateSearch?.classList.remove('hidden');
      infiniteSentinel?.classList.add('hidden');
      return;
    }
    emptyStateSearch?.classList.add('hidden');

    const totalFiltered = state.filteredUsers.length;
    const startIndex = state.renderedCount;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalFiltered);

    if (startIndex >= totalFiltered) {
      infiniteSentinel?.classList.add('hidden');
      return;
    }

    if (state.columnElements.length === 0) {
      initMasonryStructure();
    }

    appendCardRange(startIndex, endIndex);
  }

  // 操作栏是三种视图共用的契约：把状态分支集中在一个模板里，避免某个视图
  // 修按钮时漏掉收藏、标签或取消收录的可达性。
  function renderFavoriteButton(user, isFaved) {
    if (!currentUser) return '';
    return `
      <button class="card-fav-btn ${isFaved ? 'is-fav' : ''}" type="button"
              data-handle="${escapeHtml(user.screen_name)}"
              title="${isFaved ? '取消收藏' : '加入收藏'}" aria-label="${isFaved ? '取消收藏' : '加入收藏'}">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#heart-fill-outline"/></svg>
      </button>
    `;
  }

  function renderCardActions(user, isFaved, isTombstone) {
    const handle = escapeHtml(user.screen_name);
    const name = escapeHtml(user.name || '');
    const visibility = user.visibility || 'public';
    const privateView = visibility === 'private';
    const inPersonalView = state.viewMode !== 'all';

    return `
      <div class="card-action-footer">
        ${state.currentView === 'list' ? renderFavoriteButton(user, isFaved) : ''}
        ${state.viewMode === 'mine' && currentUser ? `
          <button class="btn-card-vis ${privateView ? 'is-private' : 'is-public'}" type="button"
                  data-handle="${handle}" data-vis="${escapeHtml(visibility)}"
                  title="${privateView ? '当前「仅自己可见」，点击公开到画廊' : '当前「公开」，点击改为仅自己可见'}">
            ${privateView ? `
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" aria-hidden="true"><use href="/icons.svg#lock"/></svg>
              <span>仅自己</span>
            ` : `
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" aria-hidden="true"><use href="/icons.svg#globe"/></svg>
              <span>公开</span>
            `}
          </button>` : ''}
        ${inPersonalView && currentUser ? `
          <button class="btn-card-tag" type="button" data-id="${escapeHtml(user.id)}" data-handle="${handle}"
                  title="归入标签 / 文件夹">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#tag"/></svg>
            <span>${(user.tag_ids || []).length ? `标签 ${(user.tag_ids || []).length}` : '标签'}</span>
          </button>` : ''}
        ${state.viewMode === 'mine' && currentUser ? `
          <button class="btn-card-remove" type="button" data-handle="${handle}" data-name="${name}"
                  title="取消收录：只移除这一条归属，公开仓与他人的收录不受影响">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#trash-outline"/></svg>
            <span>取消收录</span>
          </button>` : ''}
        <button class="btn-inspect-profile" type="button">
          ${ICONS.eye}
          <span>时光档案</span>
        </button>
        <a class="btn-visit-x" href="https://x.com/${user.screen_name}" target="_blank" onclick="event.stopPropagation(); window.trackBloggerClick('${handle}', 'card');">
          <span>${isTombstone ? '原主页' : '访问 X'}</span>
          ${ICONS.external}
        </a>
      </div>
    `;
  }

  function createBloggerCardElement(user, idx) {
    const card = document.createElement('div');
    const isSuspended = user.is_suspended === 1;
    const isDeleted = user.is_suspended === 2;
    const isTombstone = isSuspended || isDeleted;

    card.className = `blogger-card ${isTombstone ? 'is-tombstone' : ''}`;
    card.setAttribute('role', 'article');
    card.setAttribute('tabindex', '0');
    card.style.animationDelay = `${Math.min(idx * 20, 250)}ms`;

    const rawAvatar = user.avatar_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const avatarSrc = resolveMediaUrl(rawAvatar);
    
    let rawCover = user.cover_url || '';
    if (rawCover && rawCover.includes('pbs.twimg.com/profile_banners') && !rawCover.match(/\/(600x200|1500x500|responsive_web)$/)) {
      rawCover = rawCover.replace(/\/+$/, '') + '/600x200';
    }
    const coverSrc = rawCover ? resolveMediaUrl(rawCover) : fallbackCovers[idx % fallbackCovers.length];

    const isTopTier = (user.followers_count >= 500000);
    const tierTag = isTopTier ? 'Top Creator' : 'Creator';
    const formattedBio = formatBioWithLinks(user.description);

    let statusBadgeHtml = '';
    if (isSuspended) {
      statusBadgeHtml = `<span class="badge-status-pill suspended" title="X 官方账号已被封禁/冻结，历史档案已永久冷备份">${ICONS.ghost} 已封号</span>`;
    } else if (isDeleted) {
      statusBadgeHtml = `<span class="badge-status-pill deleted" title="X 官方账号已注销或不存在，历史档案已永久冷备份">${ICONS.ghost} 已注销</span>`;
    }

    const isFaved = myFavoriteIds.has(user.id);
    card.innerHTML = `
      <div class="card-ambient-glow"></div>
      <div class="card-header-banner" style="background-image: url('${coverSrc}');">
        ${isTombstone ? '<div class="tombstone-banner-veil"></div>' : ''}
        ${state.currentView !== 'list' ? `<div class="card-header-tools">${renderFavoriteButton(user, isFaved)}</div>` : ''}
      </div>
      ${state.viewMode !== 'all' && (user.tag_ids || []).length ? `
        <div class="card-tag-dots" title="已归入 ${(user.tag_ids || []).length} 个标签">
          ${(user.tag_ids || []).slice(0, 5).map((id) => {
            const t = state.myTags.find((x) => x.id === id);
            return `<span class="tag-dot tag-c-${t && TAG_COLORS.includes(t.color) ? t.color : 'slate'}" title="${escapeHtml(t?.name || '')}"></span>`;
          }).join('')}
          ${(user.tag_ids || []).length > 5 ? `<span class="card-tag-more">+${(user.tag_ids || []).length - 5}</span>` : ''}
        </div>` : ''}
      <div class="card-main-content">
        <div class="card-avatar-row">
          <div class="card-avatar-wrap">
            <img class="card-avatar-img" src="${avatarSrc}" alt="${escapeHtml(user.name)}" loading="lazy" crossorigin="anonymous" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';">
            ${user.verified ? `<div class="badge-verified-native" title="Twitter 官方认证">${ICONS.verifiedNative}</div>` : ''}
          </div>
        </div>

        <div class="card-user-info">
          <div class="card-name-row">
            <span class="card-user-name" title="${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
            <span class="card-influence-pill ${isTopTier ? 'top-tier' : ''}">${escapeHtml(tierTag)}</span>
            ${statusBadgeHtml}
          </div>
          <a class="card-user-handle" href="https://x.com/${user.screen_name}" target="_blank" onclick="event.stopPropagation(); window.trackBloggerClick('${escapeHtml(user.screen_name)}', 'card');">@${escapeHtml(user.screen_name)}</a>
          <div class="card-metrics-chip">
            ${ICONS.users}
            <span>${formatFollowers(user.followers_count)} 关注者</span>
          </div>
        </div>

        <div class="card-bio-content">${formattedBio}</div>
      </div>

      ${renderCardActions(user, isFaved, isTombstone)}
    `;

    // Initialize deterministic vibrant palette immediately
    const initialRgb = isTombstone ? '148, 163, 184' : getFallbackAccent(user.screen_name || user.name);
    card.style.setProperty('--card-accent-rgb', initialRgb);
    card.style.setProperty('--card-accent', `rgb(${initialRgb})`);

    // Dynamic Ambient Color Refinement on Image Load
    if (!isTombstone) {
      const avatarImg = card.querySelector('.card-avatar-img');
      if (avatarImg) {
        const applyColor = () => {
          const rgb = extractDominantColor(avatarImg, user.screen_name);
          card.style.setProperty('--card-accent-rgb', rgb);
          card.style.setProperty('--card-accent', `rgb(${rgb})`);
        };
        if (avatarImg.complete && avatarImg.naturalWidth !== 0) {
          applyColor();
        } else {
          avatarImg.addEventListener('load', applyColor, { once: true });
        }
      }
    }

    attachSpotlightEffect(card);

    // 收藏按钮要阻止冒泡，否则会连带打开详情抽屉
    card.querySelector('.btn-card-vis')?.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.currentTarget;
      const handle = btn.dataset.handle;
      const target = btn.dataset.vis === 'private' ? 'public' : 'private';
      btn.disabled = true;
      try {
        const r = await fetch('/api/my-bloggers', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screen_name: handle, visibility: target }),
        }).then((x) => x.json());
        if (r.success) {
          showToast(r.message);
          // 就地更新本地数据后重渲染当前视图，不整页重载（保住滚动位置）
          const u = state.rawUsers.find((x) => x.screen_name === handle);
          if (u) u.visibility = target;
          applyFilterAndSort();
          applyViewChrome();  // 副标题里的「公开 X · 仅自己可见 Y」要跟着重算
          // 公开画廊的成员变了 -> 让下次回首页拿到新数据
          localStorage.removeItem('x_archive_cached_data');
        } else showToast(r.error);
      } catch { showToast('网络异常'); }
      btn.disabled = false;
    });

    card.querySelector('.btn-card-tag')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const b = e.currentTarget;
      window.__xvOpenTagPicker(b.dataset.id, b.dataset.handle);
    });

    // 取消收录 = 删掉「我的收录」里的这一行归属指针（服务端 releaseOwnership）。
    // 共享的归档数据全库只有一份：公开仓与他人的收录是各自的指针，纹丝不动；
    // 只有当没有任何人引用（无人收录、无人收藏）时服务端才会把数据连带回收 ——
    // 这是唯一不可逆的部分，确认框必须把它和"只是移除自己这条"区分开。
    card.querySelector('.btn-card-remove')?.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.currentTarget;
      const handle = btn.dataset.handle;
      const name = btn.dataset.name;
      if (!confirm(
        `取消收录 @${handle}${name ? `（${name}）` : ''}？\n\n` +
        `· 只移除「我的收录」里的这一条，公开仓和其他人的收录不受影响\n` +
        `· 你还收藏着它的话，收藏与标签保留，只是不再出现在「我的收录」\n` +
        `· 若之后没有任何人收录或收藏它，这份归档数据（点击统计、时间线、媒体）会被一并回收，不可恢复`
      )) return;
      btn.disabled = true;
      try {
        const r = await fetch('/api/my-bloggers', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screen_name: handle }),
        }).then((x) => x.json());
        if (r.success) {
          // 服务端 message 已讲清共享数据是留是收（kept_admin / kept_favorites / gc）
          showToast(r.message || `已取消收录 @${handle}`);
          // 就地从本地数据移除并重渲染（保住滚动位置），不整页重载
          state.rawUsers = state.rawUsers.filter((x) => x.screen_name !== handle);
          applyFilterAndSort();
          applyViewChrome();  // 副标题统计同步重算
          // 公开画廊成员可能变了（引用归零被回收 / 原本公开的被撤下）-> 让下次回首页拿到新数据
          localStorage.removeItem('x_archive_cached_data');
        } else showToast(r.error);
      } catch { showToast('网络异常'); }
      // 重渲染后按钮已被替换，无需恢复可用态
    });

    card.querySelector('.card-fav-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.__xvToggleFavorite(user.screen_name, e.currentTarget);
    });

    card.addEventListener('click', () => openInspectorDrawer(user));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openInspectorDrawer(user);
    });

    return card;
  }

  // Infinite Scroll Listener
  window.addEventListener('scroll', () => {
    if (state.isLoadingMore) return;
    if (state.renderedCount >= state.filteredUsers.length) return;

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 600) {
      state.isLoadingMore = true;
      setTimeout(() => {
        renderMoreCards();
        state.isLoadingMore = false;
      }, 150);
    }
  });

  // ==================== 9. Frameless Slot Machine Decelerating Random Roulette Modal ====================
  function startRandomRouletteShuffle() {
    if (state.rawUsers.length === 0) {
      showToast('归档库中暂无博主数据，请先同步或载入样例数据');
      return;
    }

    if (state.isShuffling) return;
    state.isShuffling = true;

    // Open center frameless modal
    rouletteBackdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Hide actions during shuffle
    rouletteOutsideActions?.classList.remove('is-visible');
    rouletteDismissHint?.classList.remove('is-visible');

    rouletteCardContainer.classList.remove('is-settled');
    rouletteCardContainer.classList.add('is-shuffling');

    // 过滤掉已封号 (is_suspended = 1) 和已注销 (is_suspended = 2) 的博主，确保只抽取正常活跃的博主
    const activeUsers = state.rawUsers.filter(u => !u.is_suspended || u.is_suspended === 0);
    const pool = activeUsers.length > 0 ? activeUsers : state.rawUsers;
    
    // 30+ Frames Realistic Slot Machine Deceleration Curve:
    // Phase 1: High-speed dash (20 frames, ~28ms each, dazzling motion blur)
    // Phase 2: Deceleration braking (9 frames, physical brake stagger)
    const dashFrames = Array(20).fill(28);
    const brakingFrames = [45, 70, 110, 165, 240, 340, 470, 620, 800];
    const delays = [...dashFrames, ...brakingFrames];
    let stepIndex = 0;

    // Pick final target winner
    const winnerIndex = Math.floor(Math.random() * pool.length);
    const winnerUser = pool[winnerIndex];

    function nextShuffleStep() {
      const tempUser = pool[Math.floor(Math.random() * pool.length)];
      renderRouletteCardPreview(tempUser, false);

      if (stepIndex < delays.length) {
        const delay = delays[stepIndex];
        stepIndex++;
        setTimeout(nextShuffleStep, delay);
      } else {
        finalizeRouletteWinner(winnerUser);
      }
    }

    nextShuffleStep();
  }

  function renderRouletteCardPreview(user, _isFinal) {
    const rawAvatar = user.avatar_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const avatarSrc = resolveMediaUrl(rawAvatar);
    let rawCover = user.cover_url || fallbackCovers[0];
    if (rawCover.includes('pbs.twimg.com/profile_banners') && !rawCover.match(/\/(600x200|1500x500|responsive_web)$/)) {
      rawCover = rawCover.replace(/\/+$/, '') + '/600x200';
    }
    const coverSrc = resolveMediaUrl(rawCover);

    const isTopTier = (user.followers_count >= 500000);
    const tierTag = isTopTier ? 'Top Creator' : 'Creator';

    rouletteBanner.style.backgroundImage = `url('${coverSrc}')`;
    rouletteAvatar.src = avatarSrc;
    rouletteTag.className = `card-influence-pill ${isTopTier ? 'top-tier' : ''}`;
    rouletteTag.textContent = tierTag;
    rouletteName.textContent = user.name;
    rouletteVerified.style.display = user.verified ? 'flex' : 'none';
    rouletteHandle.textContent = `@${user.screen_name} · ${formatFollowers(user.followers_count)} 关注者`;
    rouletteBio.innerHTML = formatBioWithLinks(user.description);
    btnRouletteVisit.href = `https://x.com/${user.screen_name}`;
    btnRouletteVisit.onclick = () => window.trackBloggerClick(user.screen_name, 'roulette');
  }

  function finalizeRouletteWinner(user) {
    // 1. 倒数第二张卡片顺着滚轮惯性向上平滑滚出 (140ms)
    rouletteCardContainer.classList.add('is-rolling-out');

    setTimeout(() => {
      // 2. 注入获胜博主数据
      renderRouletteCardPreview(user, true);

      // 3. 移除滚出状态，触发最终卡片从下方滑入 + 拟真弹性卡扣回弹落定 (Spring Bounce)
      rouletteCardContainer.classList.remove('is-rolling-out', 'is-shuffling');
      void rouletteCardContainer.offsetWidth; // 强制触发 CSS 关键帧重绘
      rouletteCardContainer.classList.add('is-settled');
      state.isShuffling = false;

      // 4. 触发金色粒子爆破与星芒礼花
      triggerLuxuryCelebrationFireworks(rouletteCardContainer);

      // 5. 平滑展现底部操作栏
      setTimeout(() => {
        rouletteOutsideActions?.classList.add('is-visible');
        rouletteDismissHint?.classList.add('is-visible');
      }, 160);

      showToast(`抽取命中：@${user.screen_name}`);
    }, 140);
  }

  function closeRouletteModal() {
    if (state.isShuffling) return;
    rouletteBackdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }

  btnLuckyPick?.addEventListener('click', (e) => {
    triggerClickSpark(e, 10, 'var(--pink)');
    startRandomRouletteShuffle();
  });

  btnReshuffleAgain?.addEventListener('click', (e) => {
    triggerClickSpark(e, 10, 'var(--pink)');
    startRandomRouletteShuffle();
  });

  rouletteBackdrop?.addEventListener('click', (e) => {
    if (e.target === rouletteBackdrop) closeRouletteModal();
  });

  // ==================== 10. Inspector Detail Drawer (Polaroid Time Capsule & Mutation Timeline) ====================
  function openInspectorDrawer(user) {
    const rawAvatar = user.avatar_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const avatar = resolveMediaUrl(rawAvatar);
    const rawCover = user.cover_url || fallbackCovers[0];
    const cover = resolveMediaUrl(rawCover);
    const isTop = (user.followers_count >= 500000);
    const isSuspended = user.is_suspended === 1;
    const isDeleted = user.is_suspended === 2;
    const isTombstone = isSuspended || isDeleted;

    const archivedTime = user.backed_up_at ? new Date(user.backed_up_at) : new Date();
    const archiveDateStr = !isNaN(archivedTime.getTime()) ? archivedTime.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '已收录';
    const daysSinceArchive = !isNaN(archivedTime.getTime()) ? Math.max(1, Math.floor((Date.now() - archivedTime.getTime()) / (1000 * 60 * 60 * 24))) : 1;
    const vaultNo = 'VAULT-' + String(user.id || user.screen_name).slice(-5).toUpperCase().padStart(5, '0');

    let memorialNotice = '';
    if (isSuspended) {
      memorialNotice = `
        <div class="memorial-banner">
          <div class="memorial-banner-header">
            ${ICONS.ghost}
            <span><strong>赛博坟场 · 信号沉寂</strong></span>
          </div>
          <p>该博主 X 官方账号已被封禁/冻结。本档案馆已永久冷固化其最后的历史头像、背景及简介资产。</p>
          <div class="memorial-actions">
            <button class="btn-send-candle" id="btn-send-candle" type="button">
              ${ICONS.candle}
              <span>为 TA 点亮一盏微光</span>
            </button>
          </div>
        </div>
      `;
    } else if (isDeleted) {
      memorialNotice = `
        <div class="memorial-banner deleted">
          <div class="memorial-banner-header">
            ${ICONS.ghost}
            <span><strong>赛博坟场 · 账号注销</strong></span>
          </div>
          <p>该博主 X 官方账号已注销或不存在。历史数据已在此永久留档存续。</p>
          <div class="memorial-actions">
            <button class="btn-send-candle" id="btn-send-candle" type="button">
              ${ICONS.candle}
              <span>为 TA 点亮一盏微光</span>
            </button>
          </div>
        </div>
      `;
    }

    drawerBody.innerHTML = `
      <div class="polaroid-capsule-card ${isTombstone ? 'is-tombstone' : ''}">
        <!-- Top Full-Bleed Polaroid Header Banner -->
        <div class="polaroid-header-wrap">
          <div class="polaroid-banner-img" style="background-image: url('${cover}');">
            <div class="polaroid-banner-scrim"></div>
          </div>
          <div class="polaroid-stamp">
            <div class="stamp-border">
              <span class="stamp-title">ARCHIVE CERTIFIED</span>
              <span class="stamp-id">${vaultNo}</span>
              <span class="stamp-date">${archiveDateStr}</span>
            </div>
          </div>
        </div>

        <!-- Floating Avatar & Tags Row -->
        <div class="polaroid-profile-row">
          <div class="polaroid-avatar-wrap">
            <img class="polaroid-avatar-img" src="${avatar}" alt="${escapeHtml(user.name)}" crossorigin="anonymous" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';">
            ${user.verified ? `<div class="badge-verified-native" title="Twitter 官方认证">${ICONS.verifiedNative}</div>` : ''}
          </div>
          <div class="polaroid-tags-group">
            ${isSuspended ? `<span class="badge-status-pill suspended">${ICONS.ghost} 已封号</span>` : ''}
            ${isDeleted ? `<span class="badge-status-pill deleted">${ICONS.ghost} 已注销</span>` : ''}
            <span class="card-influence-pill ${isTop ? 'top-tier' : ''}">${isTop ? 'Top 头部创作者' : '精选创作者'}</span>
          </div>
        </div>

        <!-- Identity & Handle -->
        <div class="polaroid-name-block">
          <h2 id="drawer-user-name" class="polaroid-user-name">${escapeHtml(user.name)}</h2>
          <div class="polaroid-handle-row">
            <span class="polaroid-handle-text">@${escapeHtml(user.screen_name)}</span>
            <button id="btn-copy-handle" class="btn-chip-copy" title="复制 @ID">
              ${ICONS.copy}
              <span>复制 ID</span>
            </button>
          </div>
        </div>

        ${memorialNotice}

        <!-- 4-Cell Time Capsule Metric Grid -->
        <div class="polaroid-metric-grid">
          <div class="metric-cell">
            <div class="metric-val">${formatFollowers(user.followers_count)}</div>
            <div class="metric-lbl">关注者 (粉丝)</div>
          </div>
          <div class="metric-cell">
            <div class="metric-val ${user.verified ? 'is-verified' : ''}">${user.verified ? '官方认证' : '普通用户'}</div>
            <div class="metric-lbl">蓝标状态</div>
          </div>
          <div class="metric-cell">
            <div class="metric-val">${archiveDateStr}</div>
            <div class="metric-lbl">首次归档日</div>
          </div>
          <div class="metric-cell">
            <div class="metric-val highlight">${daysSinceArchive} 天</div>
            <div class="metric-lbl">已留存时光</div>
          </div>
        </div>

        <!-- Full Bio Section -->
        <div class="polaroid-bio-section">
          <div class="section-title-tag">博主简介 (Bio)</div>
          <div class="polaroid-bio-card">
            ${formatBioWithLinks(user.description)}
          </div>
        </div>

        <!-- Mutation Timeline Collapsible Section -->
        <details class="polaroid-history-accordion" id="drawer-history-details">
          <summary class="polaroid-history-summary">
            <div class="summary-left">
              ${ICONS.history}
              <span>变迁履历档案 (Profile Timeline)</span>
            </div>
            <div class="summary-arrow">${ICONS.chevronDown}</div>
          </summary>
          <div class="polaroid-history-content" id="drawer-history-list">
            <div class="timeline-loading-spinner">
              <div class="skeleton-spinner"></div>
              <span>正在调取时光变迁档案...</span>
            </div>
          </div>
        </details>

        <!-- Action Footer -->
        <div class="polaroid-actions-row">
          <a class="btn-drawer-primary" href="https://x.com/${user.screen_name}" target="_blank" onclick="window.trackBloggerClick('${escapeHtml(user.screen_name)}', 'timeline');">
            <span>${isTombstone ? '前往 X 查看原账号' : '前往 X 个人主页'}</span>
            ${ICONS.external}
          </a>
          <button class="btn-drawer-secondary" id="btn-copy-markdown" type="button" title="一键复制 Markdown 档案卡">
            ${ICONS.markdown}
            <span>复制 Markdown</span>
          </button>
        </div>
      </div>
    `;

    // Initialize drawer ambient tint immediately
    const initialDrawerRgb = isTombstone ? '148, 163, 184' : getFallbackAccent(user.screen_name || user.name);
    drawerBody.style.setProperty('--card-accent-rgb', initialDrawerRgb);
    drawerBody.style.setProperty('--card-accent', `rgb(${initialDrawerRgb})`);

    const drawerAvatarImg = drawerBody.querySelector('.polaroid-avatar-img');
    if (drawerAvatarImg && !isTombstone) {
      const applyDrawerColor = () => {
        const rgb = extractDominantColor(drawerAvatarImg, user.screen_name);
        drawerBody.style.setProperty('--card-accent-rgb', rgb);
        drawerBody.style.setProperty('--card-accent', `rgb(${rgb})`);
      };
      if (drawerAvatarImg.complete && drawerAvatarImg.naturalWidth !== 0) {
        applyDrawerColor();
      } else {
        drawerAvatarImg.addEventListener('load', applyDrawerColor, { once: true });
      }
    }

    // Copy Handle Handler
    document.getElementById('btn-copy-handle')?.addEventListener('click', (e) => {
      triggerClickSpark(e, 8, 'var(--card-accent)');
      navigator.clipboard.writeText(`@${user.screen_name}`);
      showToast(`已复制 @${user.screen_name} 到剪贴板`);
    });

    // Copy Markdown Card Handler
    document.getElementById('btn-copy-markdown')?.addEventListener('click', (e) => {
      triggerClickSpark(e, 10, 'var(--card-accent)');
      const mdContent = `### ${user.name} (@${user.screen_name})\n\n- **粉丝数**：${formatFollowers(user.followers_count)}\n- **认证状态**：${user.verified ? '已蓝标认证' : '未认证'}\n- **归档编号**：${vaultNo}\n- **首次收录**：${archiveDateStr}\n- **已留存**：${daysSinceArchive} 天\n- **个人简介**：${user.description || '暂无简介'}\n- **主页链接**：https://x.com/${user.screen_name}`;
      navigator.clipboard.writeText(mdContent);
      showToast('已复制博主 Markdown 档案卡到剪贴板');
    });

    // Send Candle / Memorial Spark Handler
    document.getElementById('btn-send-candle')?.addEventListener('click', (e) => {
      triggerLuxuryCelebrationFireworks(e.currentTarget);
      showToast(`已为 @${user.screen_name} 点亮一盏赛博微光`);
    });

    // Mutation Timeline Lazy Loader
    const historyDetails = document.getElementById('drawer-history-details');
    const historyList = document.getElementById('drawer-history-list');
    let historyLoaded = false;

    historyDetails?.addEventListener('toggle', async () => {
      if (!historyDetails.open || historyLoaded) return;
      historyLoaded = true;

      try {
        const res = await fetch(`/api/history?id=${encodeURIComponent(user.id || '')}&screen_name=${encodeURIComponent(user.screen_name || '')}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          historyList.innerHTML = json.data.map(item => {
            const dateStr = item.changed_at ? new Date(item.changed_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '记录时间';
            let fieldLabel = '字段更新';
            if (item.field === 'name') fieldLabel = '博主昵称变迁';
            else if (item.field === 'avatar_url') fieldLabel = '头像变迁更新';
            else if (item.field === 'cover_url') fieldLabel = 'Banner 背景图更换';
            else if (item.field === 'description') fieldLabel = '个人简介 (Bio) 修改';
            else if (item.field === 'screen_name') fieldLabel = 'Handle @ID 更名';
            else if (item.field === 'is_suspended') fieldLabel = '账号状态异动 (封禁/注销)';

            return `
              <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-header">
                    <span class="timeline-type">${escapeHtml(fieldLabel)}</span>
                    <span class="timeline-date">${escapeHtml(dateStr)}</span>
                  </div>
                  <div class="timeline-diff">
                    ${item.old_value ? `<div class="diff-line diff-del"><span class="diff-tag">- 旧</span> ${escapeHtml(item.old_value)}</div>` : ''}
                    ${item.new_value ? `<div class="diff-line diff-add"><span class="diff-tag">+ 新</span> ${escapeHtml(item.new_value)}</div>` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('');
        } else {
          // If no history in D1 yet, show initial archive creation event
          const initialDate = user.backed_up_at ? new Date(user.backed_up_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '首次归档';
          historyList.innerHTML = `
            <div class="timeline-item">
              <div class="timeline-dot active"></div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <span class="timeline-type">创世归档入库</span>
                  <span class="timeline-date">${escapeHtml(initialDate)}</span>
                </div>
                <div class="timeline-desc">博主档案首次被收录至 X-符离集，媒体资产与档案快照已永久冷固化。</div>
              </div>
            </div>
            <div class="timeline-empty-hint">暂无后续改名或头像更迭记录（同步引擎将在博主资料变更时自动捕获快照）</div>
          `;
        }
      } catch (e) {
        const initialDate = user.backed_up_at ? new Date(user.backed_up_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '首次归档';
        const daysAgo = user.backed_up_at ? Math.max(1, Math.floor((Date.now() - new Date(user.backed_up_at).getTime()) / (1000 * 3600 * 24))) : 1;
        historyList.innerHTML = `
          <div class="timeline-item">
            <div class="timeline-dot active"></div>
            <div class="timeline-content">
              <div class="timeline-header">
                <span class="timeline-type">创世归档入库</span>
                <span class="timeline-date">${escapeHtml(initialDate)}</span>
              </div>
              <div class="timeline-desc">博主档案已收录至精选画廊，已在安全归档库中留存 ${daysAgo} 天。媒体资产与资料快照已永久冷固化。</div>
            </div>
          </div>
          <div class="timeline-empty-hint">当前处于静态容灾模式，详细变迁履历档案将在服务配额重置后自动恢复。</div>
        `;
      }
    });

    inspectorBackdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeInspectorDrawer() {
    inspectorBackdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }

  drawerCloseBtn?.addEventListener('click', closeInspectorDrawer);
  inspectorBackdrop?.addEventListener('click', (e) => {
    if (e.target === inspectorBackdrop) closeInspectorDrawer();
  });

  // ==================== 11. Toast Notification System ====================
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `
      <span style="color: var(--cyan); display: flex; align-items: center;">${ICONS.verifiedNative}</span>
      <span>${escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 2400);
  }

  // ==================== 12. Utilities ====================
  /**
   * 纯文本 -> 安全 HTML：先转义，再把 http(s) 链接变成可点。
   *
   * 顺序不能反 —— 先转义保证任何 `<` 都成了 `&lt;`，之后 URL 正则匹配到的内容
   * 里已经不可能有能闭合属性的裸引号，所以拼进 href="" 是安全的。
   *
   * rel="noopener noreferrer" 是必须的：target="_blank" 打开的页面能拿到
   * window.opener 反向操作本页（tabnabbing），且会带上 Referer。
   * 原来这里漏了。
   *
   * @param stopPropagation 卡片里用 true（点链接不该触发卡片自身的点击）；
   *                        公告横幅等没有父级点击处理的地方用 false ——
   *                        少一个内联事件处理器就少一处注入面。
   */
  function linkifyText(text, { stopPropagation = false } = {}) {
    const safe = escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const onclick = stopPropagation ? ' onclick="event.stopPropagation();"' : '';
    return safe.replace(urlRegex, (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer"${onclick}>${url} ↗</a>`);
  }

  function formatBioWithLinks(text) {
    if (!text) return '暂无个人简介';
    return linkifyText(text, { stopPropagation: true });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  // ==================== 13. Global Keyboard Shortcuts ====================
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== globalSearch) {
      e.preventDefault();
      globalSearch.focus();
    }
    if (e.key === 'Escape') {
      if (!rouletteBackdrop.classList.contains('hidden')) {
        closeRouletteModal();
      } else if (!inspectorBackdrop.classList.contains('hidden')) {
        closeInspectorDrawer();
      } else if (document.activeElement === globalSearch) {
        globalSearch.blur();
      }
    }
    if ((e.key === 'r' || e.key === 'R') && document.activeElement !== globalSearch) {
      e.preventDefault();
      startRandomRouletteShuffle();
    }
    if (document.activeElement !== globalSearch) {
      if (e.key === '1') document.querySelector('[data-view="grid"]')?.click();
      if (e.key === '2') document.querySelector('[data-view="compact"]')?.click();
      if (e.key === '3') document.querySelector('[data-view="list"]')?.click();
      if (e.key === 't' || e.key === 'T') {
        const nextTheme = state.currentTheme === 'oled' ? 'light' : 'oled';
        applyTheme(nextTheme);
        showToast(`已切换至 ${nextTheme === 'light' ? '清爽浅色' : '纯黑极简 (OLED)'} 模式`);
      }
    }
  });

  // Start initialization
  //
  // 按 URL 决定初始视图：直接打开 /my 或 /favorites 时不能先渲染一遍公开画廊
  // 再切过去 —— 那样会闪一屏别人的数据。
  // 但 /my /favorites 需要登录态才知道要不要拉数据，所以真正的装载在
  // loadSession() 里做（见那边的 pendingInitialView）。
  state.viewMode = resolveViewFromUrl();
  // applyViewChrome 两条分支都要调 —— 只在非 all 分支调的话，
  // 首页上「画廊」那个按钮不会被高亮（三个按钮全是灰的，看不出当前在哪）
  applyViewChrome();
  if (state.viewMode === 'all') initArchiveData();


  // ==================== 公开投稿（新增功能，非原站） ====================
  // 无审核：服务端自动校验存在性 + 去重 + 抓资料入库。
  // 限流在服务端（每 IP 每小时 5 次 / 每天 20 次），这里只做基本格式预检。
  const submitForm = document.getElementById('submit-form');
  const submitHandleInput = document.getElementById('submit-handle');
  const btnSubmitBlogger = document.getElementById('btn-submit-blogger');
  const submitResult = document.getElementById('submit-result');

  function showSubmitResult(status, message, blogger) {
    if (!submitResult) return;
    submitResult.className = `submit-result is-${status}`;
    const avatar = blogger?.avatar_url
      ? `<img class="submit-result-avatar" src="${escapeHtml(blogger.avatar_url)}" alt="" onerror="this.style.display='none'">`
      : '';
    submitResult.innerHTML = `${avatar}<span>${escapeHtml(message)}</span>`;
    submitResult.classList.remove('hidden');
  }

  submitForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = (submitHandleInput?.value || '').trim();
    if (!raw) return;

    // 宽松预检：真正的校验在服务端，这里只挡明显的垃圾输入
    const guess = raw
      .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(guess)) {
      showSubmitResult('error', 'handle 格式不对：只能是字母、数字、下划线，最长 15 位');
      return;
    }

    btnSubmitBlogger.disabled = true;
    const label = btnSubmitBlogger.querySelector('span');
    const original = label ? label.textContent : '';
    if (label) label.textContent = '正在核实...';
    showSubmitResult('pending', `正在向 X 核实 @${guess} 并抓取资料...`);

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⚠️ visibility 曾经**根本没带上**：页面上那两个单选按钮
        // （公开 / 仅自己可见）完全是死的，服务端一律按默认的 public 处理。
        // 选「公开」时正好撞对，选「仅自己可见」会被静默公开出去 —— 属于隐私问题。
        // 未登录时不带该字段：匿名投稿在服务端一律公开，带了也会被忽略。
        body: JSON.stringify({
          screen_name: raw,
          ...(currentUser ? {
            visibility: document.querySelector('input[name="submit-vis"]:checked')?.value === 'private'
              ? 'private' : 'public',
          } : {}),
        })
      });
      const json = await res.json();

      if (json.success) {
        showSubmitResult(json.status || 'accepted', json.message, json.blogger);
        if (json.status === 'accepted' || json.status === 'duplicate') {
          submitHandleInput.value = '';
          showToast(json.message);
          // force=true 绕过 /api/archive 的 60s 边缘缓存 ——
          // 刚提交的人必须立刻在画廊里看到自己加的那位，否则会以为没成功
          await initArchiveData({ force: true });
          // 「我的收录」计数也变了（登录用户投稿会归到自己名下）
          if (currentUser) await loadSession();
        }
      } else {
        showSubmitResult('error', json.error || '提交失败，请稍后再试');
      }
    } catch (err) {
      showSubmitResult('error', '网络异常，请稍后再试');
    } finally {
      btnSubmitBlogger.disabled = false;
      if (label) label.textContent = original;
    }
  });


  // ==================== 账号系统（新增功能，非原站） ====================
  // 参考 /home/fcs/stylekit 的身份绑定模式。会话走 HttpOnly Cookie，
  // 前端不持有令牌 —— 所以这里没有任何 localStorage 存凭据的代码。
  let currentUser = null;
  let myFavoriteIds = new Set();

  const authBackdrop = document.getElementById('auth-backdrop');
  const authMsg = document.getElementById('auth-msg');
  const userMenuWrap = document.getElementById('user-menu-wrap');
  const userDropdown = document.getElementById('user-dropdown');
  const btnOpenAuth = document.getElementById('btn-open-auth');
  const submitVisibility = document.getElementById('submit-visibility');
  const userpanelBackdrop = document.getElementById('userpanel-backdrop');
  const userpanelBody = document.getElementById('userpanel-body');
  const userpanelTitle = document.getElementById('userpanel-title');

  function setAuthMsg(kind, text) {
    if (!authMsg) return;
    authMsg.className = `auth-msg is-${kind}`;
    authMsg.textContent = text;
    authMsg.classList.remove('hidden');
  }

  /** 登录态变化后统一刷新 UI */
  function applyUserState() {
    const logged = !!currentUser;
    btnOpenAuth?.classList.toggle('hidden', logged);
    userMenuWrap?.classList.toggle('hidden', !logged);
    submitVisibility?.classList.toggle('hidden', !logged);

    if (logged) {
      const name = currentUser.display_name || currentUser.email;
      // OAuth 带回了真头像就用图，没有再回落到首字母
      const avaEl = document.getElementById('user-avatar-initial');
      if (currentUser.avatar_url) {
        avaEl.textContent = '';
        avaEl.style.cssText = `background-image:url("${currentUser.avatar_url}");background-size:cover;background-position:center`;
      } else {
        avaEl.style.cssText = '';
        avaEl.textContent = (name[0] || 'U').toUpperCase();
      }
      document.getElementById('user-chip-name').textContent = name;
      document.getElementById('user-dd-name').textContent = name;
      document.getElementById('user-dd-email').textContent = currentUser.email;
      document.getElementById('dd-count-owned').textContent = currentUser.owned ?? 0;
      document.getElementById('dd-count-fav').textContent = currentUser.favorites ?? 0;
    }
    // 卡片上的收藏按钮随登录态显隐
    applyFilterAndSort();
  }

  // 首屏是否还没装载过数据（直接打开 /my 或 /favorites 的情形）
  let initialViewPending = resolveViewFromUrl() !== 'all';

  async function loadSession() {
    try {
      const res = await fetch('/api/auth/me');
      const json = await res.json();
      currentUser = json.user || null;
      if (currentUser) await loadFavoriteIds();
    } catch { currentUser = null; }
    applyUserState();

    // 头部的三个视图入口只对登录用户有意义
    document.getElementById('view-switch')?.classList.toggle('hidden', !currentUser);
    if (currentUser) {
      document.getElementById('vs-count-mine').textContent = currentUser.owned ?? 0;
      document.getElementById('vs-count-fav').textContent = currentUser.favorites ?? 0;
    }

    // 直接打开 /my 或 /favorites：等拿到登录态才知道该拉数据还是弹登录框
    if (initialViewPending) {
      initialViewPending = false;
      if (currentUser) {
        await loadViewData();
      } else {
        state.rawUsers = [];
        applyFilterAndSort();
        btnOpenAuth?.click();
      }
    } else if (state.viewMode !== 'all' && currentUser) {
      // 在"我的"视图里登录/退出后，数据要跟着变
      await loadViewData();
    }
  }

  async function loadFavoriteIds() {
    try {
      const res = await fetch('/api/favorites');
      if (!res.ok) return;
      const json = await res.json();
      myFavoriteIds = new Set((json.data || []).map(r => r.id));
    } catch { /* 忽略 */ }
  }

  btnOpenAuth?.addEventListener('click', () => {
    authMsg?.classList.add('hidden');
    authBackdrop?.classList.remove('hidden');
    loadProviders();
    setTimeout(() => document.getElementById('oauth-github')?.focus(), 60);
  });
  document.getElementById('auth-close')?.addEventListener('click', () => authBackdrop?.classList.add('hidden'));
  authBackdrop?.addEventListener('click', (e) => { if (e.target === authBackdrop) authBackdrop.classList.add('hidden'); });

  /**
   * 登录方式探测。
   *
   * 不探测的话，站长还没配 client id 时用户点下去会跳到一个 503 页面 ——
   * 看起来像整站挂了。这里提前把按钮置灰并说清原因。
   */
  let providerInfo = null;
  async function loadProviders() {
    if (providerInfo) return providerInfo;
    try {
      const res = await fetch('/api/auth/providers');
      providerInfo = await res.json();
    } catch { providerInfo = null; }

    (providerInfo?.providers || []).forEach(p => {
      const el = document.getElementById(`oauth-${p.id}`);
      if (!el) return;
      el.classList.toggle('is-disabled', !p.ready);
      if (!p.ready) {
        el.setAttribute('aria-disabled', 'true');
        el.title = `站长尚未配置 ${p.label} 登录`;
      } else {
        el.removeAttribute('aria-disabled');
        el.removeAttribute('title');
      }
    });

    const ready = (providerInfo?.providers || []).filter(p => p.ready);
    if (!ready.length) {
      setAuthMsg('err', '两种登录方式都还没配置好，请联系站长。');
    } else if (providerInfo?.restricted) {
      setAuthMsg('warn', '本站目前只对指定账号开放，不在名单内会登录失败。');
    }
    return providerInfo;
  }

  // 未配置的方式点了不跳走；登录完回到当前页面而不是永远回首页
  document.querySelectorAll('.oauth-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.classList.contains('is-disabled')) {
        e.preventDefault();
        setAuthMsg('err', btn.title || '该登录方式尚未配置');
        return;
      }
      const back = location.pathname + location.search;
      btn.href = `/api/auth/oauth/${btn.dataset.provider}?redirect_to=${encodeURIComponent(back)}`;
      btn.querySelector('span').textContent = '正在跳转…';
    });
  });

  document.getElementById('btn-user-chip')?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => userDropdown?.classList.add('hidden'));

  document.getElementById('btn-user-logout')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    currentUser = null;
    myFavoriteIds = new Set();
    state.myTags = [];
    state.tagsLoaded = false;
    userDropdown?.classList.add('hidden');
    document.getElementById('view-switch')?.classList.add('hidden');
    showToast('已退出登录');
    applyUserState();
    // 在"我的"视图退出登录后，页面上的数据已经不该给这个人看了 -> 回公开画廊
    if (state.viewMode !== 'all') await switchView('all');
  });


  // ── 用户面板：我的收录 / 我的收藏 / X 凭据与同步 ──────────────
  document.querySelectorAll('.user-dd-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      userDropdown?.classList.add('hidden');
      const v = item.getAttribute('data-view');
      // 收录/收藏现在是独立页面（/my、/favorites），不再用侧栏 ——
      // 独立页面能白拿画廊的搜索、排序、视图切换、瀑布流和详情抽屉。
      // X 凭据与同步仍留在侧栏：它是设置类界面，不是列表。
      if (v === 'mine') { switchView('mine'); return; }
      if (v === 'favorites') { switchView('fav'); return; }
      openUserPanel(v);
    });
  });
  document.getElementById('userpanel-close')?.addEventListener('click', () => userpanelBackdrop?.classList.add('hidden'));
  userpanelBackdrop?.addEventListener('click', (e) => { if (e.target === userpanelBackdrop) userpanelBackdrop.classList.add('hidden'); });

  /** 侧栏现在只承载「X 凭据与同步」——列表类视图都走独立页面了 */
  async function openUserPanel(view) {
    if (!currentUser) return;
    if (view !== 'xsync') { switchView(view === 'favorites' ? 'fav' : 'mine'); return; }
    userpanelBackdrop.classList.remove('hidden');
    userpanelTitle.textContent = 'X 凭据与同步';
    userpanelBody.innerHTML = '<div class="up-loading">载入中...</div>';
    await renderXSync();
  }

  // 注：这里原来有 upRow / renderMine / renderFavorites 三个函数，用于把
  // 「我的收录 / 我的收藏」渲染进侧栏。**已删除** —— 那两个视图现在是独立页面
  // （/my、/favorites），走画廊卡片渲染器，功能是那份侧栏实现的超集
  // （搜索、排序、三种视图、瀑布流、无限滚动、详情抽屉、标签、可见性开关）。
  //
  // 为什么要删而不是留着：这类"不可达但看起来还在用"的重复实现正是上一个 bug 的来源
  // —— 侧栏版本里调用了 admin.js 才有的 formatFollowersCount，静态检查发现不了，
  // 而它所在的函数体只在打开侧栏时才执行，测试也覆盖不到。
  // 侧栏现在只剩「X 凭据与同步」一个设置类界面。

  async function renderXSync() {
    const res = await fetch('/api/user/x-credentials');
    const json = await res.json();
    const has = !!json.has_credentials;

    userpanelBody.innerHTML = `
      <div class="up-warn">
        <strong>先读这段再决定要不要填。</strong>
        <ul>
          <li><code>ct0</code> 和 <code>auth_token</code> 等同你 X 账号的<strong>完全控制权</strong> —— 能发推、读私信、改资料。</li>
          <li>本站会把它们加密后存在服务器上（AES-GCM，密钥不在数据库里），<strong>永不回传给浏览器</strong>。但站长在技术上仍可解密。</li>
          <li>X 官方视 Cookie 自动化为违反 ToS，你的账号<strong>有被限制的风险</strong>。</li>
          <li>只用于抓取<strong>你自己的关注列表</strong>，遵守速率限制。随时可以清除。</li>
        </ul>
      </div>

      <div class="up-section">
        <div class="up-section-title">X 凭据</div>
        ${has ? `
          <div class="up-cred-ok">
            已连接 <strong>@${escapeHtml(json.x_handle || '')}</strong>
            <button class="up-btn is-danger" id="btn-clear-xcred">清除凭据</button>
          </div>
        ` : `
          <div class="up-guide">登录 <a href="https://x.com" target="_blank" rel="noopener">x.com</a> 后按 <code>F12</code> → Application → Cookies，复制 <code>ct0</code> 与 <code>auth_token</code>。</div>
          <label class="up-label">ct0 (CSRF Token)</label>
          <input type="text" id="up-ct0" class="up-input" autocomplete="off" spellcheck="false">
          <label class="up-label">auth_token</label>
          <input type="password" id="up-authtoken" class="up-input" autocomplete="off">
          <button class="up-btn is-primary" id="btn-save-xcred">验证并保存</button>
        `}
        <div class="up-msg hidden" id="up-cred-msg"></div>
      </div>

      <div class="up-section ${has ? '' : 'is-disabled'}">
        <div class="up-section-title">关注列表增量同步</div>
        <div class="up-guide">
          按关注时间倒序抓取，连续遇到 3 位已在你收录中的博主即自动停止 ——
          所以日常同步只花一两个请求。单次上限 120 位。
        </div>
        <div class="up-vis-pick">
          <span>抓到的博主收录为</span>
          <label><input type="radio" name="sync-vis" value="public"> 公开</label>
          <label><input type="radio" name="sync-vis" value="private" checked> 仅自己可见</label>
        </div>
        <div class="up-sync-actions">
          <button class="up-btn is-primary" id="btn-user-sync" data-mode="incremental" ${has ? '' : 'disabled'}>增量同步</button>
          <button class="up-btn" id="btn-user-sync-full" data-mode="full" ${has ? '' : 'disabled'}>完整核对</button>
          <button class="up-btn hidden" id="btn-user-sync-stop">停止</button>
        </div>
        <p class="up-note">
          <strong>增量同步</strong>：只找最新的新关注，连续遇到 3 位已收录就停。日常用，几秒钟。<br>
          <strong>完整核对</strong>：走完整个关注列表，已收录的快速跳过。<b>第一次同步没跑完、或想把更早的关注补回来时用这个。</b><br>
          两者都是分批跑的，断点存在服务端 —— 中途停下或关掉页面都不白跑，下次点会从上次的位置继续。
        </p>
        <div class="up-sync-progress hidden" id="up-sync-progress">
          <div class="up-progress-track"><div class="up-progress-fill" id="up-progress-fill"></div></div>
          <div class="up-sync-stat" id="up-sync-stat"></div>
        </div>
        <pre class="up-log hidden" id="up-sync-log"></pre>
      </div>
    `;

    document.getElementById('btn-save-xcred')?.addEventListener('click', async () => {
      const ct0 = document.getElementById('up-ct0').value.trim();
      const authToken = document.getElementById('up-authtoken').value.trim();
      const msg = document.getElementById('up-cred-msg');
      if (!ct0 || !authToken) { msg.className = 'up-msg is-err'; msg.textContent = '请填写完整'; msg.classList.remove('hidden'); return; }
      const btn = document.getElementById('btn-save-xcred');
      btn.disabled = true; btn.textContent = '正在验证...';
      const r = await fetch('/api/user/x-credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ct0, authToken }),
      }).then(x => x.json()).catch(() => ({ error: '网络异常' }));
      if (r.success) { showToast(`已连接 X 账号 @${r.x_handle}`); await renderXSync(); await loadSession(); }
      else { msg.className = 'up-msg is-err'; msg.textContent = r.error || '验证失败'; msg.classList.remove('hidden'); btn.disabled = false; btn.textContent = '验证并保存'; }
    });

    document.getElementById('btn-clear-xcred')?.addEventListener('click', async () => {
      if (!confirm('清除已保存的 X 凭据？清除后无法再同步关注列表。')) return;
      await fetch('/api/user/x-credentials', { method: 'DELETE' }).catch(() => {});
      showToast('X 凭据已清除');
      await renderXSync(); await loadSession();
    });

    // 同步是**分批**跑的，前端循环调用直到服务端说 done。
    //
    // 为什么要分批：Cloudflare Free 每次 Worker 调用只有 50 次 D1 查询额度，
    // 而同步每位博主约 8 次 —— 一次调用最多处理 5-6 位。所以由前端把
    // "同步 400 位" 拆成 80 次请求，服务端每次从上次的断点继续。
    //
    // 断点在服务端（user_sync_state.cursor），所以中途关页面也不会白跑，
    // 下次点「开始」会接着上次的位置。
    let syncAbort = false;

    async function runUserSync(mode) {
      const btn = document.getElementById(mode === 'full' ? 'btn-user-sync-full' : 'btn-user-sync');
      const other = document.getElementById(mode === 'full' ? 'btn-user-sync' : 'btn-user-sync-full');
      const btnStop = document.getElementById('btn-user-sync-stop');
      // 兜底值取 private：读不到选择时宁可少公开，也不要把人家的关注列表默认公开出去
      const vis = userpanelBody.querySelector('input[name="sync-vis"]:checked')?.value || 'private';
      const prog = document.getElementById('up-sync-progress');
      const fill = document.getElementById('up-progress-fill');
      const stat = document.getElementById('up-sync-stat');
      const logEl = document.getElementById('up-sync-log');

      syncAbort = false;
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '同步中...';
      if (other) other.disabled = true;
      btnStop?.classList.remove('hidden');
      prog.classList.remove('hidden'); logEl.classList.remove('hidden');
      logEl.textContent = mode === 'full'
        ? '> 完整核对：走完整个关注列表，已收录的会被跳过...\n'
        : '> 增量同步：只找最新的新关注...\n';
      stat.textContent = '请求中';

      let round = 0, totalNew = 0, totalScanned = 0, totalSkipped = 0, owned = 0, lastErr = null;
      // 轮数上限：防止服务端一直回 has_more 导致无限循环。
      // 每批查询预算 42：全是已收录时一批扫约 40 位，全是新的时一批约 5 位。
      // 300 批 -> 最坏 1500 位新关注 / 最好 12000 位扫描量，够用；到顶会提示再点继续。
      const MAX_ROUNDS = 300;

      try {
        while (round < MAX_ROUNDS) {
          if (syncAbort) { logEl.textContent += '\n[STOP] 已按你的要求停止。断点已保存，再点「开始」会从这里继续。\n'; break; }
          round++;

          const r = await fetch('/api/user/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            // queryBudget 42 是照 Cloudflare Free 的 50 次查询/调用算的
            body: JSON.stringify({ visibility: vis, mode, queryBudget: 42, restart: round === 1 && mode === 'full' }),
          }).then(x => x.json());

          if (!r.success) { lastErr = r.error; break; }

          // 第一轮把服务端日志全打出来（含 queryId 发现、翻页等），
          // 之后只打关键行，否则 80 轮的日志会把面板刷爆
          (r.logs || []).forEach((l) => {
            if (round === 1 || /^\[(NEW|WARN|CHECK|DONE|ERROR|POLICY|RESUME)/.test(l)) {
              logEl.textContent += l + '\n';
            }
          });

          totalNew += r.new_count || 0;
          totalScanned = r.pass_scanned ?? totalScanned;
          totalSkipped += r.skipped || 0;
          owned = r.total_owned ?? owned;

          // 没有总数可算百分比（X 不在这个接口回关注总数），
          // 用"已扫描位数"驱动一个渐进条：越扫越接近 95%，完成才到 100%
          fill.style.width = `${Math.min(95, 8 + totalScanned * 0.25)}%`;
          stat.textContent = `已扫描 ${totalScanned} 位 · 新增 ${totalNew} · 跳过 ${totalSkipped} · 收录共 ${owned}`;
          logEl.scrollTop = logEl.scrollHeight;

          if (r.done) {
            fill.style.width = '100%';
            logEl.textContent += r.is_incremental_stop
              ? `\n[SUCCESS] 增量核对完成：已追平最新关注。本次新增 ${totalNew} 位（收录共 ${owned} 位）\n`
              : `\n[SUCCESS] 关注列表已完整走完一遍：扫描 ${totalScanned} 位，新增 ${totalNew} 位，跳过 ${totalSkipped} 位已收录（收录共 ${owned} 位）\n`;
            break;
          }
          if (round >= MAX_ROUNDS) {
            logEl.textContent += `\n[WARN] 已连续跑 ${MAX_ROUNDS} 轮仍未走完，先停下。断点已保存，再点「开始」继续。\n`;
          }
        }

        if (lastErr) {
          logEl.textContent += `\n[ERROR] ${lastErr}\n`;
          stat.textContent = '同步失败';
          showToast(`同步失败: ${lastErr}`);
        } else if (!syncAbort) {
          showToast(totalNew ? `同步完成，新增 ${totalNew} 位` : '同步完成，没有新增');
        }
        await loadSession();
        await initArchiveData();
      } catch (err) {
        logEl.textContent += `\n[ERROR] ${err.message}\n`;
        showToast('网络异常');
      }
      logEl.scrollTop = logEl.scrollHeight;
      btnStop?.classList.add('hidden');
      btn.disabled = false; btn.textContent = label;
      if (other) other.disabled = false;
    }

    document.getElementById('btn-user-sync')?.addEventListener('click', () => runUserSync('incremental'));
    document.getElementById('btn-user-sync-full')?.addEventListener('click', () => runUserSync('full'));

    document.getElementById('btn-user-sync-stop')?.addEventListener('click', () => {
      syncAbort = true;
      const b = document.getElementById('btn-user-sync-stop');
      b.disabled = true; b.textContent = '正在收尾...';
      setTimeout(() => { b.disabled = false; b.textContent = '停止'; }, 3000);
    });
  }

  // ── 站点公告 ────────────────────────────────────────────────
  //
  // 只有管理台能发。这里只负责读和渲染。
  //
  // ⚠️ 正文一律走 escapeHtml + 自动链接化（复用 formatBioWithLinks 的做法），
  // 绝不 innerHTML 原样插入 —— 公告显示在每个访客页面上，
  // 如果允许 HTML，管理台会话一旦被劫就是覆盖全站的存储型 XSS。
  //
  // 关闭状态存 localStorage，key 里带 updated_at：管理员改了内容就会重新显示，
  // 只用 id 的话改了正文也提醒不到已经关过的人。
  const ANN_DISMISS_KEY = 'x_archive_ann_dismissed';
  // 「已读」与「横幅已关闭」是**两个独立状态**，必须分开存。
  //
  // 置顶公告的横幅按要求每次刷新都要重新出现（annPinnedClosedThisPage 只记本页），
  // 所以不能拿 dismissed 当已读依据 —— 否则置顶公告永远算未读，红点永远消不掉。
  // 反过来也不行：把置顶公告标成已读之后横幅还得照常出现。
  //
  // 于是：dismissed 管「横幅还要不要显示」，read 管「铃铛红点还要不要亮」。
  // 两者都带 updated_at，管理员改了内容就重新变成未读 / 重新显示。
  const ANN_READ_KEY = 'x_archive_ann_read';

  const annSig = (a) => `${a.id}:${a.updated_at}`;

  function readJsonArray(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function pushCapped(key, sig) {
    // 只留最近 50 条，否则这个 key 会无限长
    const list = [...new Set([...readJsonArray(key), sig])].slice(-50);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* 隐私模式忽略 */ }
  }

  const getDismissedAnns = () => readJsonArray(ANN_DISMISS_KEY);
  const dismissAnn = (sig) => pushCapped(ANN_DISMISS_KEY, sig);
  const getReadAnns = () => readJsonArray(ANN_READ_KEY);

  /** 把当前所有生效公告标记为已读（红点据此消失）。返回是否真的有变化。 */
  function markAllAnnsRead() {
    const read = getReadAnns();
    const unread = annAll.map(annSig).filter((s) => !read.includes(s));
    if (!unread.length) return false;
    const list = [...new Set([...read, ...unread])].slice(-50);
    try { localStorage.setItem(ANN_READ_KEY, JSON.stringify(list)); } catch { /* 隐私模式忽略 */ }
    return true;
  }

  const LEVEL_ICON = {
    info:   '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#info"/></svg>',
    warn:   '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#alert-triangle"/></svg>',
    urgent: '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><use href="/icons.svg#alert-circle"/></svg>',
  };
  const annLevel = (l) => (['info', 'warn', 'urgent'].includes(l) ? l : 'info');

  let annAll = [];        // 服务端返回的全部生效公告（公告中心用）
  let annBanner = [];     // 横幅要轮播的那些（已按规则过滤）
  let annIndex = 0;
  // 置顶公告在**本次页面停留期间**关掉的记录。只放内存、不落 localStorage ——
  // 见下面 loadAnnouncements 里的说明。
  const annPinnedClosedThisPage = new Set();

  async function loadAnnouncements() {
    try {
      const res = await fetch('/api/announcements');
      const json = await res.json();
      annAll = json.data || [];
    } catch { annAll = []; }

    const dismissed = getDismissedAnns();
    annBanner = annAll.filter((a) => {
      // ⚠️ 置顶公告**不受持久关闭影响**：每次刷新/重开都重新出现。
      // 站长的原话：「不管刷新还是重新打开都应该把置顶的公告重新显示」。
      // 关闭仍然有效，但只在本次页面停留期间 —— 让人能把它推开看下面的内容，
      // 而不是永久失去这条信息。
      if (a.pinned) return !annPinnedClosedThisPage.has(a.id);
      return !dismissed.includes(`${a.id}:${a.updated_at}`);
    });
    annIndex = 0;
    renderAnnBar();
    renderAnnBell();
  }

  /** 铃铛按钮：有生效公告就显示；有没读过的就点红点。
   *  ⚠️ 判据只看 ANN_READ_KEY，**不能看 pinned** —— 置顶公告永远存在，
   *  一旦把它算作恒定未读，红点就永远消不掉（原来就是这个 bug）。 */
  function renderAnnBell() {
    const btn = document.getElementById('btn-ann-center');
    const dot = document.getElementById('ann-bell-dot');
    if (!btn) return;
    btn.classList.toggle('hidden', annAll.length === 0);
    const read = getReadAnns();
    const unread = annAll.filter((a) => !read.includes(annSig(a))).length;
    dot?.classList.toggle('hidden', unread === 0);
    btn.title = annAll.length ? `站点公告（${annAll.length} 条${unread ? `，${unread} 条未读` : ''}）` : '站点公告';
  }

  function renderAnnBar() {
    const bar = document.getElementById('ann-bar');
    if (!bar) return;
    if (!annBanner.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }

    const a = annBanner[Math.min(annIndex, annBanner.length - 1)];
    const level = annLevel(a.level);
    const when = a.created_at
      ? new Date(a.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
      : '';

    bar.className = `ann-bar is-${level}`;
    bar.innerHTML = `
      <span class="ann-icon">${LEVEL_ICON[level]}</span>
      <div class="ann-content">
        ${a.pinned ? '<span class="ann-pin-tag">置顶</span>' : ''}
        ${a.title ? `<strong class="ann-title">${escapeHtml(a.title)}</strong>` : ''}
        <span class="ann-body">${linkifyText(a.body)}</span>
        ${when ? `<span class="ann-date">${when}</span>` : ''}
      </div>
      ${annBanner.length > 1 ? `
        <div class="ann-nav">
          <button class="ann-nav-btn" id="ann-prev" ${annIndex === 0 ? 'disabled' : ''} aria-label="上一条">‹</button>
          <span class="ann-count">${annIndex + 1}/${annBanner.length}</span>
          <button class="ann-nav-btn" id="ann-next" ${annIndex >= annBanner.length - 1 ? 'disabled' : ''} aria-label="下一条">›</button>
        </div>` : ''}
      <button class="ann-close" id="ann-close"
              title="${a.pinned ? '本次收起（置顶公告下次访问会再出现）' : '不再显示这条'}" aria-label="关闭公告">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#x-thin"/></svg>
      </button>`;
    bar.classList.remove('hidden');

    document.getElementById('ann-prev')?.addEventListener('click', () => { annIndex--; renderAnnBar(); });
    document.getElementById('ann-next')?.addEventListener('click', () => { annIndex++; renderAnnBar(); });
    document.getElementById('ann-close')?.addEventListener('click', () => {
      if (a.pinned) annPinnedClosedThisPage.add(a.id);   // 只记本页，刷新即复原
      else dismissAnn(annSig(a));
      // 在横幅上关掉 = 已经看过这条了，红点也该跟着算。置顶的同理 ——
      // 它的横幅下次还会出现，但"没读过"这件事已经不成立了。
      pushCapped(ANN_READ_KEY, annSig(a));
      annBanner = annBanner.filter((x) => x.id !== a.id);
      annIndex = 0;
      renderAnnBar();
      renderAnnBell();
    });
  }

  // ── 公告中心 ──
  // 关掉横幅之后必须还有地方能翻回来看，否则"关闭"等于永久失去这条信息。
  function renderAnnCenter() {
    const list = document.getElementById('anncenter-list');
    if (!list) return;
    if (!annAll.length) {
      list.innerHTML = '<p class="up-empty">当前没有公告。</p>';
      return;
    }
    const dismissed = getDismissedAnns();
    // 未读标记要在**标记已读之前**取，否则打开面板的同时就全变成已读了，
    // 用户看不出这次有哪几条是新的。
    const read = getReadAnns();
    list.innerHTML = annAll.map((a) => {
      const level = annLevel(a.level);
      const when = a.created_at
        ? new Date(a.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      const closed = !a.pinned && dismissed.includes(annSig(a));
      const isNew = !read.includes(annSig(a));
      return `
        <div class="anncenter-item is-${level}${isNew ? ' is-unread' : ''}">
          <div class="anncenter-head">
            <span class="ann-icon">${LEVEL_ICON[level]}</span>
            ${a.pinned ? '<span class="ann-pin-tag">置顶</span>' : ''}
            ${a.title ? `<strong>${escapeHtml(a.title)}</strong>` : ''}
            <span style="flex:1"></span>
            ${isNew ? '<span class="anncenter-new">未读</span>' : ''}
            ${closed ? '<span class="anncenter-closed">已收起</span>' : ''}
            <span class="ann-date">${when}</span>
          </div>
          <div class="ann-body">${linkifyText(a.body)}</div>
        </div>`;
    }).join('');
  }

  const annCenterBackdrop = document.getElementById('anncenter-backdrop');
  document.getElementById('btn-ann-center')?.addEventListener('click', () => {
    // 先渲染（此时还能读到旧的已读集合，未读条目带"未读"标记），再标记已读。
    // 顺序反了的话用户永远看不到哪几条是新的。
    renderAnnCenter();
    annCenterBackdrop?.classList.remove('hidden');
    // 点开公告中心 = 看过了 -> 红点消失。横幅的显示与否不受影响
    // （置顶公告下次刷新照样出现，那是 dismissed 管的事）。
    if (markAllAnnsRead()) renderAnnBell();
  });
  document.getElementById('anncenter-close')?.addEventListener('click', () => annCenterBackdrop?.classList.add('hidden'));
  annCenterBackdrop?.addEventListener('click', (e) => { if (e.target === annCenterBackdrop) annCenterBackdrop.classList.add('hidden'); });

  loadAnnouncements();

  // ── 标签 / 文件夹 ───────────────────────────────────────────
  //
  // 标签是每用户的私有标注，**收录与收藏共用同一套**：同一位博主可能既被你收录
  // 又被你收藏，两套标签就要给同一个人贴两次，还得记住"这标签属于哪一边"。
  const TAG_COLORS = ['violet', 'blue', 'cyan', 'green', 'amber', 'rose', 'slate'];

  async function loadMyTags(force = false) {
    if (state.tagsLoaded && !force) return state.myTags;
    try {
      const res = await fetch('/api/tags');
      if (!res.ok) { state.myTags = []; return state.myTags; }
      const json = await res.json();
      state.myTags = json.data || [];
      state.tagsLoaded = true;
    } catch { state.myTags = []; }
    return state.myTags;
  }

  function renderTagBar() {
    const bar = document.getElementById('tag-bar');
    if (!bar) return;
    const divider = bar.querySelector('.tag-bar-divider');
    // 清掉上一次注入的标签按钮（保留「全部」「未分类」「管理标签」）
    bar.querySelectorAll('.tag-chip[data-tag]:not([data-tag=""]):not([data-tag="__untagged"])')
       .forEach((el) => el.remove());

    // 计算每个标签在**当前视图**下的数量 —— 用全局 count 会和眼前的列表对不上
    const counts = {};
    let untagged = 0;
    state.rawUsers.forEach((u) => {
      const t = u.tag_ids || [];
      if (!t.length) untagged++;
      t.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    });

    const frag = document.createDocumentFragment();
    state.myTags.forEach((t) => {
      const b = document.createElement('button');
      b.className = `tag-chip tag-c-${TAG_COLORS.includes(t.color) ? t.color : 'violet'}`;
      b.dataset.tag = t.id;
      b.classList.toggle('active', state.currentTag === t.id);
      b.innerHTML = `<span>${escapeHtml(t.name)}</span><span class="tag-n">${counts[t.id] || 0}</span>`;
      frag.appendChild(b);
    });
    divider?.after(frag);

    bar.querySelector('[data-tag=""]')?.classList.toggle('active', !state.currentTag);
    const ut = bar.querySelector('[data-tag="__untagged"]');
    if (ut) {
      ut.classList.toggle('active', state.currentTag === '__untagged');
      ut.innerHTML = `<span>未分类</span><span class="tag-n">${untagged}</span>`;
    }
  }

  // 事件委托：标签按钮是动态注入的，逐个绑定会在重渲染后失效
  document.getElementById('tag-bar')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-chip');
    if (!chip || chip.id === 'btn-manage-tags') return;
    state.currentTag = chip.dataset.tag || '';
    renderTagBar();
    applyFilterAndSort();
  });

  // ── 「我的收录」：公开/私密 筛选 + 批量切换 ────────────────
  document.querySelector('#mine-tools .mine-vis-filter')?.addEventListener('click', (e) => {
    const b = e.target.closest('.tag-chip');
    if (!b) return;
    document.querySelectorAll('#mine-tools .mine-vis-filter .tag-chip')
      .forEach((x) => x.classList.toggle('active', x === b));
    state.visFilter = b.dataset.visf || '';
    applyFilterAndSort();
  });

  /**
   * 批量切换可见性。作用于**当前筛选结果**（标签 + 搜索 + 公开私密筛选都算），
   * 而不是无条件全库 —— 后者太容易误触，而且用户看到的和实际改的不一致。
   *
   * 只有在"全部都选中、没有任何筛选"时才走服务端的 scope:'all'（一条 UPDATE），
   * 否则按 handle 列表批量传（单次上限 500）。
   */
  async function bulkSetVisibility(visibility, btn) {
    const list = state.filteredUsers.filter((u) => (u.visibility || 'public') !== visibility);
    if (!list.length) { showToast(visibility === 'public' ? '当前列表里已经全是公开的了' : '当前列表里已经全是私密的了'); return; }

    const noFilter = !state.searchQuery && !state.currentTag && !state.visFilter && state.currentFilter === 'all';
    const word = visibility === 'public' ? '公开到画廊' : '设为仅自己可见';
    if (!confirm(`把 ${list.length} 位博主${word}？\n\n` +
      (noFilter ? '这是你收录的全部博主。\n' : '这是当前筛选结果，不是全部。\n') +
      (visibility === 'public' ? '公开后所有访客都能在首页看到他们。' : '设为私密后只有你自己看得见。'))) return;

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '处理中…';
    try {
      // 超过 500 条要分片 —— 服务端单次上限 500
      const CHUNK = 500;
      let changed = 0;
      if (noFilter && list.length > CHUNK) {
        const r = await fetch('/api/my-bloggers', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'all', visibility }),
        }).then((x) => x.json());
        if (!r.success) throw new Error(r.error);
        changed = r.changed;
      } else {
        for (let i = 0; i < list.length; i += CHUNK) {
          const r = await fetch('/api/my-bloggers', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ screen_names: list.slice(i, i + CHUNK).map((u) => u.screen_name), visibility }),
          }).then((x) => x.json());
          if (!r.success) throw new Error(r.error);
          changed += r.changed || 0;
        }
      }
      showToast(visibility === 'public' ? `已公开 ${changed} 位` : `已把 ${changed} 位设为仅自己可见`);
      localStorage.removeItem('x_archive_cached_data');
      await loadViewData();
    } catch (err) {
      showToast(`操作失败: ${err.message}`);
    }
    btn.disabled = false; btn.textContent = label;
  }

  document.getElementById('btn-bulk-public')?.addEventListener('click', (e) => bulkSetVisibility('public', e.currentTarget));
  document.getElementById('btn-bulk-private')?.addEventListener('click', (e) => bulkSetVisibility('private', e.currentTarget));

  /**
   * 批量取消收录：作用于**当前筛选结果**（标签 + 搜索 + 公开私密筛选都算），
   * 语义与上面的批量切换一致。走 DELETE /api/my-bloggers 的批量模式。
   *
   * 删除不可逆，所以服务端**刻意不支持 scope:'all'**（PATCH 那边"一次全部公开"
   * 可逆所以有）—— 这里也按 handle 列表分片发，不给"一键清空整个收录"的后门。
   */
  async function bulkUncollect(btn) {
    const list = state.filteredUsers.map((u) => u.screen_name);
    if (!list.length) { showToast('当前列表为空'); return; }

    const noFilter = !state.searchQuery && !state.currentTag && !state.visFilter && state.currentFilter === 'all';
    if (!confirm(
      `把 ${list.length} 位博主从你的收录中移除？\n\n` +
      (noFilter ? '这是你收录的全部博主。\n' : '这是当前筛选结果，不是全部。\n') +
      '· 公开仓和其他人的收录不受影响\n' +
      '· 若移除后没有任何人收录或收藏某位博主，那份归档数据会被一并回收，不可恢复'
    )) return;

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '处理中…';
    try {
      // 分片上限 10：每解除一条归属约 5 次 D1 查询（删指针/查收藏/清标签/计数/回收），
      // Free 档每次调用只有 ~50 次查询预算（见 sync 的 DEFAULT_QUERY_BUDGET 注释），
      // 500 一片会在半途被 Workers 掐断。10 × 5 = 50，贴着预算走。
      const CHUNK = 10;
      let released = 0, reclaimed = 0;
      for (let i = 0; i < list.length; i += CHUNK) {
        const r = await fetch('/api/my-bloggers', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screen_names: list.slice(i, i + CHUNK) }),
        }).then((x) => x.json());
        if (!r.success) throw new Error(r.error);
        released += r.released_count || 0;
        reclaimed += r.reclaimed_count || 0;
      }
      showToast(`已取消收录 ${released} 位` +
        (reclaimed ? `，其中 ${reclaimed} 位无人再引用、归档数据已回收` : ''));
      localStorage.removeItem('x_archive_cached_data');
      await loadViewData();  // 内部会重算副标题与标签栏
    } catch (err) {
      showToast(`操作失败: ${err.message}`);
    }
    btn.disabled = false; btn.textContent = label;
  }
  document.getElementById('btn-bulk-uncollect')?.addEventListener('click', (e) => bulkUncollect(e.currentTarget));

  // ── 标签管理弹窗 ──
  const tagmgrBackdrop = document.getElementById('tagmgr-backdrop');
  const tagpickBackdrop = document.getElementById('tagpick-backdrop');

  function renderColorPicker(container, selected = 'violet') {
    container.innerHTML = TAG_COLORS.map((c) => `
      <button type="button" class="tag-color tag-c-${c} ${c === selected ? 'active' : ''}"
              data-color="${c}" role="radio" aria-checked="${c === selected}" aria-label="${c}"></button>
    `).join('');
    container.onclick = (e) => {
      const b = e.target.closest('.tag-color');
      if (!b) return;
      container.querySelectorAll('.tag-color').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-checked', x === b ? 'true' : 'false');
      });
    };
  }
  const pickedColor = (container) => container.querySelector('.tag-color.active')?.dataset.color || 'violet';

  function setTagMsg(kind, text) {
    const el = document.getElementById('tagmgr-msg');
    if (!el) return;
    el.className = `auth-msg is-${kind}`;
    el.textContent = text;
    el.classList.remove('hidden');
    if (kind === 'ok') setTimeout(() => el.classList.add('hidden'), 2200);
  }

  async function renderTagManager() {
    await loadMyTags(true);
    const list = document.getElementById('tagmgr-list');
    if (!state.myTags.length) {
      list.innerHTML = '<p class="up-empty">还没有标签。上面输入名字就能建第一个。</p>';
      return;
    }
    list.innerHTML = state.myTags.map((t) => `
      <div class="tagmgr-row" data-id="${t.id}">
        <span class="tag-dot tag-c-${TAG_COLORS.includes(t.color) ? t.color : 'violet'}"></span>
        <input class="tagmgr-name" value="${escapeHtml(t.name)}" maxlength="24" aria-label="标签名">
        <span class="tagmgr-count">${t.count} 位</span>
        <button class="tagmgr-btn" data-act="save" title="保存改名">保存</button>
        <button class="tagmgr-btn is-danger" data-act="del" title="删除标签（不影响博主档案）">删除</button>
      </div>
    `).join('');
  }

  document.getElementById('btn-manage-tags')?.addEventListener('click', async () => {
    if (!currentUser) { btnOpenAuth?.click(); return; }
    document.getElementById('tagmgr-msg')?.classList.add('hidden');
    renderColorPicker(document.getElementById('new-tag-color'));
    await renderTagManager();
    tagmgrBackdrop?.classList.remove('hidden');
    setTimeout(() => document.getElementById('new-tag-name')?.focus(), 60);
  });
  document.getElementById('tagmgr-close')?.addEventListener('click', () => tagmgrBackdrop.classList.add('hidden'));
  tagmgrBackdrop?.addEventListener('click', (e) => { if (e.target === tagmgrBackdrop) tagmgrBackdrop.classList.add('hidden'); });

  document.getElementById('form-new-tag')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-tag-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      const r = await fetch('/api/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: pickedColor(document.getElementById('new-tag-color')) }),
      }).then((x) => x.json());
      if (r.success) {
        input.value = '';
        setTagMsg('ok', r.message);
        await renderTagManager();
        renderTagBar();
      } else setTagMsg('err', r.error);
    } catch { setTagMsg('err', '网络异常'); }
  });

  document.getElementById('tagmgr-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.tagmgr-btn');
    if (!btn) return;
    const row = btn.closest('.tagmgr-row');
    const id = row.dataset.id;
    const act = btn.dataset.act;

    if (act === 'del') {
      const t = state.myTags.find((x) => x.id === id);
      if (!confirm(`删除标签「${t?.name}」？\n\n${t?.count || 0} 位博主会失去这个标签，但**档案本身不受影响**。`)) return;
      const r = await fetch('/api/tags', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      }).then((x) => x.json());
      if (r.success) {
        setTagMsg('ok', r.message);
        if (state.currentTag === id) state.currentTag = '';
        await renderTagManager();
        await loadViewData();
      } else setTagMsg('err', r.error);
      return;
    }

    if (act === 'save') {
      const name = row.querySelector('.tagmgr-name').value.trim();
      if (!name) { setTagMsg('err', '标签名不能为空'); return; }
      const r = await fetch('/api/tags', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }),
      }).then((x) => x.json());
      if (r.success) { setTagMsg('ok', '已保存'); await renderTagManager(); renderTagBar(); }
      else setTagMsg('err', r.error);
    }
  });

  // ── 给单个博主贴标签 ──
  let tagpickTarget = null;

  window.__xvOpenTagPicker = async function (bloggerId, handle) {
    if (!currentUser) { btnOpenAuth?.click(); return; }
    tagpickTarget = bloggerId;
    await loadMyTags(true);
    const cur = new Set((state.rawUsers.find((u) => u.id === bloggerId)?.tag_ids) || []);
    document.getElementById('tagpick-title').textContent = `归入标签 · @${handle}`;
    const list = document.getElementById('tagpick-list');
    list.innerHTML = state.myTags.length
      ? state.myTags.map((t) => `
          <label class="tagpick-item">
            <input type="checkbox" value="${t.id}" ${cur.has(t.id) ? 'checked' : ''}>
            <span class="tag-dot tag-c-${TAG_COLORS.includes(t.color) ? t.color : 'violet'}"></span>
            <span class="tagpick-name">${escapeHtml(t.name)}</span>
            <span class="tagmgr-count">${t.count} 位</span>
          </label>`).join('')
      : '<p class="up-empty">还没有标签。点下面「管理标签」先建一个。</p>';
    tagpickBackdrop?.classList.remove('hidden');
  };

  document.getElementById('tagpick-close')?.addEventListener('click', () => tagpickBackdrop.classList.add('hidden'));
  tagpickBackdrop?.addEventListener('click', (e) => { if (e.target === tagpickBackdrop) tagpickBackdrop.classList.add('hidden'); });
  document.getElementById('tagpick-manage')?.addEventListener('click', () => {
    tagpickBackdrop.classList.add('hidden');
    document.getElementById('btn-manage-tags')?.click();
  });

  document.getElementById('tagpick-save')?.addEventListener('click', async () => {
    if (!tagpickTarget) return;
    const btn = document.getElementById('tagpick-save');
    const ids = [...document.querySelectorAll('#tagpick-list input[type=checkbox]:checked')].map((x) => x.value);
    btn.disabled = true; btn.textContent = '保存中...';
    try {
      // PUT 是"设置完整集合"：整集覆盖天然幂等，不会出现加成功但减失败的半途状态
      const r = await fetch('/api/tags', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogger_id: tagpickTarget, tag_ids: ids }),
      }).then((x) => x.json());
      if (r.success) {
        showToast(r.message);
        // 就地更新本地数据，避免整页重载丢掉滚动位置
        const u = state.rawUsers.find((x) => x.id === tagpickTarget);
        if (u) u.tag_ids = r.tag_ids || [];
        await loadMyTags(true);
        renderTagBar();
        applyFilterAndSort();
        tagpickBackdrop.classList.add('hidden');
      } else showToast(r.error);
    } catch { showToast('网络异常'); }
    btn.disabled = false; btn.textContent = '保存';
  });

  // ── 卡片收藏按钮 ────────────────────────────────────────────
  window.__xvToggleFavorite = async function (handle, btn) {
    if (!currentUser) { btnOpenAuth?.click(); return; }
    btn.disabled = true;
    const isFav = btn.classList.contains('is-fav');
    let r;
    try {
      r = await fetch('/api/favorites', {
        method: isFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen_name: handle }),
      }).then((x) => x.json());
    } catch {
      showToast('网络异常');
      btn.disabled = false;
      return;
    }

    if (!r?.success) {
      showToast(r?.error || '操作失败');
      btn.disabled = false;
      return;
    }

    showToast(r.message);
    const nowFav = !isFav;
    btn.classList.toggle('is-fav', nowFav);
    btn.title = nowFav ? '取消收藏' : '加入收藏';
    btn.setAttribute('aria-label', nowFav ? '取消收藏' : '加入收藏');

    if (currentUser) currentUser.favorites = r.count ?? currentUser.favorites;
    const n = r.count ?? currentUser?.favorites ?? 0;
    const dd = document.getElementById('dd-count-fav');
    const vs = document.getElementById('vs-count-fav');
    if (dd) dd.textContent = n;
    if (vs) vs.textContent = n;

    if (nowFav) {
      await loadFavoriteIds();
    } else {
      const row = state.rawUsers.find((x) => x.screen_name === handle);
      if (row) myFavoriteIds.delete(row.id);
    }

    // 取消收藏后：在收藏页必须摘卡；引用归零被回收时任意视图都要摘卡，
    // 否则抽屉会打开一条已经不存在的档案，公开画廊快照也会把幽灵留下来。
    if (!nowFav && (state.viewMode === 'fav' || r.reclaimed)) {
      state.rawUsers = state.rawUsers.filter((x) => x.screen_name !== handle);
      applyFilterAndSort();
      applyViewChrome();
    }
    if (r.reclaimed) localStorage.removeItem('x_archive_cached_data');
    btn.disabled = false;
  };

  // ── 回到顶部 ────────────────────────────────────────────────
  // 无限滚动把博主一路加载到底，页面会变得非常长。滚到下面之后想回搜索框或
  // 投稿框，只能反向滚同样的距离 —— 这个按钮解决的就是这个。
  const btnBackTop = document.getElementById('btn-back-top');
  if (btnBackTop) {
    let ticking = false;
    const syncBackTop = () => {
      btnBackTop.classList.toggle('hidden', window.scrollY < 800);
      ticking = false;
    };
    // 滚动事件用 rAF 节流：不节流的话每帧多次重排，长列表上很容易掉帧
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(syncBackTop); }
    }, { passive: true });
    btnBackTop.addEventListener('click', () => {
      // 尊重"减少动态效果"偏好：晕动症用户平滑滚动会不适
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
    syncBackTop();
  }

  loadSession();

});
