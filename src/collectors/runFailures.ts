import type { CollectorRunSummary } from './types';
import type { ProviderKey } from '../types';

export interface RunFailure {
  provider: ProviderKey;
  projectSlug?: string;
  kind: 'error' | 'metric' | 'health_check';
  detail: string;
}

export interface RunFailureOptions {
  // `owner/repo` of the repository this collector run is executing in, when it runs in
  // GitHub Actions. See `isSelfMonitoringMetric`.
  selfRepository?: string;
}

/**
 * A GitHub Actions metric the collector reports about the repository it is running in.
 *
 * The collector watches its own repository, so its own previous failed run is part of that
 * repository's latest-run and failure-count metrics. Letting those fail the job makes the
 * failure self-sustaining: once one run goes red, every later run reads that red run and
 * fails again, and fixing the real cause never turns the workflow green. The metrics are
 * still collected and still shown on the dashboard — they just cannot be the reason this
 * run failed. A genuinely broken run fails on its own errors instead.
 */
function isSelfMonitoringMetric(
  provider: ProviderKey,
  metadata: Record<string, unknown> | undefined,
  selfRepository: string | undefined,
): boolean {
  return provider === 'github' && Boolean(selfRepository) && metadata?.repository === selfRepository;
}

/**
 * The hard failures in a run — the ones worth interrupting the owner for.
 *
 * The run-level `CollectorRunStatus` cannot drive a notification on its own: `failed` only
 * happens when every adapter failed, and `partial_success` covers both a real outage and a
 * warning-level metric such as a domain nearing expiry. Failing the job on `partial_success`
 * would email daily for known warnings and train the owner to ignore the one that matters,
 * so warnings are deliberately excluded here. They still appear in the dashboard's attention
 * panel and in the step summary.
 */
export function collectRunFailures(summary: CollectorRunSummary, options: RunFailureOptions = {}): RunFailure[] {
  return summary.results.flatMap((result) => [
    ...result.errors.map<RunFailure>((error) => ({
      provider: result.provider,
      projectSlug: error.projectSlug,
      kind: 'error',
      detail: error.message,
    })),
    ...result.metrics
      .filter((metric) => metric.status === 'failed' && !isSelfMonitoringMetric(result.provider, metric.metadata, options.selfRepository))
      .map<RunFailure>((metric) => ({
        provider: result.provider,
        projectSlug: metric.projectSlug,
        kind: 'metric',
        detail: `${metric.metricKey} reported failed.`,
      })),
    ...result.healthChecks
      .filter((check) => check.status === 'failed')
      .map<RunFailure>((check) => ({
        provider: result.provider,
        projectSlug: check.projectSlug,
        kind: 'health_check',
        detail: check.errorMessage ?? `${check.url} returned ${check.httpStatus ?? 'no HTTP status'}.`,
      })),
  ]);
}

export function formatRunFailures(failures: RunFailure[]): string {
  const lines = [`Collector run reported ${failures.length} failure${failures.length === 1 ? '' : 's'}:`];

  for (const failure of failures) {
    lines.push(`  - [${failure.provider}${failure.projectSlug ? `/${failure.projectSlug}` : ''}] ${failure.kind}: ${failure.detail}`);
  }

  return lines.join('\n');
}
