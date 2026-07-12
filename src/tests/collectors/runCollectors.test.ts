import { describe, expect, it } from 'vitest';
import { runCollectors } from '../../collectors/runCollectors';
import type { CollectorAdapterResult, CollectorRunRecord, ProviderAdapter } from '../../collectors/types';

function result(status: CollectorAdapterResult['status']): CollectorAdapterResult {
  return {
    provider: 'http',
    status,
    startedAt: '2026-06-27T00:00:00.000Z',
    finishedAt: '2026-06-27T00:00:01.000Z',
    summary: status,
    resources: [],
    metrics: [],
    costs: [],
    healthChecks: [],
    errors: [],
  };
}

describe('runCollectors', () => {
  it('returns success when every adapter succeeds', async () => {
    const summary = await runCollectors([
      {
        provider: 'http',
        collect: async () => result('success'),
      },
    ]);

    expect(summary.status).toBe('success');
    expect(summary.results).toHaveLength(1);
  });

  it('isolates thrown adapter failures', async () => {
    const adapters: ProviderAdapter[] = [
      {
        provider: 'http',
        collect: async () => {
          throw new Error('network unavailable');
        },
      },
      {
        provider: 'supabase',
        collect: async () => ({ ...result('success'), provider: 'supabase' }),
      },
    ];

    const summary = await runCollectors(adapters);

    expect(summary.status).toBe('partial_success');
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0]).toMatchObject({
      provider: 'http',
      status: 'failed',
      errors: [{ message: 'network unavailable', retryable: true }],
    });
    expect(summary.results[1]).toMatchObject({
      provider: 'supabase',
      status: 'success',
    });
  });

  it('records every adapter attempt when a recorder is provided', async () => {
    const records: CollectorRunRecord[] = [];

    const summary = await runCollectors(
      [
        {
          provider: 'http',
          collect: async () => result('success'),
        },
      ],
      {
        recorder: {
          recordCollectorResult: async (result) => {
            records.push({
              provider: result.provider,
              startedAt: result.startedAt,
              finishedAt: result.finishedAt,
              status: result.status,
              summary: result.summary,
              errorMessage: result.errors[0]?.message ?? null,
              metadata: {
                resources: result.resources.length,
                metrics: result.metrics.length,
                costs: result.costs.length,
                healthChecks: result.healthChecks.length,
                errors: result.errors,
              },
            });
          },
        },
      },
    );

    expect(summary.status).toBe('success');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      provider: 'http',
      status: 'success',
      errorMessage: null,
    });
  });

  it('surfaces recorder failures without blocking later adapters', async () => {
    const summary = await runCollectors(
      [
        {
          provider: 'http',
          collect: async () => result('success'),
        },
        {
          provider: 'supabase',
          collect: async () => ({ ...result('success'), provider: 'supabase' }),
        },
      ],
      {
        recorder: {
          recordCollectorResult: async (result) => {
            if (result.provider === 'http') {
              throw new Error('database unavailable');
            }
          },
        },
      },
    );

    expect(summary.status).toBe('partial_success');
    expect(summary.results[0]).toMatchObject({
      provider: 'http',
      status: 'partial_success',
      errors: [{ message: 'collector result write failed: database unavailable', retryable: true }],
    });
    expect(summary.results[1]).toMatchObject({
      provider: 'supabase',
      status: 'success',
    });
  });
});
