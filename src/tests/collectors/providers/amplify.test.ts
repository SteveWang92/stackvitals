import { describe, expect, it, vi } from 'vitest';
import { collectAmplifyStatus, type AmplifyClient } from '../../../collectors/providers/amplify';

function createClient(overrides: Partial<AmplifyClient> = {}): AmplifyClient {
  return {
    getApp: vi.fn().mockResolvedValue({
      app: {
        appId: 'app-123',
        name: 'Todo App',
        defaultDomain: 'main.example.amplifyapp.com',
        repository: 'https://github.example/repo',
        updateTime: '2026-06-27T00:00:00.000Z',
      },
    }),
    getBranch: vi.fn().mockResolvedValue({
      branch: {
        branchName: 'main',
        displayName: 'main',
        stage: 'PRODUCTION',
        enableAutoBuild: true,
        updateTime: '2026-06-27T00:00:00.000Z',
      },
    }),
    ...overrides,
  };
}

describe('collectAmplifyStatus', () => {
  it('collects app and branch resources for configured Amplify targets', async () => {
    const client = createClient();

    const result = await collectAmplifyStatus([{ projectSlug: 'todo_app', appId: 'app-123', branchName: 'main' }], { client });

    expect(result.status).toBe('success');
    expect(result.summary).toBe('1/1 Amplify targets collected.');
    expect(result.resources).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'amplify',
        resourceType: 'app',
        externalId: 'app-123',
        displayName: 'Todo App',
        metadata: {
          defaultDomain: 'main.example.amplifyapp.com',
          hasRepository: true,
          updateTime: '2026-06-27T00:00:00.000Z',
        },
      },
      {
        projectSlug: 'todo_app',
        provider: 'amplify',
        resourceType: 'branch',
        externalId: 'app-123:main',
        displayName: 'main',
        metadata: {
          appId: 'app-123',
          stage: 'PRODUCTION',
          enableAutoBuild: true,
          updateTime: '2026-06-27T00:00:00.000Z',
        },
      },
    ]);
    expect(result.metrics.map((metric) => metric.metricKey)).toEqual(['amplify_app_available', 'amplify_branch_available']);
    expect(result.errors).toHaveLength(0);
  });

  it('keeps development branches healthy when the target is available', async () => {
    const client = createClient({
      getBranch: vi.fn().mockResolvedValue({
        branch: {
          branchName: 'dev',
          stage: 'DEVELOPMENT',
        },
      }),
    });

    const result = await collectAmplifyStatus([{ projectSlug: 'acme_site', appId: 'app-123', branchName: 'dev' }], { client });

    expect(result.status).toBe('success');
    expect(result.metrics.find((metric) => metric.metricKey === 'amplify_branch_available')).toMatchObject({
      status: 'healthy',
      metadata: {
        branchName: 'dev',
        stage: 'DEVELOPMENT',
      },
    });
  });

  it('isolates target API failures without throwing', async () => {
    const client = createClient({
      getApp: vi.fn().mockRejectedValue(new Error('Amplify app not found')),
    });

    const result = await collectAmplifyStatus([{ projectSlug: 'recipe_box', appId: 'missing-app', branchName: 'main' }], { client });

    expect(result.status).toBe('failed');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'recipe_box',
        provider: 'amplify',
        metricKey: 'amplify_target_available',
        metricValue: 0,
        status: 'failed',
        metadata: {
          appId: 'missing-app',
          branchName: 'main',
        },
        collectedAt: expect.any(String),
      },
    ]);
    expect(result.errors).toEqual([
      {
        projectSlug: 'recipe_box',
        message: 'Amplify app not found',
        retryable: true,
      },
    ]);
  });

  it('skips cleanly when there are no configured targets', async () => {
    const result = await collectAmplifyStatus([], { client: createClient() });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No Amplify targets configured.');
    expect(result.resources).toHaveLength(0);
    expect(result.metrics).toHaveLength(0);
  });
});
