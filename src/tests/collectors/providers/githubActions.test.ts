import { describe, expect, it, vi } from 'vitest';
import { collectGitHubActionsUsage, type GitHubActionsClient } from '../../../collectors/providers/githubActions';

function createClient(overrides: Partial<GitHubActionsClient> = {}): GitHubActionsClient {
  return {
    listWorkflowRuns: vi.fn().mockResolvedValue([
      {
        id: 102,
        workflowId: 10,
        workflowName: 'CI',
        status: 'completed',
        conclusion: 'failure',
        event: 'push',
        branch: 'dev',
        runStartedAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:04:00.000Z',
      },
      {
        id: 101,
        workflowId: 11,
        workflowName: 'Collect project status',
        status: 'completed',
        conclusion: 'success',
        event: 'schedule',
        branch: 'main',
        runStartedAt: '2026-06-28T15:17:00.000Z',
        updatedAt: '2026-06-28T15:19:00.000Z',
      },
    ]),
    ...overrides,
  };
}

describe('collectGitHubActionsUsage', () => {
  it('collects aggregate workflow run status and usage for configured repositories', async () => {
    const client = createClient();

    const result = await collectGitHubActionsUsage([{ projectSlug: 'status_hub', owner: 'example', repo: 'status-hub' }], {
      client,
      now: new Date('2026-06-30T00:00:00.000Z'),
      lookbackDays: 7,
      runLimit: 25,
    });

    expect(client.listWorkflowRuns).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'status-hub',
      since: '2026-06-23T00:00:00.000Z',
      limit: 25,
    });
    expect(result.status).toBe('partial_success');
    expect(result.summary).toBe('1/1 GitHub Actions repositories collected.');
    expect(result.resources).toEqual([
      {
        projectSlug: 'status_hub',
        provider: 'github',
        resourceType: 'repository',
        externalId: 'example/status-hub',
        displayName: 'example/status-hub',
        metadata: {
          aggregateOnly: true,
        },
      },
      {
        projectSlug: 'status_hub',
        provider: 'github',
        resourceType: 'workflow',
        externalId: 'example/status-hub:10',
        displayName: 'CI',
        metadata: {
          workflowId: 10,
          latestStatus: 'completed',
          latestConclusion: 'failure',
          latestBranch: 'dev',
          latestEvent: 'push',
          latestRunStartedAt: '2026-06-29T00:00:00.000Z',
          aggregateOnly: true,
        },
      },
      {
        projectSlug: 'status_hub',
        provider: 'github',
        resourceType: 'workflow',
        externalId: 'example/status-hub:11',
        displayName: 'Collect project status',
        metadata: {
          workflowId: 11,
          latestStatus: 'completed',
          latestConclusion: 'success',
          latestBranch: 'main',
          latestEvent: 'schedule',
          latestRunStartedAt: '2026-06-28T15:17:00.000Z',
          aggregateOnly: true,
        },
      },
    ]);
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'github',
          metricKey: 'github_actions_recent_run_count',
          metricValue: 2,
          status: 'healthy',
        }),
        expect.objectContaining({
          metricKey: 'github_actions_recent_failure_count',
          metricValue: 1,
          status: 'failed',
        }),
        expect.objectContaining({
          metricKey: 'github_actions_recent_duration_seconds',
          metricValue: 360,
        }),
        expect.objectContaining({
          metricKey: 'github_actions_scheduled_run_count',
          metricValue: 1,
          status: 'healthy',
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('commit');
  });

  it('keeps repositories with no recent runs informational', async () => {
    const result = await collectGitHubActionsUsage([{ projectSlug: 'todo_app', owner: 'example', repo: 'todo-app' }], {
      client: createClient({ listWorkflowRuns: vi.fn().mockResolvedValue([]) }),
      now: new Date('2026-06-30T00:00:00.000Z'),
    });

    expect(result.status).toBe('success');
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'github_actions_recent_run_count',
          metricValue: 0,
          status: 'healthy',
        }),
        expect.objectContaining({
          metricKey: 'github_actions_latest_run_status',
          metricValue: undefined,
          status: 'unknown',
        }),
        expect.objectContaining({
          metricKey: 'github_actions_scheduled_run_count',
          metricValue: 0,
          status: 'healthy',
        }),
      ]),
    );
    expect(result.errors).toHaveLength(0);
  });

  it('isolates repository API failures without throwing', async () => {
    const result = await collectGitHubActionsUsage([{ projectSlug: 'recipe_box', owner: 'example', repo: 'recipe-box' }], {
      client: createClient({ listWorkflowRuns: vi.fn().mockRejectedValue(new Error('repository not found')) }),
    });

    expect(result.status).toBe('failed');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'recipe_box',
        provider: 'github',
        metricKey: 'github_actions_repository_available',
        metricValue: 0,
        status: 'failed',
        metadata: {
          repository: 'example/recipe-box',
          aggregateOnly: true,
          owner: 'example',
          repo: 'recipe-box',
        },
        collectedAt: expect.any(String),
      },
    ]);
    expect(result.errors).toEqual([
      {
        projectSlug: 'recipe_box',
        message: 'repository not found',
        retryable: true,
      },
    ]);
  });

  it('reports the latest completed run status instead of an in-progress run', async () => {
    const client = createClient({
      listWorkflowRuns: vi.fn().mockResolvedValue([
        {
          id: 103,
          workflowId: 11,
          workflowName: 'Collect project status',
          status: 'in_progress',
          conclusion: null,
          event: 'schedule',
          branch: 'main',
          runStartedAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
        },
        {
          id: 101,
          workflowId: 11,
          workflowName: 'Collect project status',
          status: 'completed',
          conclusion: 'success',
          event: 'schedule',
          branch: 'main',
          runStartedAt: '2026-06-28T15:17:00.000Z',
          updatedAt: '2026-06-28T15:19:00.000Z',
        },
      ]),
    });

    const result = await collectGitHubActionsUsage([{ projectSlug: 'status_hub', owner: 'example', repo: 'status-hub' }], {
      client,
      now: new Date('2026-06-30T00:05:00.000Z'),
      lookbackDays: 7,
      runLimit: 25,
    });

    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'github_actions_latest_run_status',
          status: 'healthy',
          metadata: expect.objectContaining({ status: 'completed', conclusion: 'success', runStartedAt: '2026-06-28T15:17:00.000Z' }),
        }),
      ]),
    );
  });

  it('skips cleanly when there are no configured repositories', async () => {
    const result = await collectGitHubActionsUsage([], { client: createClient() });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No GitHub Actions targets configured.');
    expect(result.resources).toHaveLength(0);
    expect(result.metrics).toHaveLength(0);
  });
});
