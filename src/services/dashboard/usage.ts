import type { GitHubActionsUsageRow, GitHubActionsUsageSummary, OpenAiUsageRow, OpenAiUsageSummary, StatusLevel } from '../../types';
import { costTotal, currentMonthBounds, isPeriodRow, lastMonthBounds, latestCostRows } from './costs';
import { buildTrendSeries } from './history';
import { latestBy, metadataText, providerKey, type CostSnapshotRow, type MetricSnapshotRow, type ProjectRow } from './rows';

function metadataPeriod(metadata: Record<string, unknown> | null): string | null {
  const value = metadata?.period;

  return typeof value === 'string' && value.trim() ? value : null;
}

function latestMetricsByKey(metrics: MetricSnapshotRow[]): Map<string, MetricSnapshotRow> {
  const latest = new Map<string, MetricSnapshotRow>();

  for (const metric of metrics) {
    const existing = latest.get(metric.metric_key);

    if (!existing || new Date(metric.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latest.set(metric.metric_key, metric);
    }
  }

  return latest;
}

export function openAiUsageSummary(metrics: MetricSnapshotRow[], costs: CostSnapshotRow[]): OpenAiUsageSummary {
  const latestByUsageMetric = new Map<string, MetricSnapshotRow>();
  const usageMetricKeys = new Set(['openai_input_tokens', 'openai_output_tokens', 'openai_cached_input_tokens', 'openai_requests']);

  for (const metric of metrics.filter(
    (row) =>
      providerKey(row) === 'openai' &&
      row.project_id === null &&
      usageMetricKeys.has(row.metric_key) &&
      metadataPeriod(row.metadata) !== 'last_month',
  )) {
    const apiKeyLabel = metadataText(metric.metadata, ['apiKeyLabel', 'apiKeyId']) ?? 'Unknown API key';
    const model = metadataText(metric.metadata, ['model']) ?? 'Unknown model';
    const key = `${metric.metric_key}:${apiKeyLabel}:${model}`;
    const existing = latestByUsageMetric.get(key);

    if (!existing || new Date(metric.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latestByUsageMetric.set(key, metric);
    }
  }

  const latestRows = Array.from(latestByUsageMetric.values());
  const usageByKey = new Map<string, OpenAiUsageRow & { collectedAt: string }>();

  for (const metric of latestRows) {
    const apiKeyLabel = metadataText(metric.metadata, ['apiKeyLabel', 'apiKeyId']) ?? 'Unknown API key';
    const model = metadataText(metric.metadata, ['model']) ?? 'Unknown model';
    const key = `${apiKeyLabel}:${model}`;
    const existing =
      usageByKey.get(key) ??
      ({
        apiKeyLabel,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        requests: 0,
        collectedAt: metric.collected_at,
      } satisfies OpenAiUsageRow & { collectedAt: string });
    const value = metric.metric_value ?? 0;

    if (metric.metric_key === 'openai_input_tokens') {
      existing.inputTokens = value;
    } else if (metric.metric_key === 'openai_output_tokens') {
      existing.outputTokens = value;
    } else if (metric.metric_key === 'openai_cached_input_tokens') {
      existing.cachedInputTokens = value;
    } else if (metric.metric_key === 'openai_requests') {
      existing.requests = value;
    }

    usageByKey.set(key, existing);
  }

  const rows = Array.from(usageByKey.values()).sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  const tokenSeries = buildTrendSeries(
    metrics.filter(
      (row) =>
        providerKey(row) === 'openai' &&
        row.project_id === null &&
        (row.metric_key === 'openai_input_tokens' || row.metric_key === 'openai_output_tokens') &&
        metadataPeriod(row.metadata) !== 'last_month',
    ),
    (row) =>
      [row.metric_key, metadataText(row.metadata, ['apiKeyLabel', 'apiKeyId']) ?? '', metadataText(row.metadata, ['model']) ?? ''].join(
        ':',
      ),
  );
  const latestSpendMetric = latestBy(
    metrics.filter((metric) => providerKey(metric) === 'openai' && metric.metric_key === 'openai_spend_usd'),
    (metric) => metric.collected_at,
  );
  const lastMonthUsageMetric = latestBy(
    metrics.filter((metric) => providerKey(metric) === 'openai' && metric.metric_key === 'openai_last_month_tokens'),
    (metric) => metric.collected_at,
  );
  const lastMonthSpendMetric = latestBy(
    metrics.filter((metric) => providerKey(metric) === 'openai' && metric.metric_key === 'openai_last_month_spend_usd'),
    (metric) => metric.collected_at,
  );
  const currentPeriod = currentMonthBounds();
  const lastMonthPeriod = lastMonthBounds();
  const latestOpenAiCosts = latestCostRows(costs.filter((cost) => providerKey(cost) === 'openai' && isPeriodRow(cost, currentPeriod)));
  const latestLastMonthOpenAiCosts = latestCostRows(
    costs.filter((cost) => providerKey(cost) === 'openai' && isPeriodRow(cost, lastMonthPeriod)),
  );
  const spendFromCosts = costTotal(latestOpenAiCosts);
  const lastMonthSpendFromCosts = costTotal(latestLastMonthOpenAiCosts);
  const lastSync = latestBy(
    [...rows.map((row) => row.collectedAt), latestSpendMetric?.collected_at, ...latestOpenAiCosts.map((cost) => cost.collected_at)].filter(
      (value): value is string => Boolean(value),
    ),
    (value) => value,
  );

  return {
    totalTokens: rows.reduce((total, row) => total + row.inputTokens + row.outputTokens, 0),
    cachedInputTokens: rows.reduce((total, row) => total + row.cachedInputTokens, 0),
    requests: rows.reduce((total, row) => total + row.requests, 0),
    spendUsd: spendFromCosts ?? latestSpendMetric?.metric_value ?? null,
    lastMonthTokens: lastMonthUsageMetric?.metric_value ?? null,
    lastMonthSpendUsd: lastMonthSpendFromCosts ?? lastMonthSpendMetric?.metric_value ?? null,
    lastSync: lastSync ?? null,
    tokenSeries,
    rows: rows.map((row) => ({
      apiKeyLabel: row.apiKeyLabel,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      requests: row.requests,
    })),
  };
}

function statusPriority(status: StatusLevel): number {
  if (status === 'failed') {
    return 3;
  }

  if (status === 'warning') {
    return 2;
  }

  if (status === 'unknown') {
    return 1;
  }

  return 0;
}

function latestRunDescription(metric: MetricSnapshotRow | undefined): string {
  if (!metric) {
    return 'No recent run';
  }

  const workflowName = metadataText(metric.metadata, ['workflowName']) ?? 'Workflow';
  const conclusion = metadataText(metric.metadata, ['conclusion', 'status']) ?? 'unknown';
  const branch = metadataText(metric.metadata, ['branch']) ?? 'unknown branch';

  return `${workflowName}: ${conclusion} on ${branch}`;
}

export function githubActionsUsageSummary(metrics: MetricSnapshotRow[], projects: ProjectRow[]): GitHubActionsUsageSummary {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const grouped = new Map<string, MetricSnapshotRow[]>();

  for (const metric of metrics.filter((row) => providerKey(row) === 'github' && row.project_id)) {
    const repository = metadataText(metric.metadata, ['repository']) ?? 'Unknown repository';
    const key = `${metric.project_id}:${repository}`;
    const rows = grouped.get(key) ?? [];

    rows.push(metric);
    grouped.set(key, rows);
  }

  const rows = Array.from(grouped.values())
    .flatMap<GitHubActionsUsageRow>((group) => {
      const latestByMetric = latestMetricsByKey(group);
      const projectId = group[0]?.project_id ?? '';
      const project = projectById.get(projectId);
      const durationSeconds = latestByMetric.get('github_actions_recent_duration_seconds')?.metric_value ?? null;
      const latestRunMetric = latestByMetric.get('github_actions_latest_run_status');
      const latestSync =
        latestBy(
          group.map((metric) => metric.collected_at),
          (value) => value,
        ) ?? null;

      if (!latestRunMetric || latestRunMetric.metric_value === null) {
        return [];
      }

      return [
        {
          projectSlug: project?.slug ?? 'unknown',
          projectName: project?.name ?? 'Unknown project',
          repository: metadataText(group[0]?.metadata ?? null, ['repository']) ?? 'Unknown repository',
          latestRun: latestRunDescription(latestRunMetric),
          recentRuns: latestByMetric.get('github_actions_recent_run_count')?.metric_value ?? null,
          recentFailures: latestByMetric.get('github_actions_recent_failure_count')?.metric_value ?? null,
          scheduledRuns: latestByMetric.get('github_actions_scheduled_run_count')?.metric_value ?? null,
          scheduledFailures: latestByMetric.get('github_actions_scheduled_failure_count')?.metric_value ?? null,
          durationSeconds,
          runtimeMinutes: durationSeconds === null ? null : durationSeconds / 60,
          lastSync: latestSync,
          status: latestRunMetric?.status ?? 'unknown',
        },
      ];
    })
    .sort((a, b) => {
      const statusDelta = statusPriority(b.status) - statusPriority(a.status);

      if (statusDelta !== 0) {
        return statusDelta;
      }

      return (b.runtimeMinutes ?? 0) - (a.runtimeMinutes ?? 0);
    });

  const lastSync = latestBy(
    rows.map((row) => row.lastSync).filter((value): value is string => Boolean(value)),
    (value) => value,
  );

  return {
    runtimeMinutes: rows.reduce((total, row) => total + (row.runtimeMinutes ?? 0), 0),
    recentRuns: rows.reduce((total, row) => total + (row.recentRuns ?? 0), 0),
    recentFailures: rows.reduce((total, row) => total + (row.recentFailures ?? 0), 0),
    lastSync: lastSync ?? null,
    rows,
    runtimeSeries: buildTrendSeries(
      metrics.filter((row) => providerKey(row) === 'github' && row.metric_key === 'github_actions_recent_duration_seconds'),
      (row) => `${row.project_id}:${metadataText(row.metadata, ['repository']) ?? ''}`,
      1 / 60,
    ),
  };
}
