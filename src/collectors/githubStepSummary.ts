import type { CollectorRunSummary } from './types';

const STATUS_EMOJI: Record<CollectorRunSummary['status'], string> = {
  success: '✅',
  partial_success: '⚠️',
  skipped: '⏭️',
  failed: '❌',
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function buildGithubStepSummary(summary: CollectorRunSummary): string {
  const lines: string[] = [];

  lines.push(`## Collector run: ${STATUS_EMOJI[summary.status]} ${summary.status}`);
  lines.push('');
  lines.push(`Started \`${summary.startedAt}\`, finished \`${summary.finishedAt}\`.`);
  lines.push('');
  lines.push('| Provider | Status | Summary | Resources | Metrics | Costs | Health checks | Errors |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const result of summary.results) {
    lines.push(
      `| ${result.provider} | ${STATUS_EMOJI[result.status]} ${result.status} | ${escapeCell(result.summary)} | ${result.resources.length} | ${result.metrics.length} | ${result.costs.length} | ${result.healthChecks.length} | ${result.errors.length} |`,
    );
  }

  const errors = summary.results.flatMap((result) => result.errors.map((error) => ({ provider: result.provider, error })));

  if (errors.length > 0) {
    lines.push('');
    lines.push('### Errors');
    lines.push('');
    lines.push('| Provider | Project | Retryable | Message |');
    lines.push('| --- | --- | --- | --- |');

    for (const { provider, error } of errors) {
      lines.push(`| ${provider} | ${error.projectSlug ?? '-'} | ${error.retryable ? 'yes' : 'no'} | ${escapeCell(error.message)} |`);
    }
  }

  const degradedHealthChecks = summary.results.flatMap((result) =>
    result.healthChecks.filter((check) => check.status !== 'healthy').map((check) => ({ provider: result.provider, check })),
  );

  if (degradedHealthChecks.length > 0) {
    lines.push('');
    lines.push('### Degraded health checks');
    lines.push('');
    lines.push('| Provider | Project | URL | Status | HTTP status |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const { provider, check } of degradedHealthChecks) {
      lines.push(`| ${provider} | ${check.projectSlug} | ${escapeCell(check.url)} | ${check.status} | ${check.httpStatus ?? '-'} |`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
