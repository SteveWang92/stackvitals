import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorHealthCheck, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';

export interface HttpHealthTarget {
  projectSlug: ProjectSlug;
  url: string;
}

export interface HttpHealthOptions {
  fetch: typeof fetch;
  timeoutMs?: number;
  bypassHeaderName?: string;
  bypassHeaderValue?: string;
}

function statusFromHttpStatus(httpStatus: number): StatusLevel {
  if (httpStatus >= 200 && httpStatus < 400) {
    return 'healthy';
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    return 'warning';
  }

  return 'failed';
}

function resultStatusFromChecks(checks: CollectorHealthCheck[]): CollectorAdapterResult['status'] {
  if (checks.length === 0) {
    return 'skipped';
  }

  if (checks.every((check) => check.status === 'healthy')) {
    return 'success';
  }

  if (checks.every((check) => check.status === 'failed')) {
    return 'failed';
  }

  return 'partial_success';
}

function healthCheckErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Health check timed out';
  }

  return getErrorMessage(error, 'Health check failed');
}

async function checkTarget(
  target: HttpHealthTarget,
  options: Required<Pick<HttpHealthOptions, 'fetch' | 'timeoutMs'>> & Pick<HttpHealthOptions, 'bypassHeaderName' | 'bypassHeaderValue'>,
): Promise<CollectorHealthCheck> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; StackVitals/1.0)',
      Accept: 'text/html,application/xhtml+xml',
    };

    if (options.bypassHeaderName && options.bypassHeaderValue) {
      headers[options.bypassHeaderName] = options.bypassHeaderValue;
    }

    const response = await options.fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });

    return {
      projectSlug: target.projectSlug,
      url: target.url,
      status: statusFromHttpStatus(response.status),
      httpStatus: response.status,
      responseTimeMs: Date.now() - startedAt,
      checkedAt,
    };
  } catch (error) {
    return {
      projectSlug: target.projectSlug,
      url: target.url,
      status: 'failed',
      httpStatus: null,
      responseTimeMs: Date.now() - startedAt,
      checkedAt,
      errorMessage: healthCheckErrorMessage(error),
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function collectHttpHealth(targets: HttpHealthTarget[], options: HttpHealthOptions): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resolvedOptions = {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? 10_000,
    bypassHeaderName: options.bypassHeaderName,
    bypassHeaderValue: options.bypassHeaderValue,
  };

  const healthChecks = await Promise.all(targets.map((target) => checkTarget(target, resolvedOptions)));
  const failedChecks = healthChecks.filter((check) => check.status === 'failed');
  const status = resultStatusFromChecks(healthChecks);

  return {
    provider: 'http',
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      healthChecks.length === 0
        ? 'No HTTP health targets configured.'
        : `${healthChecks.length - failedChecks.length}/${healthChecks.length} HTTP health checks passed.`,
    resources: [],
    metrics: healthChecks.map((check) => ({
      projectSlug: check.projectSlug,
      provider: 'http',
      metricKey: 'http_response_time_ms',
      metricValue: check.responseTimeMs,
      status: check.status,
      metadata: {
        url: check.url,
        httpStatus: check.httpStatus,
      },
      collectedAt: check.checkedAt,
    })),
    costs: [],
    healthChecks,
    errors: failedChecks.map((check) => ({
      projectSlug: check.projectSlug,
      message: check.errorMessage ?? `HTTP health check failed with status ${check.httpStatus ?? 'unknown'}.`,
      retryable: true,
    })),
  };
}

export function createHttpHealthAdapter(targets: HttpHealthTarget[], options: HttpHealthOptions): ProviderAdapter {
  return {
    provider: 'http',
    collect: () => collectHttpHealth(targets, options),
  };
}
