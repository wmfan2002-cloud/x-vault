import assert from 'node:assert/strict';
import test from 'node:test';
import { openAdmin, waitFor } from './helpers/admin-dom.mjs';

test('workflow reconnect, log deduplication, progress, cooldown, wait and completion', async t => {
  let workflow = {
    success: true, is_active: true, run_id: 42, status: 'in_progress',
    logs: 'Run actions/checkout\n2026-01-15T12:00:00.000Z [PROGRESS] 已累计深度巡检: 25 人 | 库中总博主数: 100 人\n[PROGRESS] 已累计深度巡检: 25 人 | 库中总博主数: 100 人',
  };
  const ui = await openAdmin({ respond: call => call.path === '/api/admin/workflow-status' ? { body: workflow } : null });
  t.after(ui.close);
  const get = id => ui.document.getElementById(id);
  const status = () => get('sync-progress-status-text').textContent;
  await waitFor(() => status() === '全量巡检进行中 (25 人已核对)...', 'workflow reconnect');
  assert.equal(get('sync-progress-fill').style.width, '25%');
  assert.equal(get('sync-progress-count-text').textContent, '25 / 100 人 (25%)');
  assert.equal(get('terminal-log-output').textContent.split('已累计深度巡检').length - 1, 1);
  assert.equal(get('terminal-log-output').textContent.includes('Run actions/'), false);
  assert.equal(get('btn-trigger-gh-full-sync').disabled, true);
  assert.equal([...ui.intervals.values()].filter(x => x.delay === 3000).length, 1);

  for (const [log, expectedStatus, expectedCount, expectedWidth] of [
    ['[PROGRESS] 已累计深度巡检: 150 人 | 库中总博主数: 100 人', '全量巡检进行中 (150 人已核对)...', '150 / 100 人 (98%)', '98%'],
    ['[COOLDOWN] 剩余 7 分钟', '🛡️ 已触发 15 分钟安全冷却 (剩余 7 分钟)，正在重置 X 频控桶...', '冷却中 (剩余 7 分钟)', '98%'],
    ['[WAIT] 休眠 2.5 秒', '⏳ 拟人安全间隔中 (休眠 2.5s)...', '冷却中 (剩余 7 分钟)', '98%'],
    ['[PAGE] 正在深度刷新第 3 页', '[PAGE] 正在深度刷新第 3 页', '冷却中 (剩余 7 分钟)', '98%'],
    ['[PROGRESS] incomplete [WAIT]', '[PAGE] 正在深度刷新第 3 页', '冷却中 (剩余 7 分钟)', '98%'],
  ]) {
    workflow = { ...workflow, logs: log };
    await ui.tick(3000);
    assert.equal(status(), expectedStatus);
    assert.equal(get('sync-progress-count-text').textContent, expectedCount);
    assert.equal(get('sync-progress-fill').style.width, expectedWidth);
  }
  workflow = { ...workflow, logs: '', status: 'completed', conclusion: 'success' };
  await ui.tick(3000);
  assert.equal(status(), '云端全量数据深度刷新已圆满完成！(Run #42)');
  assert.equal(get('sync-progress-fill').style.width, '100%');
  assert.equal(get('btn-trigger-gh-full-sync').disabled, false);
  assert.equal([...ui.intervals.values()].some(x => x.delay === 3000), false);
  assert.ok(ui.calls.some(x => x.search.get('run_id') === '42'));
  assert.deepEqual(ui.errors, []);
});

test('workflow failed completion restores controls and preserves failure feedback', async t => {
  let completed = false;
  const ui = await openAdmin({ respond: call => call.path === '/api/admin/workflow-status' ? {
    body: { success: true, is_active: true, run_id: 17, status: completed ? 'completed' : 'queued', conclusion: 'failure' },
  } : null });
  t.after(ui.close);
  await waitFor(() => ui.document.getElementById('btn-trigger-gh-full-sync').disabled, 'workflow running');
  completed = true;
  await ui.tick(3000);
  assert.equal(ui.document.getElementById('sync-progress-status-text').textContent, '云端任务结束: failure');
  assert.equal(ui.document.getElementById('sync-progress-count-text').textContent, '异常中断');
  assert.equal(ui.document.getElementById('btn-trigger-gh-full-sync').disabled, false);
  assert.deepEqual(ui.errors, []);
});

