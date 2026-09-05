/**
 * GET /api/admin/workflow-status[?run_id=]
 *   -> { success, run_id, status, conclusion, logs, is_active }
 *
 *
 * logs 是**整段字符串**。客户端用 knownLogLines Set 自行去重增量输出
 * (admin.js:876), 所以这里每次回全量日志即可, 服务端不必做增量。
 *
 * 不带 run_id 时用于"页面刷新后重连正在跑的任务", 需要回 is_active。
 */
import { ok, fail } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/auth.js';

const GH = 'https://api.github.com';
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return fail('未授权', 401);

  if (!env.GITHUB_PAT || !env.GITHUB_REPO) {
    return fail('服务端未配置 GITHUB_PAT / GITHUB_REPO', 503);
  }

  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WORKFLOW_FILE || 'full-sync.yml';
  const runIdParam = new URL(request.url).searchParams.get('run_id');

  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${env.GITHUB_PAT}`,
    'user-agent': 'x-vault',
    'x-github-api-version': '2022-11-28',
  };

  try {
    let run;
    if (runIdParam) {
      const res = await fetch(`${GH}/repos/${repo}/actions/runs/${encodeURIComponent(runIdParam)}`, { headers });
      if (!res.ok) return fail(`查询 run 失败 (${res.status})`);
      run = await res.json();
    } else {
      const res = await fetch(`${GH}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`, { headers });
      if (!res.ok) return fail(`查询 runs 失败 (${res.status})`);
      run = (await res.json()).workflow_runs?.[0];
    }

    if (!run) return ok({ run_id: null, status: null, is_active: false, logs: '' });

    const isActive = ACTIVE.has(run.status);
    const logs = await fetchJobLogs(repo, run.id, headers);

    return ok({
      run_id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      is_active: isActive,
      html_url: run.html_url,
      started_at: run.run_started_at,
      logs,
    });
  } catch (err) {
    return fail(`状态查询异常: ${err.message}`, 500);
  }
}

/**
 * GitHub 的 run 日志压缩包要等任务结束才可下载, 所以运行中改用 jobs/steps 状态
 * 合成日志行 —— 这样终端 UI 在任务进行期间也有东西可显示。
 */
async function fetchJobLogs(repo, runId, headers) {
  try {
    const res = await fetch(`${GH}/repos/${repo}/actions/runs/${runId}/jobs?per_page=20`, { headers });
    if (!res.ok) return '';
    const { jobs = [] } = await res.json();
    const lines = [];
    for (const job of jobs) {
      lines.push(`[GITHUB ACTIONS] Job ${job.name}: ${job.status}${job.conclusion ? ` (${job.conclusion})` : ''}`);
      for (const step of job.steps || []) {
        if (step.status === 'completed') {
          const tag = step.conclusion === 'success' ? '[SUCCESS]' : '[WARN]';
          lines.push(`${tag} ${step.number}. ${step.name} — ${step.conclusion}`);
        } else if (step.status === 'in_progress') {
          lines.push(`[PROGRESS] ${step.number}. ${step.name} — 执行中`);
        }
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}
