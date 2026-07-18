import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDashboardData } from '../../services/dashboardData';

type TableName = 'projects' | 'resources' | 'metric_snapshots' | 'cost_snapshots' | 'health_checks' | 'collector_runs';

interface MockQuery<T> extends PromiseLike<{ data: T[]; error: null }> {
  select: () => MockQuery<T>;
  eq: () => MockQuery<T>;
  order: () => MockQuery<T>;
  limit: () => MockQuery<T>;
}

function query<T>(data: T[]): MockQuery<T> {
  return {
    select: () => query(data),
    eq: () => query(data),
    order: () => query(data),
    limit: () => query(data),
    then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
  };
}

function createClient(rows: Record<TableName, unknown[]>) {
  return {
    from: (tableName: TableName) => query(rows[tableName]),
  };
}

describe('fetchDashboardData', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps only the latest current-month AWS cost snapshot per service line', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));

    const client = createClient({
      projects: [
        {
          id: 'project-acme-site',
          slug: 'acme_site',
          name: 'Acme Site',
          public_url: 'https://example.com',
        },
      ],
      resources: [],
      metric_snapshots: [],
      cost_snapshots: [
        {
          project_id: null,
          service_name: 'AWS Amplify',
          period_start: '2026-06-01',
          period_end: '2026-06-30',
          amount_usd: 0.77,
          metadata: {},
          collected_at: '2026-06-29T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
        {
          project_id: null,
          service_name: 'AWS Amplify',
          period_start: '2026-06-01',
          period_end: '2026-06-29',
          amount_usd: 0.64,
          metadata: {},
          collected_at: '2026-06-28T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
        {
          project_id: null,
          service_name: 'Amazon Route 53',
          period_start: '2026-06-01',
          period_end: '2026-06-30',
          amount_usd: 0.51,
          metadata: {},
          collected_at: '2026-06-29T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
        {
          project_id: null,
          service_name: 'Amazon Route 53',
          period_start: '2026-06-01',
          period_end: '2026-06-29',
          amount_usd: 0.51,
          metadata: {},
          collected_at: '2026-06-28T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
      ],
      health_checks: [],
      collector_runs: [],
    });

    const data = await fetchDashboardData(client as never);

    expect(data.unallocatedCosts).toEqual([
      expect.objectContaining({
        provider: 'aws',
        serviceName: 'AWS Amplify',
        monthToDateUsd: 0.77,
      }),
      expect.objectContaining({
        provider: 'aws',
        serviceName: 'Amazon Route 53',
        monthToDateUsd: 0.51,
      }),
    ]);
    expect(data.lastMonthCostUsd).toBeNull();
  });

  it('sums latest previous-month cost snapshots separately from current month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));

    const client = createClient({
      projects: [
        {
          id: 'project-acme-site',
          slug: 'acme_site',
          name: 'Acme Site',
          public_url: 'https://example.com',
        },
      ],
      resources: [],
      metric_snapshots: [],
      cost_snapshots: [
        {
          project_id: null,
          service_name: 'AWS Amplify',
          period_start: '2026-05-01',
          period_end: '2026-06-01',
          amount_usd: 2.71,
          metadata: {},
          collected_at: '2026-06-29T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
        {
          project_id: null,
          service_name: 'Tax',
          period_start: '2026-05-01',
          period_end: '2026-06-01',
          amount_usd: 0.2,
          metadata: {},
          collected_at: '2026-06-29T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
        {
          project_id: null,
          service_name: 'AWS Amplify',
          period_start: '2026-05-01',
          period_end: '2026-06-01',
          amount_usd: 2.5,
          metadata: {},
          collected_at: '2026-06-28T12:00:00.000Z',
          providers: { key: 'aws', name: 'AWS' },
        },
      ],
      health_checks: [],
      collector_runs: [],
    });

    const data = await fetchDashboardData(client as never);

    expect(data.lastMonthCostUsd).toBe(2.91);
  });

  it('shows provider status from resources when provider metrics are not in the payload', async () => {
    const client = createClient({
      projects: [
        {
          id: 'status-hub',
          slug: 'status_hub',
          name: 'Status Hub',
          public_url: 'https://status.example.com',
        },
      ],
      resources: [
        {
          project_id: 'status-hub',
          resource_type: 'repository',
          display_name: 'owner/status-hub',
          metadata: {
            aggregateOnly: true,
          },
          last_seen_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
      ],
      metric_snapshots: [],
      cost_snapshots: [],
      health_checks: [],
      collector_runs: [],
    });

    const data = await fetchDashboardData(client as never);
    const project = data.projects[0];

    expect(project.providers).toEqual([
      {
        provider: 'github',
        label: 'GitHub Actions',
        status: 'healthy',
        detail: 'Last seen 2026-06-30T10:00:00.000Z',
        lastSync: '2026-06-30T10:00:00.000Z',
      },
    ]);
    expect(project.resources).toEqual([
      {
        provider: 'github',
        type: 'repository',
        name: 'owner/status-hub',
        status: 'healthy',
        detail: 'Last seen 2026-06-30T10:00:00.000Z',
      },
    ]);
  });

  it('summarizes GitHub Actions usage metrics for the frontend', async () => {
    const client = createClient({
      projects: [
        {
          id: 'status-hub',
          slug: 'status_hub',
          name: 'Status Hub',
          public_url: 'https://status.example.com',
        },
        {
          id: 'todo-app',
          slug: 'todo_app',
          name: 'Todo App',
          public_url: 'https://todo.example.com',
        },
      ],
      resources: [],
      metric_snapshots: [
        {
          project_id: 'status-hub',
          metric_key: 'github_actions_recent_run_count',
          metric_value: 12,
          status: 'healthy',
          metadata: {
            repository: 'owner/status-hub',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'status-hub',
          metric_key: 'github_actions_latest_run_status',
          metric_value: 1,
          status: 'healthy',
          metadata: {
            repository: 'owner/status-hub',
            workflowName: 'CI',
            conclusion: 'success',
            branch: 'main',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'status-hub',
          metric_key: 'github_actions_recent_failure_count',
          metric_value: 2,
          status: 'healthy',
          metadata: {
            repository: 'owner/status-hub',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'status-hub',
          metric_key: 'github_actions_scheduled_run_count',
          metric_value: 3,
          status: 'healthy',
          metadata: {
            repository: 'owner/status-hub',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'status-hub',
          metric_key: 'github_actions_scheduled_failure_count',
          metric_value: 1,
          status: 'healthy',
          metadata: {
            repository: 'owner/status-hub',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'status-hub',
          metric_key: 'github_actions_recent_duration_seconds',
          metric_value: 540,
          status: 'healthy',
          metadata: {
            repository: 'owner/status-hub',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'todo-app',
          metric_key: 'github_actions_recent_run_count',
          metric_value: 0,
          status: 'healthy',
          metadata: {
            repository: 'owner/todo-app',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'todo-app',
          metric_key: 'github_actions_latest_run_status',
          metric_value: null,
          status: 'unknown',
          metadata: {
            repository: 'owner/todo-app',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
      ],
      cost_snapshots: [],
      health_checks: [],
      collector_runs: [
        {
          started_at: '2026-06-30T10:00:00.000Z',
          finished_at: '2026-06-30T10:00:03.000Z',
          status: 'partial_success',
          summary: '1/1 GitHub Actions repositories collected.',
          error_message: null,
          metadata: {
            errors: [],
          },
          providers: { key: 'github', name: 'GitHub Actions' },
        },
      ],
    });

    const data = await fetchDashboardData(client as never);

    expect(data.githubActionsUsage).toEqual({
      recentRuns: 12,
      recentFailures: 2,
      lastSync: '2026-06-30T10:00:00.000Z',
      rows: [
        {
          projectSlug: 'status_hub',
          projectName: 'Status Hub',
          repository: 'owner/status-hub',
          latestRun: 'CI: success on main',
          recentRuns: 12,
          recentFailures: 2,
          scheduledRuns: 3,
          scheduledFailures: 1,
          durationSeconds: 540,
          runtimeMinutes: 9,
          lastSync: '2026-06-30T10:00:00.000Z',
          status: 'healthy',
        },
      ],
      runtimeMinutes: 9,
    });
    expect(data.githubActionsUsage.rows).toHaveLength(1);
    expect(data.githubActionsUsage.rows.some((row) => row.repository === 'owner/todo-app')).toBe(false);
    expect(data.projects.find((project) => project.slug === 'status_hub')?.recentSnapshots).toEqual([]);
    expect(data.collectorRuns).toEqual([
      expect.objectContaining({
        provider: 'github',
        providerLabel: 'GitHub Actions',
        status: 'partial_success',
        lastSyncedAt: '2026-06-30T10:00:03.000Z',
      }),
    ]);
  });

  it('derives deploy status from the GitHub Actions deploy-workflow metric for non-Amplify projects', async () => {
    const client = createClient({
      projects: [
        {
          id: 'docs-site',
          slug: 'docs_site',
          name: 'Docs Site',
          public_url: 'https://docs.example.com',
        },
      ],
      resources: [],
      metric_snapshots: [
        {
          project_id: 'docs-site',
          metric_key: 'github_actions_deploy_status',
          metric_value: 1,
          status: 'failed',
          metadata: {
            deployWorkflow: 'deploy-site.yml',
            workflowName: 'Deploy site',
            conclusion: 'failure',
            branch: 'main',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
        {
          project_id: 'docs-site',
          metric_key: 'github_actions_latest_run_status',
          metric_value: 1,
          status: 'healthy',
          metadata: {
            repository: 'owner/docs-site',
          },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'github', name: 'GitHub Actions' },
        },
      ],
      cost_snapshots: [],
      health_checks: [],
      collector_runs: [],
    });

    const data = await fetchDashboardData(client as never);

    expect(data.projects.find((project) => project.slug === 'docs_site')?.deployStatus).toBe('failed');
  });

  it('builds a domain summary from Cloudflare zone resources and metrics, and excludes them from the resource list', async () => {
    const client = createClient({
      projects: [
        {
          id: 'project-acme-site',
          slug: 'acme_site',
          name: 'Acme Site',
          public_url: 'https://example.com',
        },
      ],
      resources: [
        {
          project_id: 'project-acme-site',
          resource_type: 'zone',
          display_name: 'example.com',
          metadata: { status: 'active', paused: false },
          last_seen_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'cloudflare', name: 'Cloudflare' },
        },
        {
          project_id: 'project-acme-site',
          resource_type: 'dns_record',
          display_name: 'A example.com',
          metadata: { domain: 'example.com', type: 'A', name: 'example.com', proxied: true },
          last_seen_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'cloudflare', name: 'Cloudflare' },
        },
      ],
      metric_snapshots: [
        {
          project_id: 'project-acme-site',
          metric_key: 'cloudflare_zone_active',
          metric_value: 1,
          status: 'healthy',
          metadata: { domain: 'example.com' },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'cloudflare', name: 'Cloudflare' },
        },
        {
          project_id: 'project-acme-site',
          metric_key: 'cloudflare_domain_expiration_days',
          metric_value: 120,
          status: 'healthy',
          metadata: { domain: 'example.com', expiresAt: '2026-10-29T00:00:00.000Z', autoRenew: true, locked: true },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'cloudflare', name: 'Cloudflare' },
        },
        {
          project_id: 'project-acme-site',
          metric_key: 'cloudflare_registrar_on_cloudflare',
          metric_value: 1,
          status: 'healthy',
          metadata: { domain: 'example.com', registrar: 'Cloudflare' },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'cloudflare', name: 'Cloudflare' },
        },
        {
          project_id: 'project-acme-site',
          metric_key: 'cloudflare_dns_record_count',
          metric_value: 5,
          status: 'healthy',
          metadata: { domain: 'example.com' },
          collected_at: '2026-06-30T10:00:00.000Z',
          providers: { key: 'cloudflare', name: 'Cloudflare' },
        },
      ],
      cost_snapshots: [],
      health_checks: [],
      collector_runs: [],
    });

    const data = await fetchDashboardData(client as never);

    expect(data.domains).toEqual([
      expect.objectContaining({
        domain: 'example.com',
        status: 'healthy',
        registrar: 'Cloudflare',
        expiresAt: '2026-10-29T00:00:00.000Z',
        expirationDays: 120,
        autoRenew: true,
        locked: true,
        dnsRecordCount: 5,
        dnsRecords: [{ type: 'A', name: 'example.com', proxied: true }],
      }),
    ]);
    expect(data.projects[0].resources).toEqual([]);
  });

  it('keeps runs and errors separate for adapters sharing the supabase provider key', async () => {
    const client = createClient({
      projects: [
        {
          id: 'project-acme-site',
          slug: 'acme_site',
          name: 'Acme Site',
          public_url: 'https://example.com',
        },
      ],
      resources: [],
      metric_snapshots: [],
      cost_snapshots: [],
      health_checks: [],
      collector_runs: [
        {
          started_at: '2026-06-30T10:00:00.000Z',
          finished_at: '2026-06-30T10:00:01.000Z',
          status: 'failed',
          summary: '0/1 Supabase aggregate targets collected.',
          error_message: 'RPC failed',
          metadata: {
            adapterKey: 'supabase_aggregate:acme_site',
            errors: [{ projectSlug: 'acme_site', message: 'RPC failed' }],
          },
          providers: { key: 'supabase', name: 'Supabase' },
        },
        {
          started_at: '2026-06-30T10:00:02.000Z',
          finished_at: '2026-06-30T10:00:03.000Z',
          status: 'success',
          summary: '1/1 Supabase project health targets collected.',
          error_message: null,
          metadata: {
            adapterKey: 'supabase_project_health',
            errors: [],
          },
          providers: { key: 'supabase', name: 'Supabase' },
        },
      ],
    });

    const data = await fetchDashboardData(client as never);

    expect(data.collectorRuns).toHaveLength(2);
    expect(data.collectorRuns.map((run) => run.status).sort()).toEqual(['failed', 'success']);
    expect(data.projects[0].collectorErrors).toEqual([
      {
        provider: 'supabase',
        message: 'RPC failed',
        occurredAt: '2026-06-30T10:00:01.000Z',
      },
    ]);
  });
});