test('analytics retains ranking, empty charts, tooltip labels and instance replacement', async t => {
  const rows = [
    { screen_name: 'beta', name: 'B < &', avatar_url: '', followers_count: 5000, total_clicks: 3, clicks_card: 1, clicks_timeline: 1 },
    { screen_name: 'alpha', name: 'A', avatar_url: '/logo-icon.png', followers_count: 900000, total_clicks: 10, clicks_card: 6, clicks_timeline: 3, verified: 1 },
  ];
  let empty = false;
  const ui = await openAdmin({ tab: 'analytics', respond: call => call.path === '/api/admin/analytics' ? { body: {
    success: true, kpi: empty ? {} : { total: 2, total_clicks: 13, clicks_card: 7, clicks_timeline: 4, clicks_roulette: 2, blocked: 1, verified: 1 },
    tiers: empty ? {} : { t500k: 1, tsmall: 1 }, topClicked: empty ? [] : rows, topFollowers: empty ? [] : rows,
  } } : null });
  t.after(ui.close);
  await waitFor(() => ui.charts.length === 3, 'three charts');
  const { document } = ui;
  assert.deepEqual([...document.querySelectorAll('#analytics-click-top-list .leaderboard-handle')].map(x => x.textContent), ['@alpha', '@beta']);
  assert.equal(document.querySelector('#analytics-followers-top-list .leaderboard-followers-badge').textContent.trim(), '900K');
  assert.equal(document.querySelectorAll('#analytics-click-top-list use[href$="#badge-verified"]').length, 1);
  assert.equal(document.querySelector('#analytics-click-top-list .rank-2 .leaderboard-name').textContent, 'B < &');
  const link = document.querySelector('#analytics-click-top-list a');
  assert.equal(link.getAttribute('href'), 'https://x.com/alpha');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.deepEqual([...document.querySelectorAll('#analytics-click-top-list .rank-1 .leaderboard-source-seg')].map(x => x.style.width), ['60%', '30%', '10%']);
  const [clicks, tiers, health] = ui.charts.map(x => x.config);
  assert.equal(clicks.options.cutout, '72%');
  assert.equal(health.options.cutout, '68%');
  assert.equal(tiers.options.indexAxis, 'y');
  assert.equal(clicks.options.plugins.tooltip.callbacks.label({ raw: 7, label: '画廊主页卡片' }), ' 画廊主页卡片: 7 次 (54%)');
  assert.equal(tiers.options.plugins.tooltip.callbacks.label({ raw: 2 }), ' 博主数量: 2 位');
  assert.equal(health.options.plugins.tooltip.callbacks.label({ raw: 1, label: '已屏蔽' }), ' 已屏蔽: 1 位');
  assert.notEqual(clicks.options.plugins.tooltip, health.options.plugins.tooltip);

  empty = true;
  document.getElementById('tab-btn-analytics').click();
  await waitFor(() => ui.charts.length === 6, 'refresh charts');
  assert.ok(ui.charts.slice(0, 3).every(x => x.destroyed));
  assert.equal(document.querySelector('#analytics-click-top-list .leaderboard-row'), null);
  assert.ok(document.getElementById('analytics-click-top-list').textContent.includes('本站点击热度正在累积中'));
  assert.equal(document.getElementById('analytics-followers-top-list').textContent, '暂无博主数据');
  assert.deepEqual(Array.from(ui.charts[3].config.data.datasets[0].data), [1, 1, 1]);
  assert.deepEqual(Array.from(ui.charts[5].config.data.datasets[0].data), [1, 0, 0, 0]);
  assert.equal(ui.charts[3].config.options.plugins.tooltip.callbacks.label({}), ' 暂无点击记录');
  assert.deepEqual(ui.errors, []);
});

test('export and add dialogs preserve copy, validation, pending and completion states', async t => {
  let finishAdd;
  const ui = await openAdmin({ tab: 'bloggers', respond: call => {
    if (call.path === '/api/admin/blogger' && call.method === 'PUT') {
      assert.deepEqual(call.body, { screen_name: 'alice' });
      return new Promise(resolve => { finishAdd = resolve; });
    }
    if (call.path === '/api/admin/bloggers' && call.search.get('limit') === '1000') {
      return { body: { success: true, data: [{ screen_name: 'alice' }, {}, { screen_name: 'bob' }] } };
    }
    return null;
  } });
  t.after(ui.close);
  const get = id => ui.document.getElementById(id);
  get('btn-export-handles').click();
  await waitFor(() => get('export-handles-textarea').value === 'alice\nbob', 'export handles');
  assert.equal(get('modal-export-handles').classList.contains('hidden'), false);
  get('btn-copy-export-handles').click();
  assert.deepEqual(ui.copied, ['alice\nbob']);
  get('btn-close-export-modal').click();
  assert.equal(get('modal-export-handles').classList.contains('hidden'), true);

  get('btn-add-blogger').click();
  get('form-add-blogger').dispatchEvent(new ui.window.Event('submit', { cancelable: true }));
  assert.equal(get('add-blogger-result').textContent, '请填写 handle');
  get('input-add-handle').value = 'alice';
  get('form-add-blogger').dispatchEvent(new ui.window.Event('submit', { cancelable: true }));
  await waitFor(() => !!finishAdd, 'add request');
  assert.equal(get('btn-submit-add-blogger').disabled, true);
  assert.equal(get('add-blogger-result').textContent, '正在从 X 抓取资料与媒体...');
  finishAdd({ body: { success: true, blogger: { screen_name: 'alice', name: 'Alice', followers_count: 1200 }, message: '已归档 alice' } });
  await waitFor(() => !get('btn-submit-add-blogger').disabled, 'add response');
  assert.ok(get('add-blogger-result').textContent.includes('已归档 @alice（Alice）'));
  assert.equal(get('input-add-handle').value, '');
  get('modal-add-blogger').querySelector('.btn-close-modal').click();
  assert.equal(get('modal-add-blogger').classList.contains('hidden'), true);
  assert.deepEqual(ui.errors, []);
});

