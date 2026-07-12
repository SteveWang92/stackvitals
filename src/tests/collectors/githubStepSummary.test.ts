import { describe, expect, it } from 'vitest';
import { buildGithubStepSummary } from '../../collectors/githubStepSummary';
import type { CollectorAdapterResult, CollectorRunSummary } from '../../collectors/types';

function result(overrides: Partial<CollectorAdapterResult> = {}): CollectorAdapterResult {
  return {
    provider: 'http',
    status: 'success',
    startedAt: '2026-06-27T00:00:00.000Z',
    finishedAt: '2026-06-27T00:00:01.000Z',
    summary: 'ok',
    resources: [],
    metrics: [],
    costs: [],
    healthChecks: [],
    errors: [],
    ...overrides,
  };
}

function summary(overrides: Partial<CollectorRunSummary> = {}): CollectorRunSummary {
  return {
    status: 'success',
    startedAt: '2026-06-27T00:00:00.000Z',
    finishedAt: '2026-06-27T00:00:02.000Z',
    results: [result()],
    ...overrides,
  };
}

describe('buildGithubStepSummary', () => {
  it('renders an overall status heading and a per-provider table row', () => {
    const markdown = buildGithubStepSummary(summary());

    expect(markdown).toContain('## Collector run: ✅ success');
    expect(markdown).toContain('| http | ✅ success | ok | 0 | 0 | 0 | 0 | 0 |');
  });

  it('lists errors in a dedicated table', () => {
    const markdown = buildGithubStepSummary(
      summary({
        status: 'partial_success',
        results: [
          result({
            status: 'partial_success',
            errors: [{ projectSlug: 'recipe_box', message: 'network unavailable', retryable: true }],
          }),
        ],
      }),
    );

    expect(markdown).toContain('### Errors');
    expect(markdown).toContain('| http | recipe_box | yes | network unavailable |');
  });

  it('lists degraded health checks in a dedicated table', () => {
    const markdown = buildGithubStepSummary(
      summary({
        results: [
          result({
            healthChecks: [
              {
                projectSlug: 'recipe_box',
                url: 'https://demo.example.com',
                status: 'failed',
                httpStatus: 503,
                responseTimeMs: 120,
                checkedAt: '2026-06-27T00:00:01.000Z',
              },
            ],
          }),
        ],
      }),
    );

    expect(markdown).toContain('### Degraded health checks');
    expect(markdown).toContain('| http | recipe_box | https://demo.example.com | failed | 503 |');
  });

  it('escapes pipe characters in free-text fields', () => {
    const markdown = buildGithubStepSummary(
      summary({
        results: [result({ summary: 'a | b' })],
      }),
    );

    expect(markdown).toContain('a \\| b');
  });
});
