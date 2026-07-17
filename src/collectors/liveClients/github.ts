import type { GitHubActionsClient, GitHubWorkflowRun } from '../providers/githubActions';

interface GitHubWorkflowRunResponseItem {
  id?: number;
  workflow_id?: number;
  name?: string | null;
  display_title?: string | null;
  status?: string | null;
  conclusion?: string | null;
  event?: string | null;
  head_branch?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs?: GitHubWorkflowRunResponseItem[];
}

function requestUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`https://api.github.com${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeRun(run: GitHubWorkflowRunResponseItem): GitHubWorkflowRun {
  return {
    id: run.id ?? 0,
    workflowId: run.workflow_id ?? 0,
    workflowName: run.name?.trim() || run.display_title?.trim() || 'unknown_workflow',
    status: run.status?.trim() || 'unknown',
    conclusion: run.conclusion?.trim() || null,
    event: run.event?.trim() || 'unknown',
    branch: run.head_branch?.trim() || 'unknown_branch',
    runStartedAt: run.run_started_at ?? null,
    updatedAt: run.updated_at ?? null,
  };
}

export function createLiveGitHubActionsClient(token: string): GitHubActionsClient {
  async function request<T>(path: string, params?: Record<string, string | number | undefined>, allowMissing = false): Promise<T | null> {
    const response = await fetch(requestUrl(path, params), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'stackvitals',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const text = await response.text();

    if (!response.ok) {
      if (allowMissing && (response.status === 403 || response.status === 404)) {
        return null;
      }

      const detail = text.trim() ? `: ${text.slice(0, 500)}` : '';
      throw new Error(`GitHub API request failed with ${response.status}${detail}`);
    }

    return JSON.parse(text) as T;
  }

  return {
    listWorkflowRuns: async ({ owner, repo, since, limit }) => {
      const response = await request<GitHubWorkflowRunsResponse>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/actions/runs`,
        {
          per_page: limit,
          created: `>=${since}`,
        },
      );

      return (response?.workflow_runs ?? []).map(normalizeRun);
    },
    listWorkflowRunsForWorkflow: async ({ owner, repo, workflow, limit }) => {
      const response = await request<GitHubWorkflowRunsResponse>(
        `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/actions/workflows/${encodePathSegment(workflow)}/runs`,
        { per_page: limit },
        true,
      );

      if (response === null) {
        return null;
      }

      return (response.workflow_runs ?? []).map(normalizeRun);
    },
  };
}
