import { describe, expect, it, vi } from 'vitest';
import {
  createSupabaseCollectorRunRecorder,
  type SupabaseCollectorRunClient,
} from '../../../collectors/stores/supabaseCollectorRunRecorder';
import type { CollectorAdapterResult } from '../../../collectors/types';

const result: CollectorAdapterResult = {
  provider: 'http',
  startedAt: '2026-06-27T00:00:00.000Z',
  finishedAt: '2026-06-27T00:00:02.000Z',
  status: 'success',
  summary: '1/1 HTTP health checks passed.',
  resources: [
    {
      projectSlug: 'acme_site',
      provider: 'http',
      resourceType: 'public_endpoint',
      displayName: 'https://example.com/',
      metadata: { source: 'health' },
    },
  ],
  metrics: [
    {
      projectSlug: 'acme_site',
      provider: 'http',
      metricKey: 'http_response_time_ms',
      metricValue: 181,
      status: 'healthy',
      metadata: { httpStatus: 200 },
      collectedAt: '2026-06-27T00:00:01.000Z',
    },
  ],
  costs: [],
  healthChecks: [
    {
      projectSlug: 'acme_site',
      url: 'https://example.com/',
      status: 'healthy',
      httpStatus: 200,
      responseTimeMs: 181,
      checkedAt: '2026-06-27T00:00:01.000Z',
    },
  ],
  errors: [],
};

function createClient(overrides: Partial<SupabaseCollectorRunClient> = {}) {
  return {
    getProviderId: vi.fn().mockResolvedValue('provider-http-id'),
    getProjectId: vi.fn().mockResolvedValue('project-acme-site-id'),
    upsertResources: vi.fn().mockResolvedValue(undefined),
    insertMetricSnapshots: vi.fn().mockResolvedValue(undefined),
    insertCostSnapshots: vi.fn().mockResolvedValue(undefined),
    insertHealthChecks: vi.fn().mockResolvedValue(undefined),
    insertCollectorRun: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies SupabaseCollectorRunClient;
}

describe('createSupabaseCollectorRunRecorder', () => {
  it('persists normalized collector result rows before recording the run', async () => {
    const client = createClient();
    const recorder = createSupabaseCollectorRunRecorder(client);

    await recorder.recordCollectorResult(result);

    expect(client.getProviderId).toHaveBeenCalledWith('http');
    expect(client.getProjectId).toHaveBeenCalledWith('acme_site');
    expect(client.upsertResources).toHaveBeenCalledWith([
      {
        project_id: 'project-acme-site-id',
        provider_id: 'provider-http-id',
        resource_type: 'public_endpoint',
        external_id: 'acme_site:public_endpoint:https://example.com/',
        display_name: 'https://example.com/',
        metadata: { source: 'health' },
        last_seen_at: '2026-06-27T00:00:02.000Z',
      },
    ]);
    expect(client.insertMetricSnapshots).toHaveBeenCalledWith([
      {
        project_id: 'project-acme-site-id',
        provider_id: 'provider-http-id',
        metric_key: 'http_response_time_ms',
        metric_value: 181,
        status: 'healthy',
        metadata: { httpStatus: 200 },
        collected_at: '2026-06-27T00:00:01.000Z',
      },
    ]);
    expect(client.insertHealthChecks).toHaveBeenCalledWith([
      {
        project_id: 'project-acme-site-id',
        url: 'https://example.com/',
        status: 'healthy',
        http_status: 200,
        response_time_ms: 181,
        error_message: undefined,
        checked_at: '2026-06-27T00:00:01.000Z',
      },
    ]);
    expect(client.insertCollectorRun).toHaveBeenCalledWith({
      provider_id: 'provider-http-id',
      started_at: '2026-06-27T00:00:00.000Z',
      finished_at: '2026-06-27T00:00:02.000Z',
      status: 'success',
      summary: '1/1 HTTP health checks passed.',
      error_message: null,
      metadata: {
        resources: 1,
        metrics: 1,
        costs: 0,
        healthChecks: 1,
        errors: [],
      },
    });
  });

  it('throws when a normalized write fails', async () => {
    const client = createClient({
      insertHealthChecks: vi.fn().mockRejectedValue(new Error('permission denied')),
    });
    const recorder = createSupabaseCollectorRunRecorder(client);

    await expect(recorder.recordCollectorResult(result)).rejects.toThrow('permission denied');
  });
});
