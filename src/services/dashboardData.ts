import type { SupabaseClient } from '@supabase/supabase-js';
import { freshnessOf, getOverallStatus } from '../lib/status';
import type {
  CollectorErrorSummary,
  CollectorRunSummary,
  CostPoint,
  CostSnapshot,
  DomainSummary,
  GitHubActionsUsageRow,
  GitHubActionsUsageSummary,
  LatencyPoint,
  OpenAiUsageRow,
  OpenAiUsageSummary,
  ProjectHistory,
  ProjectResource,
  ProjectSlug,
  ProjectStatus,
  ProviderKey,
  ProviderStatus,
  SnapshotSummary,
  StatusLevel,
  UnallocatedCostSnapshot,
  UptimeDay,
} from '../types';

interface ProviderRow {
  key: ProviderKey;
  name: string;
}

interface ProjectRow {
  id: string;
  slug: ProjectSlug;
  name: string;
  public_url: string | null;
}

interface ResourceRow {
  id: string;
  project_id: string | null;
  resource_type: string;
  display_name: string;
  metadata: Record<string, unknown> | null;
  last_seen_at: string | null;
  providers: ProviderRow | ProviderRow[] | null;
}

interface MetricSnapshotRow {
  project_id: string | null;
  metric_key: string;
  metric_value: number | null;
  status: StatusLevel;
  metadata: Record<string, unknown> | null;
  collected_at: string;
  providers: ProviderRow | ProviderRow[] | null;
}

interface CostSnapshotRow {
  project_id: string | null;
  service_name: string;
  period_start: string;
  period_end: string;
  amount_usd: number | null;
  metadata: Record<string, unknown> | null;
  collected_at: string;
  providers: ProviderRow | ProviderRow[] | null;
}

interface HealthCheckRow {
  project_id: string;
  url: string;
  status: StatusLevel;
  http_status: number | null;
  response_time_ms: number | null;
  error_message: string | null;
  checked_at: string;
}

/**
 * Trimmed projection of health_checks for the 30-day window. Kept in its own array and never
 * merged into DashboardRows.healthChecks, so every existing dedup-to-latest path is untouched
 * by construction.
 */
interface HealthCheckHistoryRow {
  project_id: string;
  status: StatusLevel;
  response_time_ms: number | null;
  checked_at: string;
}

interface CollectorRunRow {
  started_at: string;
  finished_at: string | null;
  status: CollectorRunSummary['status'];
  summary: string | null;
  error_message: string | null;
  metadata: {
    adapterKey?: string;
    errors?: Array<{ projectSlug?: ProjectSlug; message: string }>;
  } | null;
  providers: ProviderRow | ProviderRow[] | null;
}

interface DashboardRows {
  projects: ProjectRow[];
  resources: ResourceRow[];
  metrics: MetricSnapshotRow[];
  costs: CostSnapshotRow[];
  healthChecks: HealthCheckRow[];
  healthCheckHistory: HealthCheckHistoryRow[];
  collectorRuns: CollectorRunRow[];
}

export interface DashboardData {
  projects: ProjectStatus[];
  domains: DomainSummary[];
  unallocatedCosts: UnallocatedCostSnapshot[];
  collectorRuns: CollectorRunSummary[];
  openAiUsage: OpenAiUsageSummary;
  githubActionsUsage: GitHubActionsUsageSummary;
  lastMonthCostUsd: number | null;
  mtdCostSeries: CostPoint[];
}

const providerLabels: Record<ProviderKey, string> = {
  aws: 'AWS',
  amplify: 'Amplify',
  supabase: 'Supabase',
  resend: 'Resend',
  cloudflare: 'Cloudflare',
  openai: 'OpenAI',
  github: 'GitHub Actions',
  http: 'Public URL',
};

function providerLabel(provider: ProviderKey): string {
  return providerLabels[provider] ?? provider;
}

const validStatuses = new Set<StatusLevel>(['healthy', 'warning', 'failed', 'unknown']);

function currentMonthBounds(now = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10),
  };
}

function lastMonthBounds(now = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
  };
}

function isPeriodRow(row: CostSnapshotRow, period: { startDate: string; endDate: string }): boolean {
  return row.period_start === period.startDate && row.period_end <= period.endDate && row.period_end > period.startDate;
}

