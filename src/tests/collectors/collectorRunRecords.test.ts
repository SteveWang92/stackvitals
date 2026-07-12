import { describe, expect, it } from 'vitest';
import { buildCollectorRunRecord } from '../../collectors/collectorRunRecords';
import type { CollectorAdapterResult } from '../../collectors/types';

const result: CollectorAdapterResult = {
  provider: 'http',
  status: 'partial_success',
  startedAt: '2026-06-27T00:00:00.000Z',
  finishedAt: '2026-06-27T00:00:02.000Z',
  summary: '2/3 HTTP health checks passed.',
  resources: [],
  metrics: [
    {
      projectSlug: 'acme_site',
      provider: 'http',
      metricKey: 'http_response_time_ms',
      metricValue: 123,
      status: 'healthy',
      collectedAt: '2026-06-27T00:00:01.000Z',
    },
  ],
  costs: [],
  healthChecks: [
    {
      projectSlug: 'acme_site',
      url: 'https://example.test',
      status: 'healthy',
      httpStatus: 200,
      responseTimeMs: 123,
      checkedAt: '2026-06-27T00:00:01.000Z',
    },
  ],
  errors: [
    {
      projectSlug: 'todo_app',
      message: 'Health check failed',
      retryable: true,
    },
  ],
};

describe('buildCollectorRunRecord', () => {
  it('normalizes adapter results into collector_runs row data', () => {
    expect(buildCollectorRunRecord(result)).toEqual({
      provider: 'http',
      startedAt: '2026-06-27T00:00:00.000Z',
      finishedAt: '2026-06-27T00:00:02.000Z',
      status: 'partial_success',
      summary: '2/3 HTTP health checks passed.',
      errorMessage: 'Health check failed',
      metadata: {
        resources: 0,
        metrics: 1,
        costs: 0,
        healthChecks: 1,
        errors: [
          {
            projectSlug: 'todo_app',
            message: 'Health check failed',
            retryable: true,
          },
        ],
      },
    });
  });

  it('uses null error_message when the adapter had no errors', () => {
    expect(buildCollectorRunRecord({ ...result, status: 'success', errors: [] }).errorMessage).toBeNull();
  });
});
