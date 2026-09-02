/**
 * POST /api/admin/trigger-action  { action: 'full_sync' }
 *   -> { success, message, run_id, actions_url }
 *
 * 契约见 _reference/spec/03-api-contract.md §3.10
 *
 * 派发 GitHub Actions 的全量刷新。为什么不在 Worker 里跑: 332 人 × (查询 + 两张图)
 * 远超 Workers 的 CPU/时长限额, 且需要 cron 与密钥托管。见 05-sync-pipeline.md §10。
 */
import { ok, fail } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

const ACTIONS = { full_sync: 'full-sync.yml' };
const GH = 'https://api.github.com';

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  if (!env.GITHUB_PAT || !env.GITHUB_REPO) {
    return fail('服务端未配置 GITHUB_PAT / GITHUB_REPO, 无法派发云端任务', 503);
  }

  let body = {};
  try {
    body = await request.json();
  } catch { /* 默认 full_sync */ }

  const action = String(body?.action || 'full_sync');
  const workflow = ACTIONS[action] || env.GITHUB_WORKFLOW_FILE;
  if (!workflow) return fail(`未知 action: ${action}`);

  const repo = env.GITHUB_REPO; // owner/repo
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${env.GITHUB_PAT}`,
    'user-agent': 'x-vault',
    'x-github-api-version': '2022-11-28',
  };

  try {
    const ref = env.GITHUB_BRANCH || 'main';
    const dispatch = await fetch(`${GH}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ref }),
    });

    if (dispatch.status !== 204) {
      const text = await dispatch.text();
      return fail(`GitHub 派发失败 (${dispatch.status}): ${text.slice(0, 300)}`);
    }

    // dispatch 不返回 run_id, 需要回查最近一次 run。给 GitHub 一点建立 run 的时间。
    await new Promise((r) => setTimeout(r, 2500));
    let runId = null;
    try {
      const runs = await fetch(
        `${GH}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1&event=workflow_dispatch`,
        { headers }
      );
      if (runs.ok) {
        const data = await runs.json();
        runId = data.workflow_runs?.[0]?.id ?? null;
      }
    } catch { /* 拿不到 run_id 不算失败, 前端会退化成无 id 轮询 */ }

    return ok({
      message: '全量数据深度刷新已派发至云端',
      run_id: runId,
      actions_url: `https://github.com/${repo}/actions`,
    });
  } catch (err) {
    return fail(`派发异常: ${err.message}`, 500);
  }
}