/** How many days of latency/uptime history the dashboard reads and renders. */
export const HISTORY_WINDOW_DAYS = 30;

/**
 * Day keys are UTC throughout, matching currentMonthBounds/lastMonthBounds. Display code must
 * label cells with the explicit date rather than a local-time weekday, or the two disagree.
 */
export function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** The window's day keys, oldest first, always exactly `days` long including today. */
export function utcDayRange(days: number, now = new Date()): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Array.from({ length: days }, (_, index) => new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

/** Inclusive lower bound for the history query: midnight UTC on the window's first day. */
export function historySince(days: number, now = new Date()): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return new Date(today - (days - 1) * 86_400_000).toISOString();
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function groupChecksByDay(checks: HealthCheckHistoryRow[]): Map<string, HealthCheckHistoryRow[]> {
  const byDay = new Map<string, HealthCheckHistoryRow[]>();

  for (const check of checks) {
    const day = utcDayKey(check.checked_at);
    const existing = byDay.get(day);

    if (existing) {
      existing.push(check);
    } else {
      byDay.set(day, [check]);
    }
  }

  return byDay;
}

/**
 * One cell per day in the window. Days the collector never wrote become 'no-data', never
 * 'down' — a missed run is silence, not an outage, and conflating them invents incidents.
 */
function buildUptimeDays(checks: HealthCheckHistoryRow[], days: string[]): UptimeDay[] {
  const byDay = groupChecksByDay(checks);

  return days.map((day) => {
    const dayChecks = byDay.get(day) ?? [];
    const failed = dayChecks.filter((check) => check.status === 'failed').length;
    const degraded = dayChecks.filter((check) => check.status === 'warning').length;

    if (dayChecks.length === 0) {
      return { day, state: 'no-data', checks: 0, failed: 0 };
    }

    if (failed === dayChecks.length) {
      return { day, state: 'down', checks: dayChecks.length, failed };
    }

    if (failed > 0 || degraded > 0) {
      return { day, state: 'degraded', checks: dayChecks.length, failed };
    }

    return { day, state: 'up', checks: dayChecks.length, failed };
  });
}

/**
 * Median rather than mean: with a retry outlier on a low-sample day, the mean misrepresents
 * the typical response. Days without a check carry null so the sparkline renders a gap.
 */
function buildLatencyPoints(checks: HealthCheckHistoryRow[], days: string[]): LatencyPoint[] {
  const byDay = groupChecksByDay(checks);

  return days.map((day) => {
    const times = (byDay.get(day) ?? [])
      .map((check) => check.response_time_ms)
      .filter((value): value is number => typeof value === 'number');

    return { day, p50Ms: times.length === 0 ? null : Math.round(median(times)) };
  });
}

export function buildProjectHistory(
  projectId: string,
  checks: HealthCheckHistoryRow[],
  windowDays = HISTORY_WINDOW_DAYS,
  now = new Date(),
): ProjectHistory {
  const days = utcDayRange(windowDays, now);
  const projectChecks = checks.filter((check) => check.project_id === projectId);

  return {
    windowDays,
    latency: buildLatencyPoints(projectChecks, days),
    uptime: buildUptimeDays(projectChecks, days),
  };
}

/**
 * cost_snapshots.amount_usd is cumulative for its period and resets on the 1st, so this is
 * scoped to the current month only. A naive 30-day series would render the rollover as a
 * cliff. Points are cumulative MTD totals as of each collection day, not daily spend.
 */
export function buildMtdCostSeries(costs: CostSnapshotRow[], now = new Date()): CostPoint[] {
  const period = currentMonthBounds(now);
  const latestPerDay = new Map<string, Map<string, CostSnapshotRow>>();

  for (const row of costs.filter((cost) => isPeriodRow(cost, period))) {
    const day = utcDayKey(row.collected_at);
    const key = [row.project_id ?? 'unallocated', providerKey(row) ?? 'unknown', row.service_name].join(':');
    const dayRows = latestPerDay.get(day) ?? new Map<string, CostSnapshotRow>();
    const existing = dayRows.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      dayRows.set(key, row);
    }

    latestPerDay.set(day, dayRows);
  }

  return Array.from(latestPerDay.entries())
    .map(([day, dayRows]) => ({
      day,
      cumulativeUsd: Array.from(dayRows.values()).reduce((total, row) => total + (row.amount_usd ?? 0), 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function validateRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Dashboard data is invalid: ${fieldName} is missing.`);
  }

  return value;
}

function validateProjectRows(projects: ProjectRow[]): void {
  for (const project of projects) {
    validateRequiredText(project.id, 'projects.id');
    validateRequiredText(project.name, 'projects.name');
    validateRequiredText(project.slug, 'projects.slug');
  }
}

function validateStatusRows(rows: DashboardRows): void {
  const statusRows = [
    ...rows.metrics.map((row) => ({
      status: row.status,
      table: 'metric_snapshots',
    })),
    ...rows.healthChecks.map((row) => ({
      status: row.status,
      table: 'health_checks',
    })),
  ];

  for (const row of statusRows) {
    if (!validStatuses.has(row.status)) {
      throw new Error(`Dashboard data is invalid: ${row.table}.status "${String(row.status)}" is not supported.`);
    }
  }
}

function latestBy<T>(rows: T[], getTime: (row: T) => string | null | undefined): T | undefined {
  return rows.slice().sort((a, b) => new Date(getTime(b) ?? 0).getTime() - new Date(getTime(a) ?? 0).getTime())[0];
}

function latestCostRows(rows: CostSnapshotRow[]): CostSnapshotRow[] {
  const latest = new Map<string, CostSnapshotRow>();

  for (const row of rows) {
    const key = [row.project_id ?? 'unallocated', providerKey(row) ?? 'unknown', row.service_name, row.period_start].join(':');
    const existing = latest.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latest.set(key, row);
    }
  }

  return Array.from(latest.values()).filter((row) => (row.amount_usd ?? 0) > 0);
}

function costTotal(rows: CostSnapshotRow[]): number | null {
  return rows.reduce<number | null>((total, row) => {
    if (row.amount_usd === null) {
      return total;
    }

    return (total ?? 0) + row.amount_usd;
  }, null);
}

function metadataText(metadata: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

function snapshotServiceKey(row: MetricSnapshotRow): string {
  const provider = providerKey(row) ?? 'unknown';
  const service =
    metadataText(row.metadata, ['serviceName', 'url', 'domain', 'appId', 'projectRef', 'rpcName', 'category']) ?? row.metric_key;

  return `${provider}:${service}`;
}

function latestSnapshotRows(rows: MetricSnapshotRow[]): MetricSnapshotRow[] {
  const latest = new Map<string, MetricSnapshotRow>();

  for (const row of rows.filter(isRecentSnapshotMetric)) {
    const key = snapshotServiceKey(row);
    const existing = latest.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latest.set(key, row);
    }
  }

  return Array.from(latest.values()).sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime());
}

function isRecentSnapshotMetric(row: MetricSnapshotRow): boolean {
  return !row.metric_key.startsWith('github_actions_');
}

function providerKey(row: { providers: ProviderRow | ProviderRow[] | null }): ProviderKey | null {
  const provider = Array.isArray(row.providers) ? row.providers[0] : row.providers;

  return provider?.key ?? null;
}

function snapshotLabel(metricKey: string): string {
  return metricKey.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metricValue(metric: MetricSnapshotRow): string {
  if (metric.metric_value === null) {
    return 'No numeric value';
  }

  if (metric.metric_key.includes('cost')) {
    return `$${metric.metric_value.toFixed(2)}`;
  }

  return String(metric.metric_value);
}

function metadataPeriod(metadata: Record<string, unknown> | null): string | null {
  const value = metadata?.period;

  return typeof value === 'string' && value.trim() ? value : null;
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

function openAiUsageSummary(metrics: MetricSnapshotRow[], costs: CostSnapshotRow[]): OpenAiUsageSummary {
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

function githubActionsUsageSummary(metrics: MetricSnapshotRow[], projects: ProjectRow[]): GitHubActionsUsageSummary {
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
  };
}

function resourceDetail(resource: ResourceRow): string {
  const metadata = resource.metadata ?? {};
  const details = Object.entries(metadata)
    .filter(
      ([key, value]) => key !== 'aggregateOnly' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    )
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return details.length > 0 ? details.join(', ') : `Last seen ${resource.last_seen_at ?? 'unknown'}`;
}

function providerDetail(
  provider: ProviderKey,
  latestMetric: MetricSnapshotRow | undefined,
  latestHealth: HealthCheckRow | undefined,
  latestResource: ResourceRow | undefined,
) {
  if (provider === 'http' && latestHealth) {
    return latestHealth.http_status
      ? `${latestHealth.http_status} in ${latestHealth.response_time_ms ?? 0} ms`
      : (latestHealth.error_message ?? 'HTTP health check failed');
  }

  if (latestMetric) {
    return `${snapshotLabel(latestMetric.metric_key)}: ${metricValue(latestMetric)}`;
  }

  if (latestResource) {
    return resourceDetail(latestResource);
  }

  return 'Waiting for first collector sync';
}

function latestProviderStatuses(
  projectId: string,
  metrics: MetricSnapshotRow[],
  healthChecks: HealthCheckRow[],
  resources: ResourceRow[],
): ProviderStatus[] {
  const providers = new Set<ProviderKey>();

  metrics
    .filter((metric) => metric.project_id === projectId)
    .forEach((metric) => {
      const key = providerKey(metric);

      if (key) {
        providers.add(key);
      }
    });

  resources
    .filter((resource) => resource.project_id === projectId)
    .forEach((resource) => {
      const key = providerKey(resource);

      if (key) {
        providers.add(key);
      }
    });

  if (healthChecks.some((check) => check.project_id === projectId)) {
    providers.add('http');
  }

  return Array.from(providers)
    .sort()
    .map((provider) => {
      const latestMetric = latestBy(
        metrics.filter((metric) => metric.project_id === projectId && providerKey(metric) === provider),
        (metric) => metric.collected_at,
      );
      const latestHealth =
        provider === 'http'
          ? latestBy(
              healthChecks.filter((check) => check.project_id === projectId),
              (check) => check.checked_at,
            )
          : undefined;
      const latestResource = latestBy(
        resources.filter((resource) => resource.project_id === projectId && providerKey(resource) === provider),
        (resource) => resource.last_seen_at,
      );

      const lastSync = latestHealth?.checked_at ?? latestMetric?.collected_at ?? latestResource?.last_seen_at ?? null;

      return {
        provider,
        label: providerLabel(provider),
        status: latestHealth?.status ?? latestMetric?.status ?? (latestResource ? 'healthy' : 'unknown'),
        detail: providerDetail(provider, latestMetric, latestHealth, latestResource),
        lastSync,
        freshness: freshnessOf(lastSync),
      };
    });
}

function runDurationMs(run: CollectorRunRow): number | null {
  if (!run.finished_at) {
    return null;
  }

  const startedAt = new Date(run.started_at).getTime();
  const finishedAt = new Date(run.finished_at).getTime();

  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) {
    return null;
  }

  return Math.max(0, finishedAt - startedAt);
}

function affectedProjects(run: CollectorRunRow): ProjectSlug[] {
  const slugs = new Set<ProjectSlug>();

  for (const error of run.metadata?.errors ?? []) {
    if (typeof error.projectSlug === 'string' && error.projectSlug.trim()) {
      slugs.add(error.projectSlug);
    }
  }

  return Array.from(slugs).sort();
}

// Several adapters can share one provider key (e.g. supabase project health + one
// aggregate adapter per watched app), so runs are grouped per adapter, not per provider.
function runAdapterKey(run: CollectorRunRow): string {
  return `${providerKey(run) ?? 'http'}:${run.metadata?.adapterKey ?? ''}`;
}

function collectorRunSummaries(collectorRuns: CollectorRunRow[]): CollectorRunSummary[] {
  const latestByAdapter = new Map<string, CollectorRunRow>();

  for (const run of collectorRuns) {
    const key = runAdapterKey(run);
    const existing = latestByAdapter.get(key);

    if (!existing || new Date(run.started_at).getTime() > new Date(existing.started_at).getTime()) {
      latestByAdapter.set(key, run);
    }
  }

  return Array.from(latestByAdapter.values())
    .map<CollectorRunSummary>((run) => {
      const provider = providerKey(run) ?? 'http';

      return {
        provider,
        providerLabel: providerLabel(provider),
        status: run.status,
        summary: run.summary,
        errorMessage: run.error_message,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        lastSyncedAt: run.finished_at ?? run.started_at,
        durationMs: runDurationMs(run),
        affectedProjects: affectedProjects(run),
      };
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function collectorErrors(projectSlug: ProjectSlug, collectorRuns: CollectorRunRow[]): CollectorErrorSummary[] {
  const latestSuccessByAdapter = new Map<string, number>();

  for (const run of collectorRuns) {
    if (!providerKey(run) || run.status !== 'success') {
      continue;
    }

    const key = runAdapterKey(run);
    const finishedAt = new Date(run.finished_at ?? run.started_at).getTime();
    const existing = latestSuccessByAdapter.get(key) ?? 0;

    if (finishedAt > existing) {
      latestSuccessByAdapter.set(key, finishedAt);
    }
  }

  return collectorRuns.flatMap((run) => {
    const provider = providerKey(run);
    const occurredAt = run.finished_at ?? run.started_at;
    const newerSuccessAt = provider ? latestSuccessByAdapter.get(runAdapterKey(run)) : undefined;

    if (newerSuccessAt && newerSuccessAt > new Date(occurredAt).getTime()) {
      return [];
    }

    const metadataErrors = run.metadata?.errors ?? [];
    const scopedErrors = metadataErrors
      .filter((error) => !error.projectSlug || error.projectSlug === projectSlug)
      .map((error) => ({
        provider: provider ?? 'http',
        message: error.message,
        occurredAt,
      }));

    if (scopedErrors.length > 0) {
      return scopedErrors;
    }

    if (!run.error_message || run.status === 'success' || run.status === 'skipped') {
      return [];
    }

    return [
      {
        provider: provider ?? 'http',
        message: run.error_message,
        occurredAt,
      },
    ];
  });
}

function domainMetric(metrics: MetricSnapshotRow[], domain: string, metricKey: string): MetricSnapshotRow | undefined {
  return latestBy(
    metrics.filter(
      (metric) => providerKey(metric) === 'cloudflare' && metric.metric_key === metricKey && metric.metadata?.domain === domain,
    ),
    (metric) => metric.collected_at,
  );
}

function stringMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];

  return typeof value === 'string' ? value : null;
}

function booleanMetadata(metadata: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = metadata?.[key];

  return typeof value === 'boolean' ? value : null;
}

function latestZoneResourcesByDomain(resources: ResourceRow[]): ResourceRow[] {
  const latestByDomain = new Map<string, ResourceRow>();

  resources
    .filter((resource) => providerKey(resource) === 'cloudflare' && resource.resource_type === 'zone')
    .forEach((resource) => {
      const domain = resource.display_name;
      const existing = latestByDomain.get(domain);

      if (!existing || new Date(resource.last_seen_at ?? 0).getTime() > new Date(existing.last_seen_at ?? 0).getTime()) {
        latestByDomain.set(domain, resource);
      }
    });

  return Array.from(latestByDomain.values());
}

function domainDnsRecords(resources: ResourceRow[], domain: string): DomainSummary['dnsRecords'] {
  return resources
    .filter(
      (resource) =>
        providerKey(resource) === 'cloudflare' &&
        resource.resource_type === 'dns_record' &&
        stringMetadata(resource.metadata, 'domain') === domain,
    )
    .map((resource) => ({
      type: stringMetadata(resource.metadata, 'type') ?? 'UNKNOWN',
      name: stringMetadata(resource.metadata, 'name') ?? resource.display_name,
      proxied: booleanMetadata(resource.metadata, 'proxied'),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function buildDomainSummaries(resources: ResourceRow[], metrics: MetricSnapshotRow[]): DomainSummary[] {
  return latestZoneResourcesByDomain(resources)
    .map((resource) => {
      const domain = resource.display_name;
      const zoneStatus = stringMetadata(resource.metadata, 'status') ?? 'unknown';
      const zoneActiveMetric = domainMetric(metrics, domain, 'cloudflare_zone_active');
      const expirationMetric = domainMetric(metrics, domain, 'cloudflare_domain_expiration_days');
      const registrarMetric = domainMetric(metrics, domain, 'cloudflare_registrar_on_cloudflare');
      const dnsCountMetric = domainMetric(metrics, domain, 'cloudflare_dns_record_count');
      const proxiedMetric = domainMetric(metrics, domain, 'cloudflare_proxied_record_count');
      const mxMetric = domainMetric(metrics, domain, 'cloudflare_mx_record_count');
      const apexMetric = domainMetric(metrics, domain, 'cloudflare_apex_record_present');
      const wwwMetric = domainMetric(metrics, domain, 'cloudflare_www_record_present');
      const lastSync =
        latestBy(
          [zoneActiveMetric, expirationMetric, registrarMetric, dnsCountMetric].filter((metric): metric is MetricSnapshotRow =>
            Boolean(metric),
          ),
          (metric) => metric.collected_at,
        )?.collected_at ?? resource.last_seen_at;

      return {
        domain,
        status: getOverallStatus([zoneActiveMetric?.status ?? 'unknown', expirationMetric?.status ?? 'unknown']),
        zoneStatus,
        registrar: stringMetadata(registrarMetric?.metadata, 'registrar'),
        expiresAt: stringMetadata(expirationMetric?.metadata, 'expiresAt'),
        expirationDays: expirationMetric?.metric_value ?? null,
        autoRenew: booleanMetadata(expirationMetric?.metadata, 'autoRenew'),
        locked: booleanMetadata(expirationMetric?.metadata, 'locked'),
        dnsRecordCount: dnsCountMetric?.metric_value ?? null,
        proxiedRecordCount: proxiedMetric?.metric_value ?? null,
        mxRecordCount: mxMetric?.metric_value ?? null,
        apexRecordPresent: apexMetric ? apexMetric.metric_value === 1 : null,
        wwwRecordPresent: wwwMetric ? wwwMetric.metric_value === 1 : null,
        lastSync,
        dnsRecords: domainDnsRecords(resources, domain),
      };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

function projectFromRows(project: ProjectRow, rows: DashboardRows): ProjectStatus {
  const metrics = rows.metrics.filter((metric) => metric.project_id === project.id);
  const resources = rows.resources.filter((resource) => resource.project_id === project.id);
  const healthChecks = rows.healthChecks.filter((check) => check.project_id === project.id);
  const costs = rows.costs.filter((cost) => cost.project_id === project.id);
  const latestHttp = latestBy(healthChecks, (check) => check.checked_at);
  const latestDeploy = latestBy(
    metrics.filter(
      (metric) => providerKey(metric) === 'amplify' || metric.metric_key.endsWith('_deploy_status'),
    ),
    (metric) => metric.collected_at,
  );
  const lastSync = latestBy(
    [
      ...metrics.map((metric) => metric.collected_at),
      ...healthChecks.map((check) => check.checked_at),
      ...costs.map((cost) => cost.collected_at),
    ],
    (value) => value,
  );
  const projectCosts: CostSnapshot[] = costs.map((cost) => ({
    provider: providerKey(cost) ?? 'aws',
    serviceName: cost.service_name,
    monthToDateUsd: cost.amount_usd,
  }));

  return {
    slug: project.slug,
    name: project.name,
    publicUrl: project.public_url ?? '',
    deployStatus: latestDeploy?.status ?? 'unknown',
    uptimeStatus: latestHttp?.status ?? 'unknown',
    lastSync: lastSync ?? null,
    providers: latestProviderStatuses(project.id, rows.metrics, rows.healthChecks, rows.resources),
    costs: projectCosts,
    resources: resources
      .filter((resource) => providerKey(resource) !== 'cloudflare')
      .map<ProjectResource>((resource) => ({
        id: resource.id,
        provider: providerKey(resource) ?? 'http',
        type: resource.resource_type,
        name: resource.display_name,
        status: 'healthy',
        detail: resourceDetail(resource),
      })),
    recentSnapshots: latestSnapshotRows(metrics)
      .slice(0, 8)
      .map<SnapshotSummary>((metric) => ({
        label: snapshotLabel(metric.metric_key),
        provider: providerKey(metric) ?? 'http',
        status: metric.status,
        value: metricValue(metric),
        collectedAt: metric.collected_at,
      })),
    collectorErrors: collectorErrors(project.slug, rows.collectorRuns),
    history: buildProjectHistory(project.id, rows.healthCheckHistory),
  };
}

async function selectRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function fetchDashboardData(client: SupabaseClient): Promise<DashboardData> {
  // Snapshots are append-only, so each select reads only the newest N rows and the
  // dedup-to-latest happens client-side. The limits assume a handful of projects on a
  // daily collector cadence; with many more projects/domains (or a much faster cadence)
  // older-but-still-current keys could fall outside the window and disappear from the
  // dashboard — raise the limits if the fleet grows.
  const [projects, resources, metrics, costs, healthChecks, healthCheckHistory, collectorRuns] = await Promise.all([
    selectRows<ProjectRow>(
      client
        .from('projects')
        .select('id, slug, name, public_url')
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name'),
    ),
    selectRows<ResourceRow>(
      client
        .from('resources')
        .select('id, project_id, resource_type, display_name, metadata, last_seen_at, providers(key, name)')
        .order('last_seen_at', { ascending: false }),
    ),
    selectRows<MetricSnapshotRow>(
      client
        .from('metric_snapshots')
        .select('project_id, metric_key, metric_value, status, metadata, collected_at, providers(key, name)')
        .order('collected_at', { ascending: false })
        .limit(1000),
    ),
    selectRows<CostSnapshotRow>(
      client
        .from('cost_snapshots')
        .select('project_id, service_name, period_start, period_end, amount_usd, metadata, collected_at, providers(key, name)')
        .order('collected_at', { ascending: false })
        .limit(100),
    ),
    selectRows<HealthCheckRow>(
      client
        .from('health_checks')
        .select('project_id, url, status, http_status, response_time_ms, error_message, checked_at')
        .order('checked_at', { ascending: false })
        .limit(100),
    ),
    // Separate from the query above on purpose. That one stays unbounded-in-time so
    // uptimeStatus still reflects the newest check even when it predates the window; this one
    // is a narrow 4-column projection bounded to the window, and feeds only the trend charts.
    selectRows<HealthCheckHistoryRow>(
      client
        .from('health_checks')
        .select('project_id, status, response_time_ms, checked_at')
        .gte('checked_at', historySince(HISTORY_WINDOW_DAYS))
        .order('checked_at', { ascending: true })
        .limit(2000),
    ),
    selectRows<CollectorRunRow>(
      client
        .from('collector_runs')
        .select('started_at, finished_at, status, summary, error_message, metadata, providers(key, name)')
        .order('started_at', { ascending: false })
        .limit(200),
    ),
  ]);

  const currentPeriod = currentMonthBounds();
  const lastMonthPeriod = lastMonthBounds();
  const latestCosts = latestCostRows(costs.filter((cost) => isPeriodRow(cost, currentPeriod)));
  const latestLastMonthCosts = latestCostRows(costs.filter((cost) => isPeriodRow(cost, lastMonthPeriod)));
  const lastMonthCostUsd = costTotal(latestLastMonthCosts);
  const rows = {
    projects,
    resources,
    metrics,
    costs: latestCosts,
    healthChecks,
    healthCheckHistory,
    collectorRuns,
  };

  validateProjectRows(projects);
  validateStatusRows(rows);

  const unallocatedCosts = latestCosts
    .filter((cost) => cost.project_id === null)
    .map<UnallocatedCostSnapshot>((cost) => ({
      provider: providerKey(cost) ?? 'aws',
      serviceName: cost.service_name,
      monthToDateUsd: cost.amount_usd,
    }));

  return {
    projects: projects.map((project) =>
      projectFromRows(project, {
        ...rows,
      }),
    ),
    domains: buildDomainSummaries(resources, metrics),
    unallocatedCosts: unallocatedCosts.sort((a, b) => (b.monthToDateUsd ?? 0) - (a.monthToDateUsd ?? 0)),
    collectorRuns: collectorRunSummaries(collectorRuns),
    openAiUsage: openAiUsageSummary(metrics, costs),
    githubActionsUsage: githubActionsUsageSummary(metrics, projects),
    lastMonthCostUsd,
    mtdCostSeries: buildMtdCostSeries(costs),
  };
}
