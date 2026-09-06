/**
 * X-符离集 (x-vault) — 管理控制台
 *
 * 会话门禁 · X 凭据 · 同步引擎（增量/完整核对，断点续跑）· 备份导出
 * 公告管理 · 投稿记录 · 可见性与回收（撤出公开仓 vs 彻底删除）
 */

document.addEventListener('DOMContentLoaded', () => {

  // ==================== 0. 同形标记的生成 ====================
  //
  // 这三处原本在 admin.html 里逐条手写：七个排序项、六张 KPI 卡、四个健康度胶囊，
  // 每条都是同一套结构换文案换图标，加起来近百行重复标记。
  // 移到这里按数据生成 —— 加一项只需在数组里加一行，结构只有一份。
  //
  // ⚠️ 生成出的 DOM 必须与原来逐字等价（class 顺序、id、data-val 都一样），
  //    style.css 与外观回归网都盯着这些。

  /** 图标引用点。粗细与颜色可继承，所以 symbol 只存几何，见 scripts/extract-icons.mjs */
  const icon = (name, size, extra = '') =>
    `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2"` +
    ` stroke-linecap="round" stroke-linejoin="round"${extra ? ' ' + extra : ''} aria-hidden="true">` +
    `<use href="/icons.svg#${name}"/></svg>`;

  const SORT_OPTIONS = [
    ['backed_up_at_desc', '最新归档优先'],
    ['backed_up_at_asc', '最早归档优先'],
    ['clicks_desc', '热度由高到低'],
    ['clicks_asc', '热度由低到高'],
    ['followers_desc', '粉丝量由高到低'],
    ['followers_asc', '粉丝量由低到高'],
    ['name_asc', '博主昵称 A-Z'],
  ];

  /** [id 后缀, 图标, 配色 class, 标签, 初值]。顺序即视觉顺序。 */
  const KPI_CARDS = [
    ['clicks', 'flame', 'icon-flame', '本站全场景点击跳转', '0', 'highlight-glow'],
    ['total', 'users', 'icon-blue', '归档博主总人数', '0'],
    ['followers', 'star', 'icon-gold', '全网总粉丝覆盖规模', '0'],
    ['active-creators', 'check-circle', 'icon-emerald', '受访互动博主数', '0'],
    ['verified-rate', 'badge-check', 'icon-cyan', 'X 官方认证比例', '0%'],
    ['r2-count', 'box', 'icon-purple', 'R2 高清图片冷备', '0'],
  ];

  /** [id 后缀, 状态 class, 圆点 class, 标题] */
  const HEALTH_PILLS = [
    ['active', 'active', 'dot-green', '正常展示中'],
    ['blocked', 'blocked', 'dot-red', '画廊已屏蔽'],
    ['suspended', 'suspended', 'dot-yellow', 'X 官方封号 / 注销'],
    ['verified', 'verified', 'dot-blue', 'X 蓝标认证创作者'],
  ];

  function buildStaticMarkup() {
    const sortMenu = document.getElementById('blogger-sort-menu');
    if (sortMenu) {
      sortMenu.innerHTML = SORT_OPTIONS.map(([val, label], i) =>
        `<div class="menu-item${i === 0 ? ' active' : ''}" data-val="${val}" role="option">` +
        `<span>${label}</span>` +
        `<svg class="check-icon${i === 0 ? '' : ' hidden'}" width="13" height="13" fill="none"` +
        ` stroke="currentColor" stroke-width="3" aria-hidden="true"><use href="/icons.svg#check"/></svg>` +
        `</div>`
      ).join('');
    }

    const kpiGrid = document.getElementById('analytics-kpi-grid');
    if (kpiGrid) {
      kpiGrid.innerHTML = KPI_CARDS.map(([key, ic, tone, label, init, extra]) =>
        `<div class="kpi-card${extra ? ' ' + extra : ''}">` +
        `<div class="kpi-icon-wrap ${tone}">${icon(ic, 20)}</div>` +
        `<div class="kpi-content">` +
        `<span class="kpi-value" id="kpi-val-${key}">${init}</span>` +
        `<span class="kpi-label">${label}</span>` +
        `</div></div>`
      ).join('');
    }

    const healthCol = document.getElementById('health-cards-col');
    if (healthCol) {
      healthCol.innerHTML = HEALTH_PILLS.map(([key, tone, dot, title]) =>
        `<div class="health-stat-pill ${tone}">` +
        `<div class="pill-indicator ${dot}"></div>` +
        `<div class="pill-text">` +
        `<span class="pill-title">${title}</span>` +
        `<span class="pill-val" id="health-val-${key}">0 人</span>` +
        `</div></div>`
      ).join('');
    }
  }

  // 必须在下面那些 getElementById 之前跑完 —— 它们要拿的元素就是这里生成的
  buildStaticMarkup();

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
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
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
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - dist / 100) * 0.1})`;
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

  // ==================== 2. DOM Elements ====================
  const authGateScreen = document.getElementById('auth-gate-screen');
  const authCardBox = document.getElementById('auth-card-box');
  const adminDashboardScreen = document.getElementById('admin-dashboard-screen');
  const adminLoginForm = document.getElementById('admin-login-form');
  const loginUser = document.getElementById('login-user');
  const loginPass = document.getElementById('login-pass');
  const loginErrorMsg = document.getElementById('login-error-msg');
  const btnSubmitLogin = document.getElementById('btn-submit-login');
  const btnAdminLogout = document.getElementById('btn-admin-logout');

  // X Account Card & Form & Loading Skeleton
  const credLoadingSkeleton = document.getElementById('cred-loading-skeleton');
  const xCookieAccountBox = document.getElementById('x-cookie-account-box');
  const xAccountAvatar = document.getElementById('x-account-avatar');
  const xAccountName = document.getElementById('x-account-name');
  const xAccountHandle = document.getElementById('x-account-handle');
  const btnLogoutXAccount = document.getElementById('btn-logout-x-account');

  const cookieFormWrapper = document.getElementById('cookie-form-wrapper');
  const inputCt0 = document.getElementById('input-ct0');
  const inputAuthToken = document.getElementById('input-auth-token');
  const credStatusIndicator = document.getElementById('cred-status-indicator');
  const credStatusText = document.getElementById('cred-status-text');
  const btnClearCred = document.getElementById('btn-clear-cred');
  const btnSaveCred = document.getElementById('btn-save-cred');
  const credFormMsg = document.getElementById('cred-form-msg');

  // Sync Engine
  const btnTriggerSync = document.getElementById('btn-trigger-sync');
  const btnStopSync = document.getElementById('btn-stop-sync');
  const btnTriggerSyncFull = document.getElementById('btn-trigger-sync-full');
  const syncProgressStatusText = document.getElementById('sync-progress-status-text');
  const syncProgressCountText = document.getElementById('sync-progress-count-text');
  const syncProgressFill = document.getElementById('sync-progress-fill');
  const terminalLogOutput = document.getElementById('terminal-log-output');

  // GitHub Actions & Cloud Tasks
  const btnTriggerGhFullSync = document.getElementById('btn-trigger-gh-full-sync');

  // Backup & Restore
  const btnExportJson = document.getElementById('btn-export-json');
  const btnImportJson = document.getElementById('btn-import-json');
  const btnResetD1 = document.getElementById('btn-reset-d1');
  const fileInputBackup = document.getElementById('file-input-backup');
  const toastContainer = document.getElementById('toast-container');

  // Top HUD Ribbon Elements
  const hudValCred = document.getElementById('hud-val-cred');
  const hudDotCred = document.getElementById('hud-dot-cred');
  const hudValCount = document.getElementById('hud-val-count');
  const hudR2Status = document.getElementById('hud-r2-status');
  const hudD1Latency = document.getElementById('hud-d1-latency');

  // Top Tabs Elements
  const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
  const adminTabPanes = document.querySelectorAll('.admin-tab-pane');
  const tabNavBloggerBadge = document.getElementById('tab-nav-blogger-badge');

  let adminSessionToken = localStorage.getItem('x_archive_admin_token') || '';
  let syncPollingInterval = null;
  let currentActiveTab = 'overview';

  // ==================== 2.5 Admin Tabs Manager ====================
  function switchAdminTab(tabName, updateHash = true) {
    if (!tabName) tabName = 'overview';
    currentActiveTab = tabName;

    adminTabBtns.forEach(btn => {
      const match = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', String(match));
    });

    adminTabPanes.forEach(pane => {
      const match = pane.id === `tab-pane-${tabName}`;
      pane.classList.toggle('hidden', !match);
      if (match) pane.classList.add('active');
    });

    if (updateHash && window.location.hash !== `#${tabName}`) {
      window.history.replaceState(null, '', `#${tabName}`);
    }

    if (tabName === 'bloggers') {
      loadBloggerVault();
    } else if (tabName === 'analytics') {
      loadAnalyticsDashboard();
    } else if (tabName === 'announcements') {
      loadAnnouncements();
    } else if (tabName === 'submissions') {
      loadSubmissions();
    } else {
      updateHudArchiveCount();
    }
  }

  adminTabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      triggerClickSpark(e);
      const targetTab = btn.getAttribute('data-tab');
      switchAdminTab(targetTab, true);
    });
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && ['overview', 'bloggers', 'analytics'].includes(hash)) {
      switchAdminTab(hash, false);
    }
  });

  async function updateHudArchiveCount() {
    const startTime = performance.now();
    try {
      let totalBloggerCount = null;

      if (adminSessionToken) {
        try {
          const adminRes = await fetch('/api/admin/bloggers?limit=1', {
            headers: { 'x-admin-token': adminSessionToken }
          });
          const adminJson = await adminRes.json();
          if (adminJson.success && adminJson.stats && typeof adminJson.stats.total === 'number') {
            totalBloggerCount = adminJson.stats.total;
          }
        } catch (e) {
          console.warn('Failed to fetch admin stats for HUD:', e);
        }
      }

      const res = await fetch('/api/archive');
      const latencyMs = Math.round(performance.now() - startTime);
      const json = await res.json();

      if (totalBloggerCount === null && json.success && Array.isArray(json.data)) {
        totalBloggerCount = json.data.length;
      }

      if (totalBloggerCount !== null) {
        if (hudValCount) hudValCount.textContent = `${totalBloggerCount} 位博主`;
        if (tabNavBloggerBadge) tabNavBloggerBadge.textContent = totalBloggerCount.toLocaleString();
      }

      if (hudR2Status) {
        if (json.r2_bound) {
          hudR2Status.className = 'hud-latency-pill fast';
          hudR2Status.textContent = json.r2_count > 0 ? `${json.r2_count} 图已归档` : '10GB 就绪';
        } else {
          hudR2Status.className = 'hud-latency-pill normal';
          hudR2Status.textContent = '待绑定';
        }
      }

      if (hudD1Latency) {
        if (latencyMs < 120) {
          hudD1Latency.className = 'hud-latency-pill fast';
        } else if (latencyMs < 350) {
          hudD1Latency.className = 'hud-latency-pill normal';
        } else {
          hudD1Latency.className = 'hud-latency-pill slow';
        }
        hudD1Latency.textContent = `${latencyMs}ms`;
      }
    } catch (e) {
      if (hudD1Latency) {
        hudD1Latency.className = 'hud-latency-pill error';
        hudD1Latency.textContent = '离线';
      }
    }
  }

  // ==================== 3. Admin Auth & Session Gate ====================
  async function checkAdminSession() {
    if (!adminSessionToken) {
      showGate(true);
      return;
    }

    // 乐观渲染：token 存在时先直接显示 dashboard，避免登录界面闪烁
    showGate(false);
    btnAdminLogout.classList.remove('hidden');
    updateHudArchiveCount();

    try {
      const res = await fetch('/api/admin/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminSessionToken
        }
      });
      const json = await res.json();
      if (json.authenticated) {
        initCredentials();
        loadSyncVisibility();
        checkActiveWorkflowOnLoad();
        const initHash = window.location.hash.replace('#', '');
        if (initHash && ['overview', 'bloggers', 'analytics', 'announcements', 'submissions'].includes(initHash)) {
          switchAdminTab(initHash, false);
        } else {
          switchAdminTab('overview', false);
        }
      } else {
        performLogout();
      }
    } catch (e) {
      performLogout();
    }
  }

  function showGate(isLocked) {
    if (isLocked) {
      authGateScreen.classList.remove('hidden');
      adminDashboardScreen.classList.add('hidden');
      btnAdminLogout?.classList.add('hidden');
    } else {
      authGateScreen.classList.add('hidden');
      adminDashboardScreen.classList.remove('hidden');
      btnAdminLogout?.classList.remove('hidden');
      updateHudArchiveCount();
    }
  }

  adminLoginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUser.value.trim();
    const password = loginPass.value.trim();

    if (!username || !password) return;

    btnSubmitLogin.disabled = true;
    btnSubmitLogin.querySelector('span').textContent = '正在解密...';
    loginErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await res.json();

      if (json.success && json.token) {
        adminSessionToken = json.token;
        localStorage.setItem('x_archive_admin_token', adminSessionToken);
        showGate(false);
        btnAdminLogout.classList.remove('hidden');
        showToast('通行鉴权成功，已进入控制台');
        initCredentials();
        checkActiveWorkflowOnLoad();
        updateHudArchiveCount();
        const initHash = window.location.hash.replace('#', '');
        if (initHash && ['overview', 'bloggers', 'analytics', 'announcements', 'submissions'].includes(initHash)) {
          switchAdminTab(initHash, false);
        } else {
          switchAdminTab('overview', false);
        }
      } else {
        authCardBox.classList.add('shake-error');
        setTimeout(() => authCardBox.classList.remove('shake-error'), 500);
        loginErrorMsg.textContent = json.error || '账号或通行密码错误';
        loginErrorMsg.classList.remove('hidden');
      }
    } catch (err) {
      loginErrorMsg.textContent = '网络错误，请稍后重试';
      loginErrorMsg.classList.remove('hidden');
    } finally {
      btnSubmitLogin.disabled = false;
      btnSubmitLogin.querySelector('span').textContent = '解密并进入控制台';
    }
  });

  function performLogout() {
    // 通知服务端销毁会话 + 清 HttpOnly Cookie。
    // 原站登出是纯客户端的，服务端会话会一直留到过期 —— 令牌泄露后登出等于没登出。
    const token = adminSessionToken;
    adminSessionToken = '';
    localStorage.removeItem('x_archive_admin_token');
    if (token) {
      fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'x-admin-token': token },
        keepalive: true
      }).catch(() => {});
    }
    showGate(true);
    showToast('已安全退出管理控制台');
  }

  btnAdminLogout?.addEventListener('click', performLogout);

  // ==================== 4. X Cookie Credentials Management ====================
  async function initCredentials() {
    // 隐藏状态和表单，展示质感加载骨架屏遮罩
    credLoadingSkeleton?.classList.remove('hidden');
    xCookieAccountBox?.classList.add('hidden');
    cookieFormWrapper?.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/credentials', {
        headers: { 'x-admin-token': adminSessionToken }
      });
      const json = await res.json();

      if (json.success && json.hasCredentials) {
        inputCt0.value = json.ct0 || '';
        inputAuthToken.value = json.authToken || '';
        setCredStatus(true, '已保存登录凭据');
        await verifyAndShowUser(json.ct0, json.authToken, false);
      } else {
        // 服务端说没有凭据 —— 就是没有。不再回落到 localStorage 副本（已不写了）。
        // 清掉可能存在的历史遗留明文。
        localStorage.removeItem('x_archive_ct0');
        localStorage.removeItem('x_archive_auth_token');
        {
          setCredStatus(false, '未登录 X 账号');
          credLoadingSkeleton?.classList.add('hidden');
          cookieFormWrapper?.classList.remove('hidden');
        }
      }
    } catch (e) {
      console.warn('获取已存凭据错误:', e);
      credLoadingSkeleton?.classList.add('hidden');
      cookieFormWrapper?.classList.remove('hidden');
    }
  }

  function setCredStatus(isActive, text, handle = '') {
    if (credStatusIndicator) {
      credStatusIndicator.className = `status-tag ${isActive ? 'active' : 'inactive'}`;
    }
    if (credStatusText) credStatusText.textContent = text;

    if (hudValCred) {
      hudValCred.textContent = isActive ? (handle ? `@${handle} · 凭据就绪` : '已连接 X 账号') : '未登录 X 账号';
    }
    if (hudDotCred) {
      hudDotCred.className = `hud-badge-dot ${isActive ? 'active' : 'inactive'}`;
    }
  }

  async function verifyAndShowUser(ct0, authToken, showNotification = true) {
    try {
      const res = await fetch('/api/verify-cookie', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminSessionToken
        },
        body: JSON.stringify({ ct0, authToken })
      });
      const json = await res.json();

      credLoadingSkeleton?.classList.add('hidden');

      if (json.success && json.user) {
        setCredStatus(true, 'X 账号验证成功', json.user.screen_name);
        xAccountName.textContent = json.user.name || '已登录 X 账号';
        xAccountHandle.textContent = `@${json.user.screen_name || 'user'}`;
        if (json.user.avatar_url) {
          xAccountAvatar.src = resolveMediaUrl(json.user.avatar_url);
        }

        xCookieAccountBox.classList.remove('hidden');
        cookieFormWrapper.classList.add('hidden');

        // 不再往 localStorage 写 ct0 / auth_token。
        // 这两个 Cookie 等同 X 账号完全控制权，任何 XSS 都能读走 localStorage。
        // 验证成功时服务端已把它们 AES-GCM 加密入库（见 /api/verify-cookie），
        // "记住凭据"因此变成服务端行为，前端不需要留副本。
        // 顺手清掉历史遗留的明文副本。
        localStorage.removeItem('x_archive_ct0');
        localStorage.removeItem('x_archive_auth_token');

        if (showNotification) {
          showToast(`成功连接 X 账号: @${json.user.screen_name}`);
        }
      } else {
        setCredStatus(false, 'Cookie 已失效');
        xCookieAccountBox.classList.add('hidden');
        cookieFormWrapper.classList.remove('hidden');
        if (showNotification) {
          showToast('Cookie 凭据无效或已过期');
        }
      }
    } catch (err) {
      credLoadingSkeleton?.classList.add('hidden');
      setCredStatus(false, '验证失败');
      cookieFormWrapper.classList.remove('hidden');
    }
  }

  btnSaveCred?.addEventListener('click', async () => {
    const ct0 = inputCt0.value.trim();
    const authToken = inputAuthToken.value.trim();

    if (!ct0 || !authToken) {
      showCredError('请填写完整 ct0 与 auth_token');
      return;
    }

    btnSaveCred.disabled = true;
    btnSaveCred.textContent = '校验中...';
    credFormMsg.classList.add('hidden');

    await verifyAndShowUser(ct0, authToken, true);

    btnSaveCred.disabled = false;
    btnSaveCred.textContent = '校验并登录 X';
  });

  function showCredError(msg) {
    credFormMsg.textContent = msg;
    credFormMsg.classList.remove('hidden');
  }

  btnLogoutXAccount?.addEventListener('click', () => {
    inputCt0.value = '';
    inputAuthToken.value = '';
    localStorage.removeItem('x_archive_ct0');
    localStorage.removeItem('x_archive_auth_token');
    xCookieAccountBox.classList.add('hidden');
    cookieFormWrapper.classList.remove('hidden');
    setCredStatus(false, '未登录 X 账号');
    showToast('已登出 X 账号凭据');
  });

  btnClearCred?.addEventListener('click', () => {
    inputCt0.value = '';
    inputAuthToken.value = '';
    localStorage.removeItem('x_archive_ct0');
    localStorage.removeItem('x_archive_auth_token');
    credFormMsg.classList.add('hidden');
    showToast('已清空凭据表单');
  });

  // ==================== 5. Smart Sync Engine ====================
  // ── 同步默认可见性 ─────────────────────────────────────────
  //
  // 默认 private：同步是批量拉进来的，先落成「仅站长可见」由站长挑着公开。
  // 这比事后一个一个点「全站下架」正确 —— 下架写在共享的 bloggers 行上，
  // 是全局的，会把后来收录同一位博主的其他用户一起挡掉。
  const selSyncVis = document.getElementById('sync-default-visibility');

  async function loadSyncVisibility() {
    if (!selSyncVis) return;   // 未登录/DOM 未就绪
    try {
      const res = await fetch('/api/admin/visibility', { headers: { 'x-admin-token': adminSessionToken } });
      const json = await res.json();
      if (json.success) selSyncVis.value = json.default_visibility || 'private';
    } catch { /* 读不到就保持 HTML 里的默认值 private */ }
  }

  selSyncVis?.addEventListener('change', async () => {
    const v = selSyncVis.value;
    selSyncVis.disabled = true;
    try {
      const res = await fetch('/api/admin/visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify({ default_visibility: v })
      });
      const json = await res.json();
      showToast(json.success ? json.message : `保存失败: ${json.error}`);
      if (!json.success) await loadSyncVisibility();
    } catch (err) {
      showToast(`请求异常: ${err.message}`);
      await loadSyncVisibility();
    }
    selSyncVis.disabled = false;
  });

  // 同步是**分批**跑的，前端循环调用直到服务端说 done。
  //
  // 为什么分批：Cloudflare Free 每次 Worker 调用只有 50 次 D1 查询额度，
  // 而同步每位博主约 8 次 —— 一次调用最多 5-6 位。断点存在服务端
  // sync_state.cursor，所以中途停下/关页面都不白跑。
  //
  // 顺带修掉的 bug：原来撞到单轮上限就停，再点一次又从第 1 位重扫，
  // 「连续 3 个已知即停」立刻触发，永远过不了那个位置。
  let adminSyncAbort = false;

  async function runAdminSync(mode) {
    // 表单里填了就用（首次配置的情形），否则留空让服务端用它加密存的那份。
    // 不再从 localStorage 读 —— 前端已经不留凭据副本了。
    const ct0 = inputCt0.value.trim();
    const authToken = inputAuthToken.value.trim();

    if ((ct0 && !authToken) || (!ct0 && authToken)) {
      showToast('请同时填写 ct0 与 auth_token，或都留空以使用已保存的凭据');
      return;
    }

    adminSyncAbort = false;
    btnTriggerSync.disabled = true;
    if (btnTriggerSyncFull) btnTriggerSyncFull.disabled = true;
    btnStopSync?.classList.remove('hidden');
    syncProgressStatusText.textContent = '正在连接 X 接口并增量同步...';
    syncProgressCountText.textContent = '请求中';
    syncProgressFill.style.width = '8%';
    terminalLogOutput.innerHTML = `> [${new Date().toLocaleTimeString()}] 启动${mode === 'full' ? '完整核对' : '增量同步'}任务（分批续跑）...\n`;

    const budget = parseInt(document.getElementById('sync-budget')?.value, 10) || 42;
    const MAX_ROUNDS = 300;

    let round = 0, totalNew = 0, totalScanned = 0, totalSkipped = 0, dbTotal = 0, lastErr = null, incremental = false;

    try {
      while (round < MAX_ROUNDS) {
        if (adminSyncAbort) {
          logTerminal('[STOP] 已按你的要求停止。断点已保存，再点一次会从这里继续。');
          break;
        }
        round++;

        const res = await fetch('/api/sync-following', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
          body: JSON.stringify({
            ...(ct0 && authToken ? { ct0, authToken } : {}),
            mode, queryBudget: budget,
            // 完整核对的第一批要丢掉旧断点，从头走
            restart: round === 1 && mode === 'full',
          })
        });
        const json = await res.json();

        if (!json.success) { lastErr = json.error; break; }

        // 模式 B（Node 后台长轮询）——保留兼容：没有 following 数组时走轮询
        if (!Array.isArray(json.following)) {
          showToast('增量同步任务已在后台启动');
          startPollingSyncStatus();
          return;
        }

        // 第一轮打全量日志（含 queryId 发现/翻页），之后只打关键行，
        // 否则几十轮的日志会把终端刷爆
        (json.logs || []).forEach((l) => {
          if (round === 1 || /^\[(NEW|WARN|CHECK|DONE|ERROR|POLICY|RESUME|PAUSE)/.test(l)) logTerminal(l);
        });

        (json.new_users || []).forEach((u) => {
          const r2Tag = (u.avatar_url && u.avatar_url.includes('/api/media')) ? ' [R2 头像+封面已落库]' : '';
          logTerminal(`[NEW] 抓取到新增博主: @${u.screen_name} (${u.name}) · 粉丝: ${u.followers_count}${r2Tag}`);
        });

        totalNew += json.new_count || 0;
        totalScanned = json.pass_scanned ?? totalScanned;
        totalSkipped += json.skipped || 0;
        dbTotal = json.total_db_count || dbTotal;
        incremental = incremental || !!json.is_incremental_stop;

        syncProgressFill.style.width = `${Math.min(95, 8 + totalScanned * 0.25)}%`;
        syncProgressStatusText.textContent = `已扫描 ${totalScanned} 位 · 新增 ${totalNew} · 跳过 ${totalSkipped}`;
        syncProgressCountText.textContent = `第 ${round} 批 · 库中 ${dbTotal} 人`;

        if (json.done) {
          syncProgressFill.style.width = '100%';
          if (incremental && totalNew === 0) {
            logTerminal(`[SUCCESS] 增量核对完成：无新增关注博主，数据已是最新（库中总计 ${dbTotal} 人）`);
            syncProgressStatusText.textContent = `增量核对完成，数据已最新（库中 ${dbTotal} 人）`;
            showToast(`增量核对完成，无新增博主（库中 ${dbTotal} 人）`);
          } else {
            if (!json.r2_bound) {
              logTerminal('[WARN] 未检测到 R2 绑定 (MEDIA)，图片只写了源 URL。永久冷备需在 Pages 后台加 R2 绑定');
            }
            logTerminal(`[SUCCESS] 同步完成：扫描 ${totalScanned} 位，新增 ${totalNew} 位，跳过 ${totalSkipped} 位在库的，库中总计 ${dbTotal} 人`);
            syncProgressStatusText.textContent = `同步完成！新增 ${totalNew} 位（库中 ${dbTotal} 人）`;
            showToast(`同步完成，新增 ${totalNew} 位（库中 ${dbTotal} 人）`);
          }
          break;
        }
        if (round >= MAX_ROUNDS) {
          logTerminal(`[WARN] 已连续跑 ${MAX_ROUNDS} 批仍未走完，先停下。断点已保存，再点一次继续。`);
        }
      }

      if (lastErr) {
        logTerminal(`[ERROR] ${lastErr}`);
        syncProgressStatusText.textContent = '同步失败';
        showToast(`同步失败: ${lastErr}`);
      }
      updateHudArchiveCount();
      loadBloggerVault();
    } catch (err) {
      logTerminal(`[ERROR] ${err.message}`);
      showToast('网络异常，无法连接同步服务');
    }
    btnStopSync?.classList.add('hidden');
    btnTriggerSync.disabled = false;
    if (btnTriggerSyncFull) btnTriggerSyncFull.disabled = false;
  }

  btnTriggerSync?.addEventListener('click', () => runAdminSync('incremental'));
  btnTriggerSyncFull?.addEventListener('click', () => runAdminSync('full'));

  document.getElementById('btn-stop-sync')?.addEventListener('click', () => {
    adminSyncAbort = true;
    const b = document.getElementById('btn-stop-sync');
    b.disabled = true; b.textContent = '正在收尾...';
    setTimeout(() => { b.disabled = false; b.innerHTML = '<span>停止</span>'; }, 3000);
  });

  function startPollingSyncStatus() {
    if (syncPollingInterval) clearInterval(syncPollingInterval);

    syncPollingInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/sync-status', {
          headers: { 'x-admin-token': adminSessionToken }
        });
        const status = await res.json();

        if (status.running) {
          syncProgressStatusText.textContent = '抓取中 (遇到已存博主自动智能停止)...';
          syncProgressCountText.textContent = `${status.current} 已抓取`;
          syncProgressFill.style.width = '65%';

          if (status.lastItem) {
            logTerminal(`[FETCH] 抓取到: @${status.lastItem.screen_name} (${status.lastItem.name}) · 粉丝: ${status.lastItem.followers_count}`);
          }
        } else {
          clearInterval(syncPollingInterval);
          btnTriggerSync.disabled = false;
          syncProgressFill.style.width = '100%';

          if (status.error) {
            syncProgressStatusText.textContent = `同步异常中断: ${status.error}`;
            logTerminal(`[ERROR] 任务失败: ${status.error}`);
            showToast(`同步中断: ${status.error}`);
          } else {
            syncProgressStatusText.textContent = `同步完成！新增 ${status.newFetched || 0} 位博主，当前总计 ${status.total || 0} 位`;
            syncProgressCountText.textContent = `${status.total || 0} 总数`;
            logTerminal(`[SUCCESS] 增量同步结束！本次抓取新增 ${status.newFetched || 0} 人，数据库总计 ${status.total || 0} 人。`);
            showToast(`同步完成！新增 ${status.newFetched || 0} 位博主`);
            updateHudArchiveCount();
            loadBloggerVault();
          }
        }
      } catch (err) {
        clearInterval(syncPollingInterval);
        btnTriggerSync.disabled = false;
      }
    }, 1500);
  }

  function logTerminal(msg) {
    if (!msg) return;
    const safe = escapeHtml(msg);
    let lineHtml = safe;
    if (safe.includes('[SUCCESS]') || safe.includes('[ALL DONE]') || safe.includes('✅') || safe.includes('🎉')) {
      lineHtml = `<span class="terminal-line-success">${safe}</span>`;
    } else if (safe.includes('[ERROR]') || safe.includes('[RESET ERROR]')) {
      lineHtml = `<span class="terminal-line-error">${safe}</span>`;
    } else if (safe.includes('[WARN]') || safe.includes('⚠️')) {
      lineHtml = `<span class="terminal-line-warn">${safe}</span>`;
    } else if (safe.includes('[R2]')) {
      lineHtml = `<span class="terminal-line-r2">${safe}</span>`;
    } else if (safe.includes('[NEW]') || safe.includes('[CHECK]') || safe.includes('[PAGE') || safe.includes('[PROGRESS]') || safe.includes('[CONFIG]') || safe.includes('[POLICY]') || safe.includes('📄') || safe.includes('📊')) {
      lineHtml = `<span class="terminal-line-info">${safe}</span>`;
    } else if (safe.includes('[FETCH]')) {
      lineHtml = `<span class="terminal-line-fetch">${safe}</span>`;
    } else if (safe.includes('简介变更') || safe.includes('资料变更') || safe.includes('[MUTATION]') || safe.includes('昵称更名') || safe.includes('🔄') || safe.includes('🏷️')) {
      lineHtml = `<span class="terminal-line-mutation">${safe}</span>`;
    } else if (safe.includes('头像更新') || safe.includes('封面更新') || safe.includes('[AVATAR]') || safe.includes('🖼️')) {
      lineHtml = `<span class="terminal-line-avatar">${safe}</span>`;
    } else if (safe.includes('封号') || safe.includes('[SUSPENDED]') || safe.includes('🚫')) {
      lineHtml = `<span class="terminal-line-suspended">${safe}</span>`;
    } else if (safe.includes('注销') || safe.includes('[DELETED]')) {
      lineHtml = `<span class="terminal-line-deleted">${safe}</span>`;
    } else if (safe.includes('主动取关') || safe.includes('取关') || safe.includes('👋')) {
      lineHtml = `<span class="terminal-line-warn">${safe}</span>`;
    } else if (safe.includes('差额') || safe.includes('🔍') || safe.includes('❓')) {
      lineHtml = `<span class="terminal-line-cooldown">${safe}</span>`;
    } else if (safe.includes('[COOLDOWN]') || safe.includes('[RATE LIMIT]') || safe.includes('[WAIT]') || safe.includes('[RETRY]') || safe.includes('❄️') || safe.includes('⏳') || safe.includes('🔥')) {
      lineHtml = `<span class="terminal-line-cooldown">${safe}</span>`;
    }

    if (terminalLogOutput) {
      const current = terminalLogOutput.innerHTML;
      if (current && !current.endsWith('\n')) {
        terminalLogOutput.innerHTML += '\n';
      }
      terminalLogOutput.innerHTML += `> ${lineHtml}\n`;
      terminalLogOutput.scrollTop = terminalLogOutput.scrollHeight;
    }
  }

  // ==================== 6. Backup Export, Restore & Reset ====================
  btnExportJson?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/archive');
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(json.data, null, 2));
        const downloadAnchor = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 10);
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `x_archive_backup_${timestamp}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast(`已导出 ${json.data.length} 条博主归档数据`);
      }
    } catch (e) {
      showToast('导出备份失败');
    }
  });

  btnImportJson?.addEventListener('click', () => {
    fileInputBackup.click();
  });

  fileInputBackup?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!Array.isArray(data)) {
          showToast('备份文件格式错误，需为 JSON 数组');
          return;
        }

        const confirmRestore = confirm(`确认从备份文件导入 ${data.length} 位博主数据并覆盖当前数据库吗？`);
        if (!confirmRestore) return;

        const res = await fetch('/api/archive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminSessionToken
          },
          body: JSON.stringify({ data })
        });
        const resJson = await res.json();

        if (resJson.success) {
          showToast(`成功导入并还原 ${data.length} 条博主数据`);
          updateHudArchiveCount();
          loadBloggerVault();
        } else {
          showToast(`导入失败: ${resJson.error}`);
        }
      } catch (err) {
        showToast('解析备份 JSON 失败');
      }
    };
    reader.readAsText(file);
  });

  // 清空博主归档数据（仅清理博主，保留 X 登录凭据）
  // 归档一旦清空无法恢复，且这与产品目标直接冲突，所以要求手打确认短语，
  // 服务端也会校验（缺短语返回 428）。
  const RESET_CONFIRM_PHRASE = 'DELETE ALL BLOGGERS';
  btnResetD1?.addEventListener('click', async () => {
    const typed = prompt(
      '⚠️ 这会清空全部已归档的博主数据，无法恢复。\n' +
      '（不影响已保存的 X 登录凭据）\n\n' +
      `建议先点"导出备份"下载一份 JSON。\n\n` +
      `确认请输入：${RESET_CONFIRM_PHRASE}`
    );
    if (typed !== RESET_CONFIRM_PHRASE) {
      if (typed !== null) showToast('确认短语不匹配，已取消');
      return;
    }

    try {
      logTerminal('[RESET] 正在清空博主归档数据...');
      const res = await fetch('/api/admin/reset-d1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminSessionToken
        },
        body: JSON.stringify({ clearCredentials: false, confirm: RESET_CONFIRM_PHRASE })
      });
      const json = await res.json();

      if (json.success) {
        logTerminal('[RESET] 博主归档数据已成功清空');
        showToast('博主归档数据已成功清空！');
        updateHudArchiveCount();
        loadBloggerVault();
      } else {
        logTerminal(`[RESET ERROR] 清理失败: ${json.error}`);
        showToast(`清理失败: ${json.error}`);
      }
    } catch (e) {
      logTerminal(`[RESET ERROR] 请求异常: ${e.message}`);
      showToast('清理请求异常');
    }
  });

  // ==================== 6.3 GitHub Actions Cloud Dispatch & Realtime Log Watcher ====================
  let ghWorkflowPollTimer = null;
  let ghCurrentRunId = null;
  const btnTriggerGhFullSyncDefaultHtml = btnTriggerGhFullSync ? btnTriggerGhFullSync.innerHTML : '';
  const knownLogLines = new Set();

  function setGhButtonState(state, info = {}) {
    if (!btnTriggerGhFullSync) return;
    if (state === 'running') {
      btnTriggerGhFullSync.disabled = true;
      btnTriggerGhFullSync.classList.add('is-running');
      const runTag = info.run_id ? `#${info.run_id}` : '';
      btnTriggerGhFullSync.innerHTML = `
        <div class="btn-task-content">
          <div class="btn-task-title-row" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg class="icon-spin-smooth" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#refresh-ccw-dot"/></svg>
              <span>全量数据深度刷新中</span>
              <span style="font-family: var(--type-mono); font-size: 11.5px; color: var(--ink-muted); font-weight: 500;">${runTag}</span>
            </div>
            <div class="badge-status-pill running">
              <span class="tag-dot-pulse"></span>
              <span>运行中</span>
            </div>
          </div>
          <span class="btn-task-desc">云端正在逐页安全巡检 · 离开或刷新页面不影响进度</span>
        </div>
      `;
    } else if (state === 'dispatching') {
      btnTriggerGhFullSync.disabled = true;
      btnTriggerGhFullSync.classList.remove('is-running');
      btnTriggerGhFullSync.innerHTML = `
        <div class="btn-task-content">
          <div class="btn-task-title-row">
            <svg class="icon-spin-smooth" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#loader"/></svg>
            <span>正在向 GitHub 派发云端任务...</span>
          </div>
          <span class="btn-task-desc">正在验证 PAT 凭据并创建 Workflow Run</span>
        </div>
      `;
    } else {
      btnTriggerGhFullSync.disabled = false;
      btnTriggerGhFullSync.classList.remove('is-running');
      btnTriggerGhFullSync.innerHTML = btnTriggerGhFullSyncDefaultHtml;
    }
  }

  function parseAndFormatWorkflowLog(rawLine) {
    if (!rawLine) return '';
    // 去除 GitHub Actions 默认前置时间戳 (如 2026-08-25T02:35:12.1234567Z)
    const clean = rawLine.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, '').trim();
    if (!clean) return '';
    return clean;
  }

  function startWatchingWorkflow(runId) {
    if (ghWorkflowPollTimer) clearInterval(ghWorkflowPollTimer);
    ghCurrentRunId = runId ? String(runId) : null;
    knownLogLines.clear();
    setGhButtonState('running', { run_id: runId });

    let isFirstPoll = true;

    const poll = async () => {
      if (!adminSessionToken) {
        clearInterval(ghWorkflowPollTimer);
        ghWorkflowPollTimer = null;
        return;
      }

      try {
        const queryUrl = ghCurrentRunId 
          ? `/api/admin/workflow-status?run_id=${encodeURIComponent(ghCurrentRunId)}`
          : `/api/admin/workflow-status`;
        
        const res = await fetch(queryUrl, {
          headers: { 'x-admin-token': adminSessionToken }
        });

        if (res.status === 401) {
          performLogout();
          return;
        }

        const data = await res.json();

        if (!data.success) {
          if (isFirstPoll) {
            logTerminal(`[WARN] 状态监听中转提示: ${data.error || '暂无可用状态'}`);
            isFirstPoll = false;
          }
          return;
        }

        if (!ghCurrentRunId && data.run_id) {
          ghCurrentRunId = String(data.run_id);
          knownLogLines.clear();
          setGhButtonState('running', { run_id: data.run_id });
        }

        // 处理新日志行
        if (data.logs && typeof data.logs === 'string') {
          const rawLines = data.logs.split('\n');

          for (let i = 0; i < rawLines.length; i++) {
            const rawLine = rawLines[i];
            const clean = parseAndFormatWorkflowLog(rawLine);
            if (!clean) continue;

            // 过滤无意义的 runner 内部初始化日志
            const isRunnerNoise = clean.startsWith('::') || 
                                  clean.startsWith('##[') ||
                                  clean.startsWith('Post ') ||
                                  clean.startsWith('Run actions/') ||
                                  clean.startsWith('with: ') ||
                                  clean.startsWith('env: ') ||
                                  clean.startsWith('npm ') ||
                                  clean === 'Run node -e "' ||
                                  clean === '"';

            const lineKey = clean;
            if (!isRunnerNoise && !knownLogLines.has(lineKey)) {
              knownLogLines.add(lineKey);
              logTerminal(clean);

              // 智能驱动顶部进度条状态
              if (clean.includes('PROGRESS') || clean.includes('已累计深度巡检')) {
                const match = clean.match(/已累计深度巡检:\s*(\d+)\s*人\s*\|\s*库中总博主数:\s*(\d+)\s*人/);
                if (match) {
                  const currentScanned = parseInt(match[1], 10) || 0;
                  const totalDb = parseInt(match[2], 10) || 1;
                  const pct = Math.min(Math.round((currentScanned / Math.max(totalDb, currentScanned)) * 100), 98);
                  syncProgressFill.style.width = `${pct}%`;
                  syncProgressCountText.textContent = `${currentScanned} / ${totalDb} 人 (${pct}%)`;
                  syncProgressStatusText.textContent = `全量巡检进行中 (${currentScanned} 人已核对)...`;
                }
              } else if (clean.includes('COOLDOWN') || clean.includes('冷却保护中') || clean.includes('冷却期') || clean.includes('15 分钟')) {
                const minMatch = clean.match(/剩余\s*(\d+)\s*分钟/);
                const minText = minMatch ? ` (剩余 ${minMatch[1]} 分钟)` : '';
                syncProgressStatusText.textContent = `🛡️ 已触发 15 分钟安全冷却${minText}，正在重置 X 频控桶...`;
                syncProgressCountText.textContent = `冷却中${minText}`;
              } else if (clean.includes('WAIT') || clean.includes('拟人安全间隔')) {
                const secMatch = clean.match(/休眠\s*([\d.]+)\s*秒/);
                const secText = secMatch ? ` (休眠 ${secMatch[1]}s)` : '';
                syncProgressStatusText.textContent = `⏳ 拟人安全间隔中${secText}...`;
              } else if (clean.includes('PAGE') || clean.includes('正在深度刷新')) {
                syncProgressStatusText.textContent = clean;
              }
            }
          }
        }

        // 动态状态机响应
        if (data.status === 'completed') {
          clearInterval(ghWorkflowPollTimer);
          ghWorkflowPollTimer = null;
          ghCurrentRunId = null;
          setGhButtonState('ready');
          syncProgressFill.style.width = '100%';

          if (data.conclusion === 'success') {
            syncProgressStatusText.textContent = `云端全量数据深度刷新已圆满完成！(Run #${data.run_id})`;
            syncProgressCountText.textContent = '100% 已完成';
            logTerminal(`[SUCCESS] GitHub Actions 工作流执行成功 (Run #${data.run_id})`);
            showToast('全量数据深度刷新已圆满完成！');
          } else {
            syncProgressStatusText.textContent = `云端任务结束: ${data.conclusion || '异常'}`;
            syncProgressCountText.textContent = '异常中断';
            logTerminal(`[WARN] GitHub Actions 工作流结束状态: ${data.conclusion || '异常'}`);
            showToast(`全量刷新任务结束: ${data.conclusion || '异常'}`);
          }
          updateHudArchiveCount();
          loadBloggerVault();
        } else {
          // 运行中动态响应 (状态不锁死)
          if (isFirstPoll) {
            isFirstPoll = false;
            if (syncProgressFill.style.width === '0%' || !syncProgressFill.style.width) {
              syncProgressFill.style.width = '15%';
            }
          }
          
          if (!syncProgressStatusText.textContent || syncProgressStatusText.textContent.includes('排队中') || syncProgressStatusText.textContent.includes('已调度')) {
            syncProgressStatusText.textContent = `云端全量任务运行中 (Run #${data.run_id || '已调度'})...`;
          }
          
          if (syncProgressCountText.textContent === '排队中' && data.status === 'in_progress') {
            syncProgressCountText.textContent = '执行中';
          }
        }

      } catch (err) {
        console.error('Workflow poll error:', err);
      }
    };

    poll();
    ghWorkflowPollTimer = setInterval(poll, 3000);
  }

  async function checkActiveWorkflowOnLoad() {
    if (!adminSessionToken) return;
    try {
      const res = await fetch('/api/admin/workflow-status', {
        headers: { 'x-admin-token': adminSessionToken }
      });
      const data = await res.json();
      if (data.success && data.run_id) {
        if (data.is_active) {
          knownLogLines.clear();
          logTerminal(`[RECONNECT] 发现云端正在执行全量深度刷新工作流 (Run #${data.run_id} · ${data.status})，已自动恢复日志监听与按钮锁定...`);
          startWatchingWorkflow(data.run_id);
        }
      }
    } catch (e) {}
  }

  async function triggerGhAction(btnEl) {
    if (!adminSessionToken) {
      showToast('请先登录 Admin 授权');
      return;
    }

    if (ghWorkflowPollTimer || btnEl.classList.contains('is-running')) {
      showToast('云端全量任务正在运行中，请勿重复点击');
      return;
    }

    knownLogLines.clear();
    setGhButtonState('dispatching');
    syncProgressFill.style.width = '8%';
    syncProgressStatusText.textContent = '正在向 GitHub 派发全量刷新工作流...';
    syncProgressCountText.textContent = '派发中';
    logTerminal(`\n======================================================`);
    logTerminal(`[GITHUB ACTIONS] 正在向 GitHub 发起【全量数据深度刷新】工作流调度请求...`);

    try {
      const res = await fetch('/api/admin/trigger-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminSessionToken
        },
        body: JSON.stringify({ action: 'full_sync' })
      });
      const json = await res.json();

      if (json.success) {
        logTerminal(`[SUCCESS] ${json.message}`);
        const targetRunId = json.run_id || null;
        logTerminal(`[GITHUB ACTIONS] 离线任务已成功进入云端执行序列 (Run: ${targetRunId ? '#' + targetRunId : '已就绪'})`);
        logTerminal(`[GITHUB ACTIONS] 实时运行日志: ${json.actions_url}`);
        showToast(json.message);

        // 启动实时监听与按钮锁定
        startWatchingWorkflow(targetRunId);
      } else {
        setGhButtonState('ready');
        logTerminal(`[ERROR] 派发失败: ${json.error}`);
        showToast(`派发失败: ${json.error}`);
      }
    } catch (err) {
      setGhButtonState('ready');
      logTerminal(`[ERROR] 派发异常: ${err.message}`);
      showToast('网络请求异常');
    }
  }

  btnTriggerGhFullSync?.addEventListener('click', (e) => {
    triggerClickSpark(e);
    triggerGhAction(btnTriggerGhFullSync);
  });

  // ==================== 6.5 Blogger Vault Management & Shield Controller (React Bits Motion) ====================
  const panelBloggers = document.getElementById('panel-bloggers');
  const bloggerSearchInput = document.getElementById('blogger-search-input');
  const btnClearBloggerSearch = document.getElementById('btn-clear-blogger-search');
  const filterTabBtns = document.querySelectorAll('.filter-tab-btn');
  const tabCountAll = document.getElementById('tab-count-all');
  const tabCountActive = document.getElementById('tab-count-active');
  const tabCountBlocked = document.getElementById('tab-count-blocked');
  const tabCountPrivate = document.getElementById('tab-count-private');
  const bloggerSortTriggerBtn = document.getElementById('blogger-sort-trigger-btn');
  const bloggerSortMenu = document.getElementById('blogger-sort-menu');
  const bloggerSortCurrentText = document.getElementById('blogger-sort-current-text');
  const bloggerSortMenuItems = document.querySelectorAll('#blogger-sort-menu .menu-item');
  const bloggerListContainer = document.getElementById('blogger-list-container');
  const bloggerPaginationInfo = document.getElementById('blogger-pagination-info');
  const bloggerPageIndicator = document.getElementById('blogger-page-indicator');
  const btnPagePrev = document.getElementById('btn-page-prev');
  const btnPageNext = document.getElementById('btn-page-next');
  const btnRefreshBloggers = document.getElementById('btn-refresh-bloggers');
  const btnExportHandles = document.getElementById('btn-export-handles');
  const modalExportHandles = document.getElementById('modal-export-handles');
  const exportHandlesTextarea = document.getElementById('export-handles-textarea');
  const btnCopyExportHandles = document.getElementById('btn-copy-export-handles');

  let bvCurrentKeyword = '';
  let bvCurrentStatus = 'all';
  let bvLastStats = { total: 0, blocked: 0, mine_private: 0, in_gallery: 0 };
  let bvOrphans = 0;
  let bvCurrentSort = 'backed_up_at_desc';
  let bvCurrentPage = 1;
  const bvCurrentLimit = 30;
  let bvTotalPages = 1;
  let bvSearchDebounceTimer = null;
  let bvIsLoading = false;

  // React Bits SpotlightCard Pointer Motion
  panelBloggers?.addEventListener('mousemove', (e) => {
    const rect = panelBloggers.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    panelBloggers.style.setProperty('--spotlight-x', `${x}px`);
    panelBloggers.style.setProperty('--spotlight-y', `${y}px`);
    panelBloggers.classList.add('spotlight-active');
  });

  panelBloggers?.addEventListener('mouseleave', () => {
    panelBloggers.classList.remove('spotlight-active');
  });

  // React Bits CountUp Animation (EaseOutExpo)
  function animateCountUp(element, targetVal, duration = 400) {
    if (!element) return;
    const startVal = parseInt(element.textContent.replace(/,/g, '') || '0', 10) || 0;
    if (startVal === targetVal) {
      element.textContent = targetVal.toLocaleString();
      return;
    }
    const startTime = performance.now();
    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.round(startVal + (targetVal - startVal) * easeProgress);
      element.textContent = current.toLocaleString();
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = targetVal.toLocaleString();
      }
    }
    requestAnimationFrame(update);
  }

  // React Bits ClickSpark Particle Burst
  function triggerClickSpark(e) {
    const x = e.clientX;
    const y = e.clientY;
    const colors = ['#38bdf8', '#f59e0b', '#10b981', '#a855f7', '#ec4899'];
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement('div');
      spark.className = 'click-spark-particle';
      const angle = (Math.PI * 2 / 6) * i + (Math.random() - 0.5);
      const distance = 18 + Math.random() * 16;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      spark.style.setProperty('--dx', `${dx}px`);
      spark.style.setProperty('--dy', `${dy}px`);
      spark.style.background = colors[i % colors.length];
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      document.body.appendChild(spark);
      setTimeout(() => spark.remove(), 400);
    }
  }

  function formatFollowersCount(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(num);
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

  async function loadBloggerVault() {
    if (!adminSessionToken || bvIsLoading) return;
    bvIsLoading = true;

    if (bloggerListContainer) {
      bloggerListContainer.innerHTML = `
        <div class="blogger-list-loading">
          <div class="skeleton-spinner"></div>
          <span>正在检索博主资产数据...</span>
        </div>
      `;
    }

    try {
      const params = new URLSearchParams({
        keyword: bvCurrentKeyword,
        status: bvCurrentStatus,
        sort: bvCurrentSort,
        page: bvCurrentPage,
        limit: bvCurrentLimit
      });

      const res = await fetch(`/api/admin/bloggers?${params.toString()}`, {
        headers: { 'x-admin-token': adminSessionToken }
      });
      const json = await res.json();

      if (json.success) {
        // 更新统计计数（React Bits CountUp）
        if (json.stats) {
          bvLastStats = json.stats;
          bvOrphans = json.stats.orphans || 0;
          animateCountUp(tabCountAll, json.stats.total);
          // in_gallery 才是「画廊可见」的真实数字：is_blocked=0 且至少一条公开归属。
          // 之前用 active（仅 is_blocked=0）会把私密的那些也算进去，数字对不上首页。
          animateCountUp(tabCountActive, json.stats.in_gallery ?? json.stats.active);
          animateCountUp(tabCountPrivate, json.stats.mine_private ?? 0);
          animateCountUp(tabCountBlocked, json.stats.blocked);
          if (tabNavBloggerBadge) {
            tabNavBloggerBadge.textContent = json.stats.total.toLocaleString();
          }
          if (hudValCount) {
            hudValCount.textContent = `${json.stats.total} 位博主`;
          }
        }

        bvTotalPages = json.totalPages || 1;
        renderBloggerRows(json.data || []);
        renderPagination(json.total || 0, json.page, json.limit);
      } else {
        bloggerListContainer.innerHTML = `
          <div class="blogger-list-empty">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#alert-circle"/></svg>
            <span>加载失败: ${escapeHtml(json.error)}</span>
          </div>
        `;
      }
    } catch (e) {
      console.error('loadBloggerVault error:', e);
      bloggerListContainer.innerHTML = `
        <div class="blogger-list-empty">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#alert-circle"/></svg>
          <span>网络请求异常，请刷新重试</span>
        </div>
      `;
    } finally {
      bvIsLoading = false;
    }
  }

  function applyBlockedRowState(button, row, blocked) {
    const nameLine = row?.querySelector('.blogger-name-line');
    let blockedTag = nameLine?.querySelector('.badge-blocked-tag');

    row?.classList.toggle('is-blocked', blocked);
    button.className = `btn-action-block ${blocked ? 'to-unblock' : 'to-block'}`;
    button.setAttribute('data-blocked', blocked ? '1' : '0');
    button.setAttribute('title', blocked
      ? '解除全站下架'
      : '全站下架：对所有人生效。只想自己不看请改用「转私密」');
    button.innerHTML = blocked
      ? `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#eye-wide"/></svg><span>解除下架</span>`
      : `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#ban"/></svg><span>全站下架</span>`;

    if (blocked && !blockedTag && nameLine) {
      blockedTag = document.createElement('span');
      blockedTag.className = 'badge-blocked-tag';
      blockedTag.title = '全站下架：对所有人生效。别人收录同一位博主也进不了公开画廊';
      blockedTag.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#ban"/></svg><span>全站下架</span>`;
      nameLine.appendChild(blockedTag);
    } else if (!blocked) {
      blockedTag?.remove();
    }
  }

  function removeFilteredBloggerRow(row, blocked) {
    const shouldLeave = row && (
      (bvCurrentStatus === 'in_gallery' && blocked) ||
      (bvCurrentStatus === 'blocked' && !blocked)
    );
    if (!shouldLeave) return;

    row.classList.add('is-collapsing');
    setTimeout(() => {
      row.remove();
      if (bloggerListContainer.querySelectorAll('.blogger-row:not(.is-collapsing)').length === 0) {
        bloggerListContainer.innerHTML = `
          <div class="blogger-list-empty">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#search-empty"/></svg>
            <span>当前筛选下暂无博主档案</span>
          </div>
        `;
      }
    }, 280);
  }

  function adjustBlockedTabCounts(blocked) {
    const currentActive = parseInt(tabCountActive?.textContent?.replace(/,/g, '') || '0', 10);
    const currentBlocked = parseInt(tabCountBlocked?.textContent?.replace(/,/g, '') || '0', 10);
    const activeDelta = blocked ? -1 : 1;
    const blockedDelta = blocked ? 1 : -1;
    animateCountUp(tabCountActive, Math.max(0, currentActive + activeDelta));
    animateCountUp(tabCountBlocked, Math.max(0, currentBlocked + blockedDelta));
  }

  function renderBloggerRows(users) {
    if (!bloggerListContainer) return;
    if (!Array.isArray(users) || users.length === 0) {
      bloggerListContainer.innerHTML = `
        <div class="blogger-list-empty">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#search-empty"/></svg>
          <span>未检索到匹配的博主档案</span>
        </div>
      `;
      return;
    }

    const defaultFallbackAvatar = '/api/media?url=' + encodeURIComponent('https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png');

    // 当前 Tab 下的批量操作条。只在「待公开」「已屏蔽」两个 Tab 出现 ——
    // 「全部」下批量改可见性太容易误触整库。
    const bulkBar = (() => {
      if (bvCurrentStatus === 'private' && bvLastStats.mine_private > 0) {
        return `<div class="vis-bulk-bar">
          <span>这里是你收录了但<strong>仅站长可见</strong>的 <strong>${bvLastStats.mine_private}</strong> 位博主，画廊上看不到。</span>
          <span class="vis-bulk-spacer"></span>
          <button type="button" id="btn-bulk-publish">全部公开到画廊</button>
        </div>`;
      }
      // 孤儿告警：这些记录既不在画廊、也不属于任何人。属于 bug 状态，
      // 所以不管在哪个 Tab 都要显示 —— 藏起来就等于让它继续无声无息。
      if (bvOrphans > 0) {
        return `<div class="vis-bulk-bar is-warn">
          <span>有 <strong>${bvOrphans}</strong> 条档案没有任何归属行：既不在公开画廊，也不属于任何人。
            这是某个添加路径漏建归属造成的。</span>
          <span class="vis-bulk-spacer"></span>
          <button type="button" id="btn-fix-orphans">修复（挂到站长名下）</button>
        </div>`;
      }
      if (bvCurrentStatus === 'blocked' && bvLastStats.blocked > 0) {
        return `<div class="vis-bulk-bar">
          <span><strong>全站下架</strong>是全局的：别人收录同一位博主也进不了画廊。
            如果你只是想自己筛掉，转成「仅站长可见」更合适。</span>
          <span class="vis-bulk-spacer"></span>
          <button type="button" id="btn-bulk-to-private">这 ${bvLastStats.blocked} 条改为仅站长可见</button>
        </div>`;
      }
      return '';
    })();

    bloggerListContainer.innerHTML = bulkBar + users.map((u, idx) => {
      const isBlocked = u.is_blocked === 1;
      // 站长视角下有**三**种可见性状态，不是两种。早先按两态写，结果第三种没有出路：
      //   'public'   站长收录了且公开
      //   'private'  站长收录了但仅自己可见
      //   ''         **站长根本没有归属行** —— 例如别人投稿进来的博主。
      //              这种记录也可能不在画廊（收录它的人设了私密），
      //              但按两态逻辑 isPrivate=false，按钮会显示「转私密」——
      //              明明不在画廊，唯一给出的操作却是让它更隐蔽，没有任何办法公开它。
      //
      // 正确判据是「站长这条归属是否为 public」，其余一律给「公开」按钮。
      const isPublic = u.my_visibility === 'public';
      const isPrivate = u.my_visibility === 'private';
      const notOwned = !u.my_visibility;
      const inGallery = u.in_gallery === 1;
      const avatarSrc = resolveMediaUrl(u.avatar_url) || defaultFallbackAvatar;
      const backupDate = u.backed_up_at ? new Date(u.backed_up_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '未记录';
      const staggerDelay = (idx * 0.02).toFixed(2);

      return `
        <div class="blogger-row ${isBlocked ? 'is-blocked' : ''}" id="blogger-row-${escapeHtml(u.screen_name)}" style="animation-delay: ${staggerDelay}s;">
          <div class="blogger-row-left">
            <div class="blogger-row-avatar-box">
              <img class="blogger-row-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(u.name)}" loading="lazy" onerror="this.onerror=null; this.src='${escapeHtml(defaultFallbackAvatar)}'">
            </div>
            <div class="blogger-row-info">
              <div class="blogger-name-line">
                <span class="blogger-row-name">${escapeHtml(u.name)}</span>
                ${u.verified ? `
                  <svg width="13" height="13" fill="none" stroke="var(--cyan)" stroke-width="2.5" title="X 官方认证" aria-hidden="true"><use href="/icons.svg#badge-verified"/></svg>
                ` : ''}
                <span class="blogger-row-handle">@${escapeHtml(u.screen_name)}</span>
                ${u.is_suspended === 1 ? `
                  <span class="badge-status-pill suspended" style="font-size: 10.5px; padding: 1px 6px;">
                    <svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#ban"/></svg>
                    <span>已封号</span>
                  </span>
                ` : ''}
                ${u.is_suspended === 2 ? `
                  <span class="badge-status-pill deleted" style="font-size: 10.5px; padding: 1px 6px;">
                    <svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#alert-circle"/></svg>
                    <span>已注销</span>
                  </span>
                ` : ''}
                ${isBlocked ? `
                  <span class="badge-blocked-tag" title="全站下架：对所有人生效。别人收录同一位博主也进不了公开画廊">
                    <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#ban"/></svg>
                    <span>全站下架</span>
                  </span>
                ` : ''}
                ${isPrivate ? `
                  <span class="badge-private-tag" title="仅站长可见：只影响你这一条归属。别人收录同一位博主并标为公开，它照样会出现在画廊">
                    <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#lock"/></svg>
                    <span>仅站长可见</span>
                  </span>
                ` : ''}
                ${notOwned ? `
                  <span class="badge-private-tag" title="你没有收录这位博主 —— 它是别人投稿或同步进来的。点「公开」就会收录到你名下并显示在画廊">
                    <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#circle-info"/></svg>
                    <span>未收录</span>
                  </span>
                ` : ''}
                ${!isBlocked && !inGallery ? `
                  <span class="badge-offgallery-tag" title="此刻不出现在公开画廊。原因：没有任何人把它标为公开${isBlocked ? '，且已被全站下架' : ''}">
                    <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#eye-off"/></svg>
                    <span>不在画廊</span>
                  </span>
                ` : ''}
              </div>
              <div class="blogger-row-bio" title="${escapeHtml(u.description || '')}">${escapeHtml(u.description || '暂无个人简介')}</div>
            </div>
          </div>

          <div class="blogger-row-right">
            <div class="blogger-row-meta">
              <span class="blogger-followers-pill">${formatFollowersCount(u.followers_count)} 粉丝</span>
              ${(u.owner_count || 0) > 1 ? `<span class="blogger-owners-pill" title="含公开仓在内，共 ${u.owner_count} 人收录">${u.owner_count} 人收录</span>` : ''}
              <span class="blogger-backup-date">归档于 ${backupDate}</span>
            </div>

            <div class="blogger-row-actions">
              <a href="https://x.com/${escapeHtml(u.screen_name)}" target="_blank" rel="noopener noreferrer" class="btn-action-icon" title="在 X 中打开个人主页">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#external-link"/></svg>
              </a>

              <button type="button" class="btn-action-icon btn-copy-handle" data-handle="${escapeHtml(u.screen_name)}" title="复制 @${escapeHtml(u.screen_name)}">
                <svg class="icon-copy" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#copy-thin"/></svg>
                <svg class="icon-check hidden" width="14" height="14" fill="none" stroke="var(--green)" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#check-badge"/></svg>
              </button>

              <button type="button" class="btn-action-vis ${isPublic ? 'to-private' : 'to-public'}" data-handle="${escapeHtml(u.screen_name)}" data-vis="${isPublic ? 'public' : 'private'}" title="${isPublic ? '仅站长可见：只把你这一条归属撤下，不影响别人收录同一位博主' : (notOwned ? '公开：收录到你名下并显示在画廊' : '公开：让它出现在画廊（前提是没被全站下架）')}">
                ${isPublic ? `
                  <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#lock"/></svg>
                  <span>转私密</span>
                ` : `
                  <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#eye-thin"/></svg>
                  <span>公开</span>
                `}
              </button>

              <button type="button" class="btn-action-icon btn-release-blogger" data-handle="${escapeHtml(u.screen_name)}" data-name="${escapeHtml(u.name || '')}" title="撤出公开仓：只删公开仓这一条归属，别人的私人收录保留。撤出后若无人引用会连带回收数据（会再要求确认）">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#log-out-thin"/></svg>
              </button>

              <button type="button" class="btn-action-block ${isBlocked ? 'to-unblock' : 'to-block'}" data-handle="${escapeHtml(u.screen_name)}" data-blocked="${isBlocked ? '1' : '0'}" title="${isBlocked ? '解除全站下架' : '全站下架：对所有人生效。只想自己不看请改用「转私密」'}">
                ${isBlocked ? `
                  <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#eye-wide"/></svg>
                  <span>解除下架</span>
                ` : `
                  <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><use href="/icons.svg#ban"/></svg>
                  <span>全站下架</span>
                `}
              </button>

              <button type="button" class="btn-action-icon btn-delete-blogger" data-handle="${escapeHtml(u.screen_name)}" data-name="${escapeHtml(u.name || '')}" data-owners="${u.owner_count || 0}" data-mine="${isPublic || isPrivate ? '1' : '0'}" title="彻底删除档案（不可恢复，区别于「屏蔽」）">
                <svg width="14" height="14" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#trash-outline"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // ── 可见性切换（私密 <-> 公开）─────────────────────────────
    //
    // 这是站长做筛选时该用的操作，不是「屏蔽」。三者区别：
    //   转私密  blogger_owners.visibility='private'  只改站长自己这一条归属。
    //           别人收录同一位博主并标公开 -> 它照样进画廊，那个人看得见。
    //   全站下架 bloggers.is_blocked=1              全局，对所有人生效。
    //   删除    DELETE FROM bloggers                 整行没了，不可恢复。
    //
    // 这里不做乐观 DOM 更新：一次切换会同时影响徽标、按钮、三个角标、
    // 以及「是否解除全站下架」，就地拼 DOM 很容易和服务端算出的状态对不上。
    // 直接重载列表，代价只是一次请求。
    bloggerListContainer.querySelectorAll('.btn-action-vis').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const handle = btn.getAttribute('data-handle');
        const cur = btn.getAttribute('data-vis');   // 'public' = 目前公开，其余（private / 未收录）都当"未公开"
        if (!handle) return;
        const target = cur === 'public' ? 'private' : 'public';

        triggerClickSpark(e);
        btn.disabled = true;
        try {
          const res = await fetch('/api/admin/visibility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
            body: JSON.stringify({ screen_name: handle, visibility: target })
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.message || (target === 'public' ? `已公开 @${handle}` : `已设为仅站长可见 @${handle}`));
            loadBloggerVault();
          } else {
            showToast(`操作失败: ${json.error}`);
            btn.disabled = false;
          }
        } catch (err) {
          showToast(`请求异常: ${err.message}`);
          btn.disabled = false;
        }
      });
    });

    // 批量：把当前范围整批改可见性。scope 在服务端解析，
    // 不把 700 个 handle 塞进请求体。
    async function bulkVisibility(scope, visibility, btn, confirmText) {
      if (confirmText && !confirm(confirmText)) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '处理中…';
      try {
        const res = await fetch('/api/admin/visibility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
          body: JSON.stringify({ scope, visibility })
        });
        const json = await res.json();
        if (json.success) { showToast(json.message); loadBloggerVault(); }
        else { showToast(`操作失败: ${json.error}`); btn.disabled = false; btn.textContent = original; }
      } catch (err) {
        showToast(`请求异常: ${err.message}`); btn.disabled = false; btn.textContent = original;
      }
    }

    document.getElementById('btn-fix-orphans')?.addEventListener('click', (e) =>
      bulkVisibility('orphans', 'private', e.currentTarget,
        `把这 ${bvOrphans} 条无归属的档案挂到站长名下（设为仅站长可见）？\n\n` +
        `修完它们会出现在「待公开」Tab，你可以再决定要不要公开。`));

    document.getElementById('btn-bulk-publish')?.addEventListener('click', (e) =>
      bulkVisibility('all_private', 'public', e.currentTarget,
        `确认把这 ${bvLastStats.mine_private} 位博主全部公开到画廊？\n\n` +
        `公开后所有访客都能在首页看到他们。`));

    document.getElementById('btn-bulk-to-private')?.addEventListener('click', (e) =>
      bulkVisibility('blocked', 'private', e.currentTarget,
        `把这 ${bvLastStats.blocked} 条从「全站下架」改成「仅站长可见」？\n\n` +
        `改完之后：\n` +
        `· 他们照样不出现在你的公开画廊\n` +
        `· 但别人收录同一位博主并标为公开时，不再被你连带挡掉\n` +
        `· is_blocked 会被清零`));

    // 彻底删除档案。与「屏蔽」的区别在提示里讲清楚：
    // 屏蔽只是不在公开画廊出现，档案/点击数/时间线全留着，可恢复；
    // 删除会连点击统计、变更时间线、R2 里的图一起清掉，不可恢复。
    bloggerListContainer.querySelectorAll('.btn-delete-blogger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const handle = btn.getAttribute('data-handle');
        const name = btn.getAttribute('data-name') || '';
        const owners = parseInt(btn.getAttribute('data-owners') || '0', 10);
        const mine = btn.getAttribute('data-mine') === '1';
        if (!handle) return;

        const others = Math.max(owners - (mine ? 1 : 0), 0);
        const typed = prompt(
          `⚠️ 彻底删除 @${handle}${name ? `（${name}）` : ''} 的档案\n\n` +
          `会一并删除：点击统计、变更时间线、已归档的头像与 Banner。\n` +
          `此操作不可恢复。\n\n` +
          (others > 0
            ? `还有 ${others} 位用户收录着它。日常下架请改用左边的「撤出公开仓」，他们的私人收录会保留。\n彻底删除会把他们的收录一起毁掉。\n\n`
            : `若只是不想让它出现在公开画廊，请改用「屏蔽」（档案会完整保留）。\n\n`) +
          `确认删除请输入：DELETE`
        );
        if (typed !== 'DELETE') {
          if (typed !== null) showToast('确认短语不匹配，已取消');
          return;
        }

        btn.disabled = true;
        const send = (force) => fetch('/api/admin/blogger', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminSessionToken
          },
          body: JSON.stringify(force
            ? { screen_name: handle, confirm: 'DELETE', force: true }
            : { screen_name: handle, confirm: 'DELETE' })
        }).then(r => r.json().then(json => ({ status: r.status, json })));

        try {
          let res = await send(false);
          if (res.status === 409 && res.json.code === 'others_own') {
            const n = res.json.others ?? others;
            const favn = res.json.favorites || 0;
            const typedForce = prompt(
              `还有 ${n} 位用户把 @${handle} 收录在自己名下` +
              `${favn ? `，另有 ${favn} 条收藏` : ''}。\n` +
              `彻底删除会把他们的收录一起毁掉。\n\n` +
              `日常下架请取消，改用「撤出公开仓」。\n` +
              `确认连带删除请输入：FORCE`
            );
            if (typedForce !== 'FORCE') {
              if (typedForce !== null) showToast('确认短语不匹配，已取消');
              btn.disabled = false;
              return;
            }
            res = await send(true);
          }
          if (res.json.success) {
            showToast(res.json.message || `已删除 @${handle}`);
            const refs = res.json.deleted;
            logTerminal(
              `[DELETED] 已彻底删除 @${handle} 的档案` +
              `（丢失 ${refs?.clicks_lost ?? 0} 次点击` +
              `${refs?.owners_removed ? ` · ${refs.owners_removed} 条收录` : ''}` +
              `${refs?.favorites_removed ? ` · ${refs.favorites_removed} 条收藏` : ''}）`
            );
            updateHudArchiveCount();
            loadBloggerVault();
          } else {
            showToast(`删除失败: ${res.json.error}`);
            btn.disabled = false;
          }
        } catch (err) {
          showToast(`请求异常: ${err.message}`);
          btn.disabled = false;
        }
      });
    });

    // 撤出公开仓（mode:'release'）= 只删公开仓（admin-legacy）这一行归属指针，
    // 别人的私人收录照旧保留 —— 日常下架应该用它，而不是右边的「彻底删除」。
    // 撤出后若再没有任何人引用，后端会连带回收整份归档数据并回 428 要求确认短语
    // （那一步不可逆），这里先不带 confirm 发一次，撞到 428 再让站长手打 DELETE 重发。
    bloggerListContainer.querySelectorAll('.btn-release-blogger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const handle = btn.getAttribute('data-handle');
        const name = btn.getAttribute('data-name') || '';
        if (!handle) return;

        if (!confirm(
          `把 @${handle}${name ? `（${name}）` : ''} 撤出公开仓？\n\n` +
          `· 只移除公开仓这一条归属，别人的私人收录不受影响\n` +
          `· 撤出后若没有任何人收录或收藏它，归档数据（含点击统计、时间线、媒体）会被一并回收 —— 那一步会再要求你确认\n` +
          `· 若只想让它不显示但保留公开仓归属，请取消并改用「转私密」`
        )) return;

        btn.disabled = true;
        const send = (confirmPhrase) => fetch('/api/admin/blogger', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminSessionToken
          },
          body: JSON.stringify(confirmPhrase
            ? { screen_name: handle, mode: 'release', confirm: confirmPhrase }
            : { screen_name: handle, mode: 'release' })
        }).then(r => r.json().then(json => ({ status: r.status, json })));

        try {
          let res = await send(null);
          if (res.status === 428) {
            const typed = prompt(
              `@${handle} 只有公开仓在收录它 —— 撤出后将无人引用，归档数据（含点击统计、\n` +
              `变更时间线、已归档的头像与 Banner）会被一并回收，不可恢复。\n\n` +
              `若只想让它不在画廊出现但保留档案，请取消并改用「转私密」。\n` +
              `确认回收请输入：DELETE`
            );
            if (typed !== 'DELETE') {
              if (typed !== null) showToast('确认短语不匹配，已取消');
              btn.disabled = false;
              return;
            }
            res = await send('DELETE');
          }
          if (res.json.success) {
            showToast(res.json.message || `已撤出 @${handle}`);
            logTerminal(res.json.reclaimed
              ? `[RELEASED] 已撤出 @${handle}，无人再引用，归档数据一并回收`
              : `[RELEASED] 已把 @${handle} 撤出公开仓（他人收录 ${res.json.refs?.owners ?? 0} · 收藏 ${res.json.refs?.favorites ?? 0}）`);
            updateHudArchiveCount();
            loadBloggerVault();
          } else {
            showToast(`操作失败: ${res.json.error}`);
            btn.disabled = false;
          }
        } catch (err) {
          showToast(`请求异常: ${err.message}`);
          btn.disabled = false;
        }
      });
    });

    // 绑定行内按钮事件
    bloggerListContainer.querySelectorAll('.btn-copy-handle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const handle = btn.getAttribute('data-handle');
        if (!handle) return;
        navigator.clipboard.writeText(`@${handle}`);
        triggerClickSpark(e);

        const iconCopy = btn.querySelector('.icon-copy');
        const iconCheck = btn.querySelector('.icon-check');
        iconCopy?.classList.add('hidden');
        iconCheck?.classList.remove('hidden');

        showToast(`已复制 @${handle} 到剪贴板`);
        setTimeout(() => {
          iconCopy?.classList.remove('hidden');
          iconCheck?.classList.add('hidden');
        }, 1800);
      });
    });

    bloggerListContainer.querySelectorAll('.btn-action-block').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const handle = btn.getAttribute('data-handle');
        const currentBlocked = btn.getAttribute('data-blocked') === '1';
        const targetBlocked = !currentBlocked;
        const targetRow = document.getElementById(`blogger-row-${handle}`);

        triggerClickSpark(e);
        btn.disabled = true;

        // 乐观更新行、筛选视图和 Tab 角标，避免整页刷新造成闪烁。
        applyBlockedRowState(btn, targetRow, targetBlocked);
        removeFilteredBloggerRow(targetRow, targetBlocked);
        adjustBlockedTabCounts(targetBlocked);

        try {
          const res = await fetch('/api/admin/bloggers', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-token': adminSessionToken
            },
            body: JSON.stringify({
              screen_name: handle,
              is_blocked: targetBlocked ? 1 : 0
            })
          });
          const json = await res.json();

          if (json.success) {
            showToast(json.message || (targetBlocked ? `已全站下架 @${handle}` : `已解除下架 @${handle}`));
          } else {
            showToast(`操作失败: ${json.error}`);
            loadBloggerVault();
          }
        } catch (err) {
          showToast(`请求异常: ${err.message}`);
          loadBloggerVault();
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderPagination(total, page, limit) {
    if (!bloggerPaginationInfo || !bloggerPageIndicator) return;
    const start = total === 0 ? 0 : (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    bloggerPaginationInfo.textContent = `显示 ${start} - ${end} / 共 ${total} 位博主`;
    bloggerPageIndicator.textContent = `第 ${page} / ${bvTotalPages} 页`;

    if (btnPagePrev) btnPagePrev.disabled = page <= 1;
    if (btnPageNext) btnPageNext.disabled = page >= bvTotalPages;
  }

  // 搜索防抖监听 (250ms)
  bloggerSearchInput?.addEventListener('input', (e) => {
    bvCurrentKeyword = e.target.value.trim();
    if (bvCurrentKeyword) {
      btnClearBloggerSearch?.classList.remove('hidden');
    } else {
      btnClearBloggerSearch?.classList.add('hidden');
    }

    clearTimeout(bvSearchDebounceTimer);
    bvSearchDebounceTimer = setTimeout(() => {
      bvCurrentPage = 1;
      loadBloggerVault();
    }, 250);
  });

  btnClearBloggerSearch?.addEventListener('click', () => {
    if (bloggerSearchInput) bloggerSearchInput.value = '';
    bvCurrentKeyword = '';
    btnClearBloggerSearch.classList.add('hidden');
    bvCurrentPage = 1;
    loadBloggerVault();
  });

  // 状态筛选 Tab 切换
  filterTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      bvCurrentStatus = btn.getAttribute('data-status') || 'all';
      bvCurrentPage = 1;
      loadBloggerVault();
    });
  });

  function setBloggerSortSelection(sortVal, sortText) {
    bvCurrentSort = sortVal;
    if (bloggerSortCurrentText) bloggerSortCurrentText.textContent = sortText;
    bloggerSortMenuItems.forEach(item => {
      const match = item.getAttribute('data-val') === sortVal;
      item.classList.toggle('active', match);
      const check = item.querySelector('.check-icon');
      if (check) check.classList.toggle('hidden', !match);
    });
  }

  // 排序下拉切换展开/收起
  bloggerSortTriggerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isClosed = bloggerSortMenu?.classList.toggle('hidden');
    bloggerSortTriggerBtn.setAttribute('aria-expanded', String(!isClosed));
  });

  // 排序项选中
  bloggerSortMenuItems.forEach(item => {
    item.addEventListener('click', () => {
      const val = item.getAttribute('data-val');
      const txt = item.querySelector('span')?.textContent || '';
      setBloggerSortSelection(val, txt);
      bloggerSortMenu?.classList.add('hidden');
      bloggerSortTriggerBtn?.setAttribute('aria-expanded', 'false');
      bvCurrentPage = 1;
      loadBloggerVault();
    });
  });

  // 点击外部收起排序下拉菜单
  document.addEventListener('click', (e) => {
    if (!bloggerSortMenu?.contains(e.target) && !bloggerSortTriggerBtn?.contains(e.target)) {
      bloggerSortMenu?.classList.add('hidden');
      bloggerSortTriggerBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  // 分页按钮
  btnPagePrev?.addEventListener('click', () => {
    if (bvCurrentPage > 1) {
      bvCurrentPage--;
      loadBloggerVault();
    }
  });

  btnPageNext?.addEventListener('click', () => {
    if (bvCurrentPage < bvTotalPages) {
      bvCurrentPage++;
      loadBloggerVault();
    }
  });

  btnRefreshBloggers?.addEventListener('click', (e) => {
    triggerClickSpark(e);
    loadBloggerVault();
    updateHudArchiveCount();
    showToast('已刷新博主档案列表');
  });

  // 导出 Handle 清单 Modal
  btnExportHandles?.addEventListener('click', async (e) => {
    triggerClickSpark(e);
    if (!modalExportHandles || !exportHandlesTextarea) return;

    exportHandlesTextarea.value = '正在提取博主 Handle 列表...';
    modalExportHandles.classList.remove('hidden');

    try {
      // 提取全部满足当前筛选条件的 handle
      const params = new URLSearchParams({
        keyword: bvCurrentKeyword,
        status: bvCurrentStatus,
        sort: bvCurrentSort,
        page: 1,
        limit: 1000
      });
      const res = await fetch(`/api/admin/bloggers?${params.toString()}`, {
        headers: { 'x-admin-token': adminSessionToken }
      });
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        const handles = json.data.map(u => u.screen_name).filter(Boolean);
        exportHandlesTextarea.value = handles.join('\n');
      } else {
        exportHandlesTextarea.value = '提取失败：' + (json.error || '未知错误');
      }
    } catch (err) {
      exportHandlesTextarea.value = '提取异常：' + err.message;
    }
  });

  btnCopyExportHandles?.addEventListener('click', (e) => {
    if (!exportHandlesTextarea) return;
    triggerClickSpark(e);
    navigator.clipboard.writeText(exportHandlesTextarea.value);
    showToast('已复制全部 Handle 清单到剪贴板');
  });

  // Modal Universal Close Handler
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      modalExportHandles?.classList.add('hidden');
    });
  });

  // ==================== 7.5 Data Analytics & Popularity Insights Engine (Chart.js + React-Bits) ====================
  let chartClickSourcesInstance = null;
  let chartFollowerTiersInstance = null;
  let chartAccountHealthInstance = null;

  const kpiValClicks = document.getElementById('kpi-val-clicks');
  const kpiValTotal = document.getElementById('kpi-val-total');
  const kpiValFollowers = document.getElementById('kpi-val-followers');
  const kpiValActiveCreators = document.getElementById('kpi-val-active-creators');
  const kpiValVerifiedRate = document.getElementById('kpi-val-verified-rate');
  const kpiValR2Count = document.getElementById('kpi-val-r2-count');

  const analyticsClickTopList = document.getElementById('analytics-click-top-list');
  const analyticsFollowersTopList = document.getElementById('analytics-followers-top-list');

  const legValCard = document.getElementById('leg-val-card');
  const legValTimeline = document.getElementById('leg-val-timeline');
  const legValRoulette = document.getElementById('leg-val-roulette');

  const healthValActive = document.getElementById('health-val-active');
  const healthValBlocked = document.getElementById('health-val-blocked');
  const healthValSuspended = document.getElementById('health-val-suspended');
  const healthValVerified = document.getElementById('health-val-verified');

  // Chart.js 的外壳配置只有数据与 tooltip 文案不同；集中构造可以避免
  // 三张图在调整材质、图例或响应式策略时各自漂移。
  const CHART_TOOLTIP_BASE = {
    backgroundColor: '#09090b',
    titleColor: '#f8fafc',
    bodyColor: '#94a3b8',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
  };

  const chartTooltip = (label) => ({
    ...CHART_TOOLTIP_BASE,
    callbacks: { label },
  });

  const makeDoughnutConfig = ({ labels, values, colors, cutout, tooltipLabel }) => ({
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout,
      plugins: {
        legend: { display: false },
        tooltip: chartTooltip(tooltipLabel),
      },
    },
  });

  const makeFollowerTierConfig = ({ labels, values, colors, tooltipLabel }) => ({
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: chartTooltip(tooltipLabel),
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 12, weight: '600' } },
        },
      },
    },
  });

  async function loadAnalyticsDashboard() {
    if (!adminSessionToken) return;

    try {
      // 走专用聚合端点。原来是拉 /api/admin/bloggers?limit=1000 在前端自己遍历 ——
      // limit 上限就是 1000（db.js:78），库里已经 700+ 条，再涨会**静默少算**：
      // KPI 和三张图表全部偏低且不报错。聚合交给 SQL，覆盖全表且快得多。
      const res = await fetch('/api/admin/analytics', {
        headers: { 'x-admin-token': adminSessionToken }
      });
      const json = await res.json();
      if (!json.success) return;

      const k = json.kpi || {};
      const tiers = json.tiers || {};

      animateCountUp(kpiValClicks, k.total_clicks || 0);
      animateCountUp(kpiValTotal, k.total || 0);
      // "活跃创作者" = 有过点击的博主数
      animateCountUp(kpiValActiveCreators, (json.topClicked || []).length ? null : 0);
      if (tabNavBloggerBadge) tabNavBloggerBadge.textContent = (k.total || 0).toLocaleString();
      if (hudValCount) hudValCount.textContent = `${k.total || 0} 位博主`;
      if (kpiValFollowers) kpiValFollowers.textContent = formatFollowersCount(k.followers_sum || 0);
      if (kpiValVerifiedRate) kpiValVerifiedRate.textContent = `${k.verified_pct || 0}%`;
      if (kpiValR2Count) animateCountUp(kpiValR2Count, k.snapshots || 0);

      renderClickTopLeaderboard(json.topClicked || [], k.total_clicks || 0);
      renderFollowersTopLeaderboard(json.topFollowers || []);
      renderClickSourcesChart(
        k.clicks_card || 0, k.clicks_timeline || 0, k.clicks_roulette || 0, k.total_clicks || 0
      );
      renderFollowerTiersChart(tiers);
      renderAccountHealthChart(
        (k.total || 0) - (k.blocked || 0),
        k.blocked || 0,
        (k.suspended || 0) + (k.deleted || 0),
        k.verified || 0
      );
    } catch (err) {
      console.error('loadAnalyticsDashboard error:', err);
    }
  }

  const analyticsFallbackAvatar = '/api/media?url=' + encodeURIComponent('https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png');

  function renderLeaderboardRow(user, index, rightMarkup, fallbackAvatar = analyticsFallbackAvatar) {
    const rank = index + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    const avatarSrc = resolveMediaUrl(user.avatar_url) || fallbackAvatar;
    const verifiedBadge = user.verified
      ? `<svg width="12" height="12" fill="none" stroke="var(--cyan)" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#badge-verified"/></svg>`
      : '';

    return `
      <div class="leaderboard-row ${rankClass}">
        <div class="leaderboard-left">
          <span class="leaderboard-rank">${rank}</span>
          <div class="leaderboard-avatar-box">
            <img class="leaderboard-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(user.name)}" loading="lazy" onerror="this.onerror=null; this.src='${escapeHtml(fallbackAvatar)}'">
          </div>
          <div class="leaderboard-info">
            <div class="leaderboard-name-row">
              <span class="leaderboard-name" title="${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
              ${verifiedBadge}
            </div>
            <span class="leaderboard-handle">@${escapeHtml(user.screen_name)}</span>
          </div>
        </div>

        <div class="leaderboard-right">
          ${rightMarkup}
        </div>
      </div>
    `;
  }

  function renderClickTopLeaderboard(bloggers, totalClicks) {
    if (!analyticsClickTopList) return;

    const sortedByClicks = [...bloggers].sort((a, b) => (b.total_clicks || 0) - (a.total_clicks || 0));
    const topClicked = sortedByClicks.slice(0, 10);
    const maxClick = topClicked[0]?.total_clicks || 0;

    if (totalClicks === 0 || maxClick === 0) {
      analyticsClickTopList.innerHTML = `
        <div class="blogger-list-empty" style="padding: 36px 16px;">
          <svg width="24" height="24" fill="none" stroke="var(--pink)" stroke-width="2" aria-hidden="true"><use href="/icons.svg#flame"/></svg>
          <span style="color: var(--ink); font-weight: 600; font-size: 13.5px;">本站点击热度正在累积中</span>
          <span style="font-size: 12px; color: var(--ink-muted); margin-top: 4px;">访客在画廊卡片、时光档案与抽卡探索中跳转 X 主页后，将在此实时自动生成热度排行榜。</span>
        </div>
      `;
      return;
    }

    analyticsClickTopList.innerHTML = topClicked.map((u, idx) => {
      const uTotal = u.total_clicks || 0;

      const cardC = u.clicks_card || 0;
      const timeC = u.clicks_timeline || 0;
      const cardPct = uTotal > 0 ? Math.round((cardC / uTotal) * 100) : 0;
      const timePct = uTotal > 0 ? Math.round((timeC / uTotal) * 100) : 0;
      const roulPct = uTotal > 0 ? Math.max(0, 100 - cardPct - timePct) : 0;

      return renderLeaderboardRow(u, idx, `
        <div class="leaderboard-source-bar-wrap" title="卡片跳转: ${cardPct}% | 时光抽屉: ${timePct}% | 抽卡探索: ${roulPct}%">
          <div class="leaderboard-source-seg seg-card" style="width: ${cardPct}%;"></div>
          <div class="leaderboard-source-seg seg-timeline" style="width: ${timePct}%;"></div>
          <div class="leaderboard-source-seg seg-roulette" style="width: ${roulPct}%;"></div>
        </div>

        <span class="leaderboard-click-badge" title="累计点击 ${uTotal} 次">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><use href="/icons.svg#flame"/></svg>
          <span>${uTotal}</span>
        </span>

        <a href="https://x.com/${escapeHtml(u.screen_name)}" target="_blank" rel="noopener noreferrer" class="btn-action-icon" title="前往 X 主页">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#external-link"/></svg>
        </a>
      `);
    }).join('');
  }

  function renderFollowersTopLeaderboard(bloggers) {
    if (!analyticsFollowersTopList) return;

    const sortedByFollowers = [...bloggers].sort((a, b) => (b.followers_count || 0) - (a.followers_count || 0));
    const topFollowers = sortedByFollowers.slice(0, 10);
    const maxFollower = topFollowers[0]?.followers_count || 1;

    if (topFollowers.length === 0) {
      analyticsFollowersTopList.innerHTML = `<div class="blogger-list-empty"><span>暂无博主数据</span></div>`;
      return;
    }

    analyticsFollowersTopList.innerHTML = topFollowers.map((u, idx) => {
      const percentOfMax = Math.round(((u.followers_count || 0) / maxFollower) * 100);

      return renderLeaderboardRow(u, idx, `
        <div class="leaderboard-source-bar-wrap" style="width: 90px;" title="占头部最高粉丝比: ${percentOfMax}%">
          <div class="leaderboard-source-seg" style="width: ${percentOfMax}%; background: var(--amber);"></div>
        </div>

        <span class="leaderboard-followers-badge">
          ${formatFollowersCount(u.followers_count)}
        </span>

        <a href="https://x.com/${escapeHtml(u.screen_name)}" target="_blank" rel="noopener noreferrer" class="btn-action-icon" title="前往 X 主页">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons.svg#external-link"/></svg>
        </a>
      `);
    }).join('');
  }

  function renderClickSourcesChart(clicksCard, clicksTimeline, clicksRoulette, totalClicks) {
    const ctx = document.getElementById('chart-click-sources');
    if (!ctx || typeof Chart === 'undefined') return;

    if (totalClicks > 0) {
      if (legValCard) legValCard.textContent = `${Math.round((clicksCard / totalClicks) * 100)}% (${clicksCard})`;
      if (legValTimeline) legValTimeline.textContent = `${Math.round((clicksTimeline / totalClicks) * 100)}% (${clicksTimeline})`;
      if (legValRoulette) legValRoulette.textContent = `${Math.round((clicksRoulette / totalClicks) * 100)}% (${clicksRoulette})`;
    } else {
      if (legValCard) legValCard.textContent = `0%`;
      if (legValTimeline) legValTimeline.textContent = `0%`;
      if (legValRoulette) legValRoulette.textContent = `0%`;
    }

    const dataValues = totalClicks > 0 ? [clicksCard, clicksTimeline, clicksRoulette] : [1, 1, 1];
    const bgColors = totalClicks > 0 ? ['#38bdf8', '#a855f7', '#ec4899'] : ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.03)'];

    if (chartClickSourcesInstance) {
      chartClickSourcesInstance.destroy();
    }

    chartClickSourcesInstance = new Chart(ctx, makeDoughnutConfig({
      labels: ['画廊主页卡片', '时光档案抽屉', '抽卡随机探索'],
      values: dataValues,
      colors: bgColors,
      cutout: '72%',
      tooltipLabel(item) {
        if (totalClicks === 0) return ' 暂无点击记录';
        const val = item.raw || 0;
        const pct = Math.round((val / totalClicks) * 100);
        return ` ${item.label}: ${val} 次 (${pct}%)`;
      },
    }));
  }

  function renderFollowerTiersChart(tiers) {
    const ctx = document.getElementById('chart-follower-tiers');
    if (!ctx || typeof Chart === 'undefined') return;

    // 分档由 SQL 算好（覆盖全表），不再前端遍历一页数据
    const tier1M   = tiers.t1m    || 0;
    const tier500K = tiers.t500k  || 0;
    const tier100K = tiers.t100k  || 0;
    const tier10K  = tiers.t10k   || 0;
    const tierLow  = tiers.tsmall || 0;

    if (chartFollowerTiersInstance) {
      chartFollowerTiersInstance.destroy();
    }

    chartFollowerTiersInstance = new Chart(ctx, makeFollowerTierConfig({
      labels: ['≥1M 超头部', '500K-1M 大V', '100K-500K 骨干', '10K-100K 进阶', '<10K 潜力'],
      values: [tier1M, tier500K, tier100K, tier10K, tierLow],
      colors: ['#f59e0b', '#ec4899', '#38bdf8', '#10b981', '#64748b'],
      tooltipLabel(item) {
        return ` 博主数量: ${item.raw} 位`;
      },
    }));
  }

  function renderAccountHealthChart(activeCount, blockedCount, suspendedCount, verifiedCount) {
    if (healthValActive) healthValActive.textContent = `${activeCount} 人`;
    if (healthValBlocked) healthValBlocked.textContent = `${blockedCount} 人`;
    if (healthValSuspended) healthValSuspended.textContent = `${suspendedCount} 人`;
    if (healthValVerified) healthValVerified.textContent = `${verifiedCount} 人`;

    const ctx = document.getElementById('chart-account-health');
    if (!ctx || typeof Chart === 'undefined') return;

    if (chartAccountHealthInstance) {
      chartAccountHealthInstance.destroy();
    }

    const totalHealthData = activeCount + blockedCount + suspendedCount;
    const values = totalHealthData > 0 ? [activeCount, blockedCount, suspendedCount, verifiedCount] : [1, 0, 0, 0];

    chartAccountHealthInstance = new Chart(ctx, makeDoughnutConfig({
      labels: ['正常展示中', '已屏蔽', '官方封号/注销', '蓝标认证'],
      values,
      colors: ['#10b981', '#f43f5e', '#f59e0b', '#38bdf8'],
      cutout: '68%',
      tooltipLabel(item) {
        return ` ${item.label}: ${item.raw} 位`;
      },
    }));
  }

  // ==================== 8. Toast Notifications ====================
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `
      <span class="toast-svg-icon" style="display: flex; align-items: center; color: var(--cyan);">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#check-circle"/></svg>
      </span>
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

  // ==================== 添加博主档案 ====================
  const modalAddBlogger = document.getElementById('modal-add-blogger');
  const inputAddHandle = document.getElementById('input-add-handle');
  const btnSubmitAddBlogger = document.getElementById('btn-submit-add-blogger');
  const addBloggerResult = document.getElementById('add-blogger-result');

  function setAddResult(kind, html) {
    if (!addBloggerResult) return;
    const palette = {
      ok: ['var(--green)', 'hsla(152, 69%, 45%, 0.14)'],
      err: ['var(--red)', 'var(--red-soft)'],
      info: ['var(--ink-soft)', 'var(--chip)'],
    }[kind] || ['var(--ink-soft)', 'var(--chip)'];
    addBloggerResult.style.color = palette[0];
    addBloggerResult.style.background = palette[1];
    addBloggerResult.style.border = `1px solid ${palette[0]}40`;
    addBloggerResult.innerHTML = html;
    addBloggerResult.classList.remove('hidden');
  }

  document.getElementById('btn-add-blogger')?.addEventListener('click', () => {
    addBloggerResult?.classList.add('hidden');
    if (inputAddHandle) inputAddHandle.value = '';
    modalAddBlogger?.classList.remove('hidden');
    setTimeout(() => inputAddHandle?.focus(), 50);
  });

  document.getElementById('form-add-blogger')?.addEventListener('submit', async () => {
    const raw = (inputAddHandle?.value || '').trim();
    if (!raw) { setAddResult('err', '请填写 handle'); return; }

    btnSubmitAddBlogger.disabled = true;
    const label = btnSubmitAddBlogger.querySelector('span');
    const original = label ? label.textContent : '';
    if (label) label.textContent = '正在抓取...';
    setAddResult('info', '正在从 X 抓取资料与媒体...');

    try {
      const res = await fetch('/api/admin/blogger', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify({ screen_name: raw })
      });
      const json = await res.json();

      if (json.success) {
        const b = json.blogger || {};
        setAddResult('ok',
          `已归档 <strong>@${escapeHtml(b.screen_name || raw)}</strong>` +
          `${b.name ? `（${escapeHtml(b.name)}）` : ''}<br>` +
          `粉丝 ${(b.followers_count || 0).toLocaleString()}${b.verified ? ' · 蓝标认证' : ''}`
        );
        showToast(json.message);
        logTerminal(`[NEW] 手动添加档案: @${b.screen_name} (${b.name}) · 粉丝: ${b.followers_count}`);
        if (inputAddHandle) inputAddHandle.value = '';
        updateHudArchiveCount();
        loadBloggerVault();
      } else {
        setAddResult('err', escapeHtml(json.error || '添加失败'));
      }
    } catch (err) {
      setAddResult('err', `请求异常：${escapeHtml(err.message)}`);
    } finally {
      btnSubmitAddBlogger.disabled = false;
      if (label) label.textContent = original;
    }
  });

  // ==================== 补回头像 ====================
  const modalRefetch = document.getElementById('modal-refetch');
  const btnStartRefetch = document.getElementById('btn-start-refetch');
  const btnStopRefetch = document.getElementById('btn-stop-refetch');
  const refetchLog = document.getElementById('refetch-log');
  const refetchFill = document.getElementById('refetch-progress-fill');
  const refetchRemaining = document.getElementById('refetch-remaining');
  const refetchDone = document.getElementById('refetch-done');
  const refetchTomb = document.getElementById('refetch-tomb');
  const refetchBadge = document.getElementById('refetch-missing-badge');

  let refetchAbort = false;
  let refetchRunning = false;

  function rLog(msg, cls = '') {
    if (!refetchLog) return;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    refetchLog.appendChild(line);
    refetchLog.scrollTop = refetchLog.scrollHeight;
  }

  /** 探一次待补数量，顺便更新按钮角标 */
  async function probeMissingCount() {
    try {
      const res = await fetch('/api/admin/refetch-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify({ screen_names: [], limit: 1 })
      });
      const json = await res.json();
      const n = json.remaining ?? 0;
      if (refetchBadge) {
        refetchBadge.textContent = n.toLocaleString();
        refetchBadge.classList.toggle('hidden', n === 0);
      }
      return n;
    } catch { return null; }
  }

  document.getElementById('btn-refetch-avatars')?.addEventListener('click', async () => {
    modalRefetch?.classList.remove('hidden');
    if (refetchLog) refetchLog.textContent = '';
    rLog('> 正在统计待补数量...');
    const n = await probeMissingCount();
    if (refetchRemaining) refetchRemaining.textContent = n === null ? '?' : n.toLocaleString();
    rLog(n === 0 ? '> 所有档案都有可用的图片来源，无需补图。' : `> 待补 ${n} 条，点击「开始补图」启动。`);
  });

  btnStopRefetch?.addEventListener('click', () => {
    refetchAbort = true;
    rLog('[STOP] 已请求停止，当前批次结束后收尾...', 'terminal-line-warn');
  });

  btnStartRefetch?.addEventListener('click', async () => {
    if (refetchRunning) return;
    refetchRunning = true;
    refetchAbort = false;
    btnStartRefetch.disabled = true;
    btnStopRefetch?.classList.remove('hidden');

    let done = 0, tomb = 0, failed = 0, rateStreak = 0;
    const startRemaining = parseInt((refetchRemaining?.textContent || '0').replace(/,/g, ''), 10) || 0;

    rLog(`[START] 开始补图，共 ${startRemaining} 条待处理`, 'terminal-line-info');

    while (!refetchAbort) {
      try {
        const res = await fetch('/api/admin/refetch-avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
          body: JSON.stringify({ all_missing: true, limit: 8, source: 'x' })
        });

        if (res.status === 401) { rLog('[ERROR] 会话已失效，请重新登录', 'terminal-line-error'); break; }

        const json = await res.json();
        if (!json.success) { rLog(`[ERROR] ${json.error}`, 'terminal-line-error'); break; }

        const rows = json.results || [];
        if (!rows.length) { rLog('[ALL DONE] 没有需要补图的记录了', 'terminal-line-success'); break; }

        for (const r of rows) {
          if (r.status === 'ok') {
            done++;
            rLog(`[R2] @${r.screen_name} 头像已归档`, 'terminal-line-r2');
          } else if (r.status === 'tombstoned') {
            tomb++;
            rLog(`[${r.is_suspended === 1 ? 'SUSPENDED' : 'DELETED'}] @${r.screen_name} ${r.message}`,
                 r.is_suspended === 1 ? 'terminal-line-suspended' : 'terminal-line-deleted');
          } else if (r.status === 'rate_limited') {
            rLog(`[WARN] @${r.screen_name} 命中速率限制，本批中止`, 'terminal-line-warn');
          } else {
            failed++;
            rLog(`[WARN] @${r.screen_name} ${r.status}: ${r.message || ''}`, 'terminal-line-warn');
          }
        }

        if (refetchDone) refetchDone.textContent = done.toLocaleString();
        if (refetchTomb) refetchTomb.textContent = tomb.toLocaleString();
        if (refetchRemaining) refetchRemaining.textContent = (json.remaining ?? 0).toLocaleString();
        if (refetchFill && startRemaining > 0) {
          refetchFill.style.width = `${Math.min(100, Math.round(((done + tomb + failed) / startRemaining) * 100))}%`;
        }

        if (json.remaining === 0) { rLog('[ALL DONE] 全部补完', 'terminal-line-success'); break; }

        // 命中速率限制就长冷却，别顶着限流继续打
        if (json.rate_limited) {
          rateStreak++;
          if (rateStreak >= 3) {
            rLog('[STOP] 连续 3 轮命中速率限制，已停止。稍后再点「开始补图」可从剩余部分继续。', 'terminal-line-warn');
            break;
          }
          const coolMin = 15 * rateStreak;
          rLog(`[POLICY] 命中 X 速率限制，冷却 ${coolMin} 分钟...`, 'terminal-line-warn');
          await new Promise(r => setTimeout(r, coolMin * 60000));
          continue;
        }
        rateStreak = 0;

        await new Promise(r => setTimeout(r, 8000));
      } catch (err) {
        rLog(`[ERROR] 请求异常: ${err.message}，20 秒后重试`, 'terminal-line-error');
        await new Promise(r => setTimeout(r, 20000));
      }
    }

    if (refetchAbort) rLog('[STOP] 已停止', 'terminal-line-warn');
    rLog(`[SUMMARY] 成功 ${done} · 墓碑 ${tomb} · 失败 ${failed}`, 'terminal-line-info');
    showToast(`补图结束：成功 ${done} 张`);

    refetchRunning = false;
    refetchAbort = false;
    btnStartRefetch.disabled = false;
    btnStopRefetch?.classList.add('hidden');
    await probeMissingCount();
    updateHudArchiveCount();
    loadBloggerVault();
  });

  // 关闭弹窗（复用现有 .btn-close-modal 约定）
  [modalAddBlogger, modalRefetch].forEach(modal => {
    modal?.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        if (modal === modalRefetch && refetchRunning) {
          showToast('补图进行中，如需中断请点「停止」');
          return;
        }
        modal.classList.add('hidden');
      });
    });
    modal?.addEventListener('click', (e) => {
      if (e.target !== modal) return;
      if (modal === modalRefetch && refetchRunning) return;
      modal.classList.add('hidden');
    });
  });

  // ── 发布公告 ────────────────────────────────────────────────
  //
  // 公告显示在每个访客页面顶部。**发布权限只在管理台**（/api/admin/announcements
  // 全部走 requireAdmin），普通登录用户没有任何写入入口。
  //
  // ⚠️ 列表渲染也必须 escapeHtml：管理台自己也可能被 XSS 打（比如另一个管理员
  // 存了恶意正文），预览区不转义就是自伤。
  const ANN_LEVEL = {
    info:   { text: '普通', cls: 'info' },
    warn:   { text: '提醒', cls: 'warn' },
    urgent: { text: '重要', cls: 'urgent' },
  };

  /**
   * datetime-local 的值 -> 带时区的完整 ISO。
   *
   * ⚠️ 必须在**浏览器侧**转。`<input type="datetime-local">` 给出的是
   * `2026-09-02T20:00`，**本地时间、不带时区**。服务端（Workers）跑在 UTC，
   * 拿到这个串只能猜，猜错就是整整一个时区的偏差 ——
   * 早先服务端直接补 'Z' 当 UTC 存，UTC+8 的"晚上 8 点"被存成本地次日 04:00，
   * 公告因此晚 8 小时才出现，表现为"公告消失了"。
   *
   * `new Date('2026-09-02T20:00')`（无时区）会被 JS 按**本地时区**解析，
   * 所以这一行就是正确转换。
   */
  function localInputToIso(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  /** ISO -> datetime-local 需要的 'YYYY-MM-DDTHH:mm'（本地时区） */
  function isoToLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function resetAnnForm() {
    document.getElementById('ann-edit-id').value = '';
    document.getElementById('ann-title').value = '';
    document.getElementById('ann-body').value = '';
    document.getElementById('ann-level').value = 'info';
    document.getElementById('ann-starts').value = '';
    document.getElementById('ann-ends').value = '';
    document.getElementById('ann-pinned').checked = false;
    document.querySelector('#btn-ann-submit span').textContent = '发布';
    document.getElementById('btn-ann-cancel')?.classList.add('hidden');
  }

  async function loadAnnouncements() {
    const list = document.getElementById('ann-admin-list');
    if (!list) return;
    list.innerHTML = '<div class="blogger-list-empty"><span>加载中...</span></div>';
    try {
      const res = await fetch('/api/admin/announcements', { headers: { 'x-admin-token': adminSessionToken } });
      const json = await res.json();
      if (!json.success) { list.innerHTML = `<div class="blogger-list-empty"><span>${escapeHtml(json.error || '读取失败')}</span></div>`; return; }
      if (!json.data.length) { list.innerHTML = '<div class="blogger-list-empty"><span>还没有公告。上面写好点「发布」。</span></div>'; return; }

      list.innerHTML = json.data.map((a) => {
        const lv = ANN_LEVEL[a.level] || ANN_LEVEL.info;
        const fmt = (t) => t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const window_ = [a.starts_at ? `${fmt(a.starts_at)} 起` : '', a.ends_at ? `${fmt(a.ends_at)} 止` : '']
          .filter(Boolean).join(' · ');
        // status 分四态，让站长一眼看出该点「重新上线」还是该改时间
        const ST = {
          live:      { text: '显示中',     cls: 'live' },
          offline:   { text: '已下线',     cls: 'off' },
          scheduled: { text: '等待定时开始', cls: 'off' },
          expired:   { text: '已过期下线',  cls: 'off' },
        }[a.status] || { text: a.live ? '显示中' : '未显示', cls: a.live ? 'live' : 'off' };
        return `
        <div class="ann-row ${a.live ? '' : 'is-off'}" data-id="${escapeHtml(a.id)}">
          <div class="ann-row-head">
            <span class="ann-badge ${lv.cls}">${lv.text}</span>
            ${a.pinned ? '<span class="ann-badge pin">置顶 · 每次访问都显示</span>' : ''}
            <span class="ann-badge ${ST.cls}">${ST.text}</span>
            ${a.title ? `<strong class="ann-row-title">${escapeHtml(a.title)}</strong>` : ''}
            <span style="flex:1"></span>
            <span class="ann-row-time">${fmt(a.created_at)}</span>
          </div>
          <div class="ann-row-body">${escapeHtml(a.body)}</div>
          ${window_ ? `<div class="ann-row-window">生效窗口：${escapeHtml(window_)}</div>` : ''}
          <div class="ann-row-actions">
            <button class="tagmgr-btn" data-act="edit">编辑</button>
            <button class="tagmgr-btn" data-act="pin">${a.pinned ? '取消置顶' : '置顶'}</button>
            ${a.status === 'live'
              ? '<button class="tagmgr-btn" data-act="toggle">下线</button>'
              : '<button class="tagmgr-btn" data-act="republish" title="重新上线并清空定时窗口，立即生效">重新上线</button>'}
            ${a.status === 'live' && !a.pinned
              ? '<button class="tagmgr-btn" data-act="renotify" title="内容不变，让已经关掉这条公告的访客再看到一次">重新提醒</button>'
              : ''}
            <button class="tagmgr-btn is-danger" data-act="del">删除</button>
          </div>
        </div>`;
      }).join('');
      // 缓存一份给编辑用，省一次请求
      list.dataset.cache = JSON.stringify(json.data);
    } catch (err) {
      list.innerHTML = `<div class="blogger-list-empty"><span>请求异常: ${escapeHtml(err.message)}</span></div>`;
    }
  }

  document.getElementById('form-ann')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-ann-submit');
    const id = document.getElementById('ann-edit-id').value;
    const payload = {
      title: document.getElementById('ann-title').value,
      body: document.getElementById('ann-body').value,
      level: document.getElementById('ann-level').value,
      pinned: document.getElementById('ann-pinned').checked,
      // 在这里转成带时区的 ISO —— 服务端无法知道你的时区
      starts_at: localInputToIso(document.getElementById('ann-starts').value),
      ends_at: localInputToIso(document.getElementById('ann-ends').value),
    };
    if (!payload.body.trim()) { showToast('公告正文不能为空'); return; }

    btn.disabled = true;
    try {
      const r = await fetch('/api/admin/announcements', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify(id ? { id, ...payload } : payload),
      }).then((x) => x.json());
      if (r.success) { showToast(r.message); resetAnnForm(); loadAnnouncements(); }
      else showToast(`失败: ${r.error}`);
    } catch (err) { showToast(`请求异常: ${err.message}`); }
    btn.disabled = false;
  });

  document.getElementById('btn-ann-cancel')?.addEventListener('click', resetAnnForm);
  document.getElementById('btn-refresh-ann')?.addEventListener('click', loadAnnouncements);

  document.getElementById('ann-admin-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.tagmgr-btn');
    if (!btn) return;
    const row = btn.closest('.ann-row');
    const id = row.dataset.id;
    const act = btn.getAttribute('data-act');
    const cache = JSON.parse(document.getElementById('ann-admin-list').dataset.cache || '[]');
    const a = cache.find((x) => x.id === id);

    if (act === 'edit') {
      if (!a) return;
      document.getElementById('ann-edit-id').value = a.id;
      document.getElementById('ann-title').value = a.title || '';
      document.getElementById('ann-body').value = a.body || '';
      document.getElementById('ann-level').value = a.level || 'info';
      document.getElementById('ann-pinned').checked = !!a.pinned;
      document.getElementById('ann-starts').value = isoToLocalInput(a.starts_at);
      document.getElementById('ann-ends').value = isoToLocalInput(a.ends_at);
      document.querySelector('#btn-ann-submit span').textContent = '保存修改';
      document.getElementById('btn-ann-cancel').classList.remove('hidden');
      document.getElementById('ann-body').focus();
      document.getElementById('form-ann').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // renotify / republish 由服务端一步处理，不用前端拼字段
    if (act === 'renotify' || act === 'republish') {
      btn.disabled = true;
      const r = await fetch('/api/admin/announcements', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify({ id, action: act }),
      }).then((x) => x.json());
      showToast(r.success ? r.message : `失败: ${r.error}`);
      loadAnnouncements();
      return;
    }

    const patch = act === 'pin' ? { pinned: !a?.pinned }
                : act === 'toggle' ? { is_active: !a?.is_active } : null;

    if (act === 'del') {
      if (!confirm(`删除这条公告？\n\n${(a?.body || '').slice(0, 60)}...\n\n不可恢复。若只是想暂时不显示，请用「下线」。`)) return;
      btn.disabled = true;
      const r = await fetch('/api/admin/announcements', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify({ id }),
      }).then((x) => x.json());
      showToast(r.success ? r.message : `失败: ${r.error}`);
      loadAnnouncements();
      return;
    }

    if (patch) {
      btn.disabled = true;
      const r = await fetch('/api/admin/announcements', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-token': adminSessionToken },
        body: JSON.stringify({ id, ...patch }),
      }).then((x) => x.json());
      showToast(r.success ? r.message : `失败: ${r.error}`);
      loadAnnouncements();
    }
  });

  // ── 投稿记录 ────────────────────────────────────────────────
  //
  // 首页投稿「无审核，提交即收录」是产品决定，但必须有个地方能看见都进了什么，
  // 否则唯一的发现途径是有人投了脏东西之后自己在画廊里翻出来。
  let subStatus = '';

  const SUB_LABEL = {
    accepted:  { text: '已收录', cls: 'ok' },
    duplicate: { text: '重复',   cls: 'dup' },
    rejected:  { text: '被拒',   cls: 'rej' },
    failed:    { text: '失败',   cls: 'err' },
  };

  async function loadSubmissions() {
    const list = document.getElementById('sub-list');
    const statsEl = document.getElementById('sub-stats');
    if (!list) return;
    list.innerHTML = '<div class="blogger-list-empty"><span>加载中...</span></div>';
    try {
      const res = await fetch(`/api/admin/submissions?limit=100${subStatus ? '&status=' + subStatus : ''}`,
        { headers: { 'x-admin-token': adminSessionToken } });
      const json = await res.json();
      if (!json.success) { list.innerHTML = `<div class="blogger-list-empty"><span>${escapeHtml(json.error || '读取失败')}</span></div>`; return; }

      const st = json.stats || {};
      statsEl.innerHTML = `
        <div class="sub-stat"><span class="ss-n">${st.accepted || 0}</span><span class="ss-l">已收录</span></div>
        <div class="sub-stat"><span class="ss-n">${st.duplicate || 0}</span><span class="ss-l">重复</span></div>
        <div class="sub-stat"><span class="ss-n">${st.rejected || 0}</span><span class="ss-l">被拒</span></div>
        <div class="sub-stat"><span class="ss-n">${st.failed || 0}</span><span class="ss-l">失败</span></div>
        <div class="sub-stat"><span class="ss-n">${st.submitters || 0}</span><span class="ss-l">投稿来源数</span></div>`;

      if (!json.data.length) {
        list.innerHTML = '<div class="blogger-list-empty"><span>暂无投稿记录</span></div>';
        return;
      }

      list.innerHTML = json.data.map((r) => {
        const lb = SUB_LABEL[r.status] || { text: r.status, cls: '' };
        const when = r.created_at
          ? new Date(r.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '';
        return `
          <div class="sub-row">
            <span class="sub-badge ${lb.cls}">${lb.text}</span>
            <a class="sub-handle" href="https://x.com/${escapeHtml(r.screen_name)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(r.screen_name)}</a>
            ${r.in_archive ? '<span class="sub-tag">在库</span>' : ''}
            ${r.visibility === 'private' ? '<span class="sub-tag">私密</span>' : ''}
            <span class="sub-reason">${escapeHtml(r.reason || '')}</span>
            <span class="sub-spacer"></span>
            <span class="sub-who" title="${r.submitter ? '登录用户投稿' : '匿名投稿，只显示 IP 哈希前 8 位'}">${
              r.submitter ? escapeHtml(r.submitter) : (r.ip_prefix ? 'ip:' + escapeHtml(r.ip_prefix) : '匿名')
            }</span>
            <span class="sub-when">${when}</span>
          </div>`;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="blogger-list-empty"><span>请求异常: ${escapeHtml(err.message)}</span></div>`;
    }
  }

  document.querySelectorAll('#sub-filter-tabs .filter-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sub-filter-tabs .filter-tab-btn')
        .forEach((b) => b.classList.toggle('active', b === btn));
      subStatus = btn.getAttribute('data-substatus') || '';
      loadSubmissions();
    });
  });
  document.getElementById('btn-refresh-submissions')?.addEventListener('click', loadSubmissions);

  // Initialize Admin Session & Realtime Latency Heartbeat
  checkAdminSession();
  setInterval(() => {
    if (adminSessionToken && !adminDashboardScreen.classList.contains('hidden')) {
      updateHudArchiveCount();
    }
  }, 15000);

  // 数据分析页自动刷新。
  // 原来只在切到该 Tab 时加载一次 —— 停在这个页面时，同步/补图/投稿产生的变化
  // 不会反映出来，看起来就像"数据不更新"。overview 有 15s 心跳，对比之下更明显。
  setInterval(() => {
    if (!adminSessionToken) return;
    if (adminDashboardScreen.classList.contains('hidden')) return;
    if (currentActiveTab !== 'analytics') return;
    if (document.visibilityState === 'hidden') return;  // 后台标签页不必刷
    loadAnalyticsDashboard();
  }, 20000);

});