test('block and unblock preserve badges, counters, filtered removal and rollback', async t => {
  let blocked = false;
  let rejectNext = false;
  const ui = await openAdmin({ tab: 'bloggers', respond: call => {
    if (call.path !== '/api/admin/bloggers') return null;
    if (call.method === 'POST') {
      if (rejectNext) return { body: { success: false, error: 'fixture failure' } };
      blocked = call.body.is_blocked === 1;
      return { body: { success: true, message: 'fixture updated' } };
    }
    return { body: {
      success: true, data: [{ screen_name: 'alice', name: 'Alice', is_blocked: blocked ? 1 : 0, my_visibility: 'public', in_gallery: blocked ? 0 : 1 }],
      total: 1, page: 1, limit: 30, totalPages: 1,
      stats: { total: 1, in_gallery: blocked ? 0 : 1, blocked: blocked ? 1 : 0, mine_private: 0 },
    } };
  } });
  t.after(ui.close);
  const get = id => ui.document.getElementById(id);
  const row = () => get('blogger-row-alice');
  const button = () => row()?.querySelector('.btn-action-block');
  await waitFor(() => get('tab-count-active').textContent === '1', 'initial counts');
  button().click();
  await waitFor(() => get('tab-count-blocked').textContent === '1', 'blocked count');
  assert.equal(row().classList.contains('is-blocked'), true);
  assert.equal(row().querySelectorAll('.badge-blocked-tag').length, 1);
  assert.equal(button().textContent.trim(), '解除下架');
  button().click();
  await waitFor(() => get('tab-count-active').textContent === '1', 'unblocked count');
  assert.equal(row().querySelector('.badge-blocked-tag'), null);
  assert.equal(button().getAttribute('data-blocked'), '0');

  rejectNext = true;
  button().click();
  await waitFor(() => !!row() && !row().classList.contains('is-blocked'), 'failure reload');
  assert.ok(get('toast-container').textContent.includes('操作失败: fixture failure'));
  rejectNext = false;
  ui.document.querySelector('[data-status="in_gallery"]').click();
  await waitFor(() => !!button(), 'filtered list');
  button().click();
  assert.equal(row().classList.contains('is-collapsing'), true);
  await waitFor(() => !row(), 'row collapse');
  assert.ok(get('blogger-list-container').textContent.includes('当前筛选下暂无博主档案'));
  assert.deepEqual(ui.errors, []);
});

test('refetch modal preserves running guard, progress, stop and summary', async t => {
  let finishBatch;
  const ui = await openAdmin({ respond: call => {
    if (call.path !== '/api/admin/refetch-avatar') return null;
    if (!call.body.all_missing) return { body: { success: true, remaining: 3 } };
    return new Promise(resolve => { finishBatch = resolve; });
  } });
  t.after(ui.close);
  const get = id => ui.document.getElementById(id);
  get('btn-refetch-avatars').click();
  await waitFor(() => get('refetch-remaining').textContent === '3', 'remaining avatars');
  get('btn-start-refetch').click();
  await waitFor(() => !!finishBatch, 'refetch pending');
  assert.equal(get('btn-start-refetch').disabled, true);
  get('modal-refetch').querySelector('.btn-close-modal').click();
  assert.equal(get('modal-refetch').classList.contains('hidden'), false);
  assert.ok(get('toast-container').textContent.includes('补图进行中，如需中断请点「停止」'));
  get('btn-stop-refetch').click();
  assert.ok(get('refetch-log').textContent.includes('[STOP] 已请求停止'));
  finishBatch({ body: { success: true, remaining: 0, results: [
    { screen_name: 'a', status: 'ok' },
    { screen_name: 'b', status: 'tombstoned', is_suspended: 1, message: 'suspended' },
    { screen_name: 'c', status: 'failed', message: 'unavailable' },
  ] } });
  await waitFor(() => !get('btn-start-refetch').disabled, 'refetch complete');
  assert.equal(get('refetch-progress-fill').style.width, '100%');
  assert.equal(get('refetch-done').textContent, '1');
  assert.equal(get('refetch-tomb').textContent, '1');
  assert.ok(get('refetch-log').textContent.includes('[SUMMARY] 成功 1 · 墓碑 1 · 失败 1'));
  assert.equal(get('btn-stop-refetch').classList.contains('hidden'), true);
  get('modal-refetch').querySelector('.btn-close-modal').click();
  assert.equal(get('modal-refetch').classList.contains('hidden'), true);
  assert.deepEqual(ui.errors, []);
});
