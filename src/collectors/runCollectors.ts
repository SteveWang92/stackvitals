import type { CollectorAdapterResult, CollectorRunRecorder, CollectorRunStatus, CollectorRunSummary, ProviderAdapter } from './types';
import { getErrorMessage } from './errorMessage';

function getRunStatus(results: CollectorAdapterResult[]): CollectorRunStatus {
  if (results.length === 0) {
    return 'skipped';
  }

  if (results.every((result) => result.status === 'success' || result.status === 'skipped')) {
    return results.every((result) => result.status === 'skipped') ? 'skipped' : 'success';
  }

  if (results.every((result) => result.status === 'failed')) {
    return 'failed';
  }

  return 'partial_success';
}

async function recordResult(result: CollectorAdapterResult, recorder?: CollectorRunRecorder): Promise<void> {
  if (!recorder) {
    return;
  }

  try {
    await recorder.recordCollectorResult(result);
  } catch (error) {
    result.errors.push({
      message: `collector result write failed: ${getErrorMessage(error, 'Unknown collector error')}`,
      retryable: true,
    });

    if (result.status === 'success' || result.status === 'skipped') {
      result.status = 'partial_success';
    }

    result.summary = `${result.summary} Collector run recording failed.`;
  }
}

export async function runCollectors(
  adapters: ProviderAdapter[],
  options: { recorder?: CollectorRunRecorder } = {},
): Promise<CollectorRunSummary> {
  const startedAt = new Date().toISOString();
  const results: CollectorAdapterResult[] = [];

  for (const adapter of adapters) {
    let result: CollectorAdapterResult;

    try {
      result = await adapter.collect({ startedAt });
    } catch (error) {
      const finishedAt = new Date().toISOString();

      result = {
        provider: adapter.provider,
        adapterKey: adapter.adapterKey,
        status: 'failed',
        startedAt,
        finishedAt,
        summary: `${adapter.provider} collector failed before returning a result.`,
        resources: [],
        metrics: [],
        costs: [],
        healthChecks: [],
        errors: [
          {
            message: getErrorMessage(error, 'Unknown collector error'),
            retryable: true,
          },
        ],
      };
    }

    await recordResult(result, options.recorder);
    results.push(result);
  }

  return {
    status: getRunStatus(results),
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}
