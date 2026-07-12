import type { CollectorAdapterResult, CollectorRunRecord } from './types';

export function buildCollectorRunRecord(result: CollectorAdapterResult): CollectorRunRecord {
  return {
    provider: result.provider,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    status: result.status,
    summary: result.summary,
    errorMessage: result.errors[0]?.message ?? null,
    metadata: {
      ...(result.adapterKey ? { adapterKey: result.adapterKey } : {}),
      resources: result.resources.length,
      metrics: result.metrics.length,
      costs: result.costs.length,
      healthChecks: result.healthChecks.length,
      errors: result.errors,
    },
  };
}
