import { describe, expect, it } from 'vitest';
import { collectRunFailures, formatRunFailures } from '../../collectors/runFailures';
import type { CollectorAdapterResult, CollectorRunSummary } from '../../collectors/types';

function result(overrides: Partial<CollectorAdapterResult> = {}): CollectorAdapterResult {
  return {
    provider: 'http',
    status: 'success',
    startedAt: '2026-07-30T00:00:00.000Z',
    finishedAt: '2026-07-30T00:00:01.000Z',
    summary: 'ran',
    resources: [],
    metrics: [],
    costs: [],
    healthChecks: [],
    errors: [],
    ...overrides,
  };
}

function summary(results: CollectorAdapterResult[], status: CollectorRunSummary['status'] = 'partial_success'): CollectorRunSummary {
  return {
    status,
    startedAt: '2026-07-30T00:00:00.000Z',
    finishedAt: '2026-07-30T00:00:01.000Z',
    results,
  };
}

describe('collectRunFailures', () => {
  it('returns nothing for a clean run', () => {
    expect(collectRunFailures(summary([result()], 'success'))).toEqual([]);
  });

  it('ignores warning-level metrics and health checks', () => {
    const failures = collectRunFailures(
      summary([
        result({
          provider: 'cloudflare',
          status: 'partial_success',
          metrics: [
            {
              provider: 'cloudflare',
              projectSlug: 'demo',
              metricKey: 'cloudflare_domain_expires_in_days',
              metricValue: 20,
              status: 'warning',
              collectedAt: '2026-07-30T00:00:00.000Z',
            },
          ],
          healthChecks: [
            {
              projectSlug: 'demo',
              url: 'https://demo.example',
              status: 'warning',
              httpStatus: 200,
              responseTimeMs: 2400,
              checkedAt: '2026-07-30T00:00:00.000Z',
            },
          ],
        }),
      ]),
    );

    expect(failures).toEqual([]);
  });

  it('collects adapter errors, failed metrics, and failed health checks', () => {
    const failures = collectRunFailures(
      summary([
        result({
          provider: 'resend',
          status: 'failed',
          errors: [{ projectSlug: 'demo', message: 'Resend API request failed with 401', retryable: true }],
        }),
        result({
          provider: 'github',
          status: 'partial_success',
          metrics: [
            {
              provider: 'github',
              projectSlug: 'demo',
              metricKey: 'github_actions_latest_run_status',
              status: 'failed',
              collectedAt: '2026-07-30T00:00:00.000Z',
            },
          ],
        }),
        result({
          healthChecks: [
            {
              projectSlug: 'demo',
              url: 'https://demo.example',
              status: 'failed',
              httpStatus: 503,
              responseTimeMs: 120,
              checkedAt: '2026-07-30T00:00:00.000Z',
            },
          ],
        }),
      ]),
    );

    expect(failures).toEqual([
      { provider: 'resend', projectSlug: 'demo', kind: 'error', detail: 'Resend API request failed with 401' },
      {
        provider: 'github',
        projectSlug: 'demo',
        kind: 'metric',
        detail: 'github_actions_latest_run_status reported failed.',
      },
      { provider: 'http', projectSlug: 'demo', kind: 'health_check', detail: 'https://demo.example returned 503.' },
    ]);
  });

  it('does not fail the run on GitHub metrics about the repository the collector runs in', () => {
    const failures = collectRunFailures(
      summary([
        result({
          provider: 'github',
          status: 'partial_success',
          metrics: [
            {
              projectSlug: 'hub',
              provider: 'github',
              metricKey: 'github_actions_latest_run_status',
              status: 'failed',
              metadata: { repository: 'owner/hub' },
              collectedAt: '2026-07-30T00:00:00.000Z',
            },
            {
              projectSlug: 'demo',
              provider: 'github',
              metricKey: 'github_actions_latest_run_status',
              status: 'failed',
              metadata: { repository: 'owner/demo' },
              collectedAt: '2026-07-30T00:00:00.000Z',
            },
          ],
        }),
      ]),
      { selfRepository: 'owner/hub' },
    );

    expect(failures).toEqual([
      {
        provider: 'github',
        projectSlug: 'demo',
        kind: 'metric',
        detail: 'github_actions_latest_run_status reported failed.',
      },
    ]);
  });

  it('prefers a health check error message over the synthesised detail', () => {
    const failures = collectRunFailures(
      summary([
        result({
          healthChecks: [
            {
              projectSlug: 'demo',
              url: 'https://demo.example',
              status: 'failed',
              httpStatus: null,
              responseTimeMs: 0,
              checkedAt: '2026-07-30T00:00:00.000Z',
              errorMessage: 'getaddrinfo ENOTFOUND demo.example',
            },
          ],
        }),
      ]),
    );

    expect(failures[0]?.detail).toBe('getaddrinfo ENOTFOUND demo.example');
  });
});

describe('formatRunFailures', () => {
  it('lists each failure with its provider and project', () => {
    const text = formatRunFailures([
      { provider: 'http', projectSlug: 'demo', kind: 'health_check', detail: 'down' },
      { provider: 'openai', kind: 'error', detail: 'no key' },
    ]);

    expect(text).toBe(
      ['Collector run reported 2 failures:', '  - [http/demo] health_check: down', '  - [openai] error: no key'].join('\n'),
    );
  });

  it('uses the singular for one failure', () => {
    expect(formatRunFailures([{ provider: 'http', kind: 'error', detail: 'boom' }])).toContain('1 failure:');
  });
});
