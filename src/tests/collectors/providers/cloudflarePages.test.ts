import { describe, expect, it, vi } from 'vitest';
import {
  collectCloudflarePages,
  type CloudflarePagesClient,
  type CloudflarePagesDeployment,
} from '../../../collectors/providers/cloudflarePages';

function deployment(overrides: Partial<CloudflarePagesDeployment> = {}): CloudflarePagesDeployment {
  return {
    id: 'deploy-1',
    url: 'https://abc123.my-project.pages.dev',
    environment: 'production',
    latestStage: { name: 'deploy', status: 'success' },
    createdOn: '2026-07-01T00:00:00Z',
    modifiedOn: '2026-07-01T00:05:00Z',
    branch: 'main',
    commitMessage: 'Update index.html',
    ...overrides,
  };
}

function createClient(result: CloudflarePagesDeployment | null | Error = deployment()): CloudflarePagesClient {
  return {
    getLatestProductionDeployment: result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
  };
}

const target = { projectSlug: 'my_app' as const, projectName: 'my-project' };

describe('collectCloudflarePages', () => {
  it('reports healthy when latest production deploy succeeded', async () => {
    const client = createClient();

    const result = await collectCloudflarePages([target], { client });

    expect(client.getLatestProductionDeployment).toHaveBeenCalledWith('my-project');
    expect(result.status).toBe('success');
    expect(result.summary).toBe('1/1 Cloudflare Pages projects collected.');
    expect(result.adapterKey).toBe('cloudflare_pages');

    const metric = result.metrics.find((m) => m.metricKey === 'cloudflare_pages_deploy_status');
    expect(metric).toBeDefined();
    expect(metric!.status).toBe('healthy');
    expect(metric!.metricValue).toBe(1);
    expect(metric!.metadata).toMatchObject({
      deploymentId: 'deploy-1',
      branch: 'main',
      stageStatus: 'success',
    });

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].resourceType).toBe('pages_project');
    expect(result.resources[0].externalId).toBe('my-project');
  });

  it('reports failed when latest production deploy failed', async () => {
    const client = createClient(deployment({ latestStage: { name: 'build', status: 'failure' } }));

    const result = await collectCloudflarePages([target], { client });

    const metric = result.metrics.find((m) => m.metricKey === 'cloudflare_pages_deploy_status');
    expect(metric!.status).toBe('failed');
    expect(metric!.metricValue).toBe(1);
    expect(metric!.metadata).toMatchObject({ stageName: 'build', stageStatus: 'failure' });
  });

  it('reports warning when deploy is in progress', async () => {
    const client = createClient(deployment({ latestStage: { name: 'build', status: 'active' } }));

    const result = await collectCloudflarePages([target], { client });

    const metric = result.metrics.find((m) => m.metricKey === 'cloudflare_pages_deploy_status');
    expect(metric!.status).toBe('warning');
    expect(metric!.metricValue).toBe(1);
  });

  it('reports failed when deploy was canceled', async () => {
    const client = createClient(deployment({ latestStage: { name: 'build', status: 'canceled' } }));

    const result = await collectCloudflarePages([target], { client });

    const metric = result.metrics.find((m) => m.metricKey === 'cloudflare_pages_deploy_status');
    expect(metric!.status).toBe('failed');
  });

  it('reports unknown when no production deployments exist', async () => {
    const client = createClient(null);

    const result = await collectCloudflarePages([target], { client });

    expect(result.status).toBe('success');

    const metric = result.metrics.find((m) => m.metricKey === 'cloudflare_pages_deploy_status');
    expect(metric!.status).toBe('unknown');
    expect(metric!.metricValue).toBeUndefined();
    expect(metric!.metadata).toMatchObject({ reason: 'no_production_deployments' });
  });

  it('handles API errors with a failed metric and error entry', async () => {
    const client = createClient(new Error('API timeout'));

    const result = await collectCloudflarePages([target], { client });

    expect(result.status).toBe('failed');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('API timeout');
    expect(result.errors[0].retryable).toBe(true);

    const metric = result.metrics.find((m) => m.metricKey === 'cloudflare_pages_deploy_status');
    expect(metric!.status).toBe('failed');
    expect(metric!.metricValue).toBe(0);
  });

  it('reports partial_success when one target succeeds and another fails', async () => {
    const client: CloudflarePagesClient = {
      getLatestProductionDeployment: vi.fn().mockResolvedValueOnce(deployment()).mockRejectedValueOnce(new Error('not found')),
    };

    const result = await collectCloudflarePages([target, { projectSlug: 'other_app', projectName: 'other-project' }], { client });

    expect(result.status).toBe('partial_success');
    expect(result.summary).toBe('1/2 Cloudflare Pages projects collected.');
    expect(result.metrics).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });

  it('returns skipped summary when no targets configured', async () => {
    const client = createClient();

    const result = await collectCloudflarePages([], { client });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No Cloudflare Pages projects configured.');
    expect(result.metrics).toHaveLength(0);
  });
});
