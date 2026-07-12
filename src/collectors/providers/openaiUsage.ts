import type { CollectorAdapterResult, CollectorCost, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';

export interface OpenAiUsageBucketResult {
  apiKeyId?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  requests?: number;
}

export interface OpenAiUsageBucket {
  startTime: number;
  endTime: number;
  results: OpenAiUsageBucketResult[];
}

export interface OpenAiCostBucketResult {
  amountUsd: number | null;
  lineItem?: string | null;
  projectId?: string | null;
}

export interface OpenAiCostBucket {
  startTime: number;
  endTime: number;
  results: OpenAiCostBucketResult[];
}

export interface OpenAiUsageClient {
  getUsage: (input: { startTime: number; endTime: number }) => Promise<OpenAiUsageBucket[]>;
  getCosts: (input: { startTime: number; endTime: number }) => Promise<OpenAiCostBucket[]>;
}

export interface OpenAiUsageOptions {
  client: OpenAiUsageClient;
  apiKeyLabels?: Record<string, string>;
  now?: Date;
  lookbackDays?: number;
}

interface UsageAccumulator {
  apiKeyId: string;
  apiKeyLabel: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  requests: number;
}

interface CostAccumulator {
  serviceName: string;
  projectId?: string;
  amountUsd: number;
  hasInvalidAmount: boolean;
  bucketCount: number;
}

type OpenAiMetricPeriod = 'current' | 'last_month';

function periodDates(start: number, end: number): { startDate: string; endDate: string } {
  return {
    startDate: new Date(start * 1000).toISOString().slice(0, 10),
    endDate: new Date(end * 1000).toISOString().slice(0, 10),
  };
}

function getUsagePeriod(options: OpenAiUsageOptions): { start: number; end: number; startDate: string; endDate: string } {
  const now = options.now ?? new Date();
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? 30));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
  const start = end - lookbackDays * 24 * 60 * 60;
  const dates = periodDates(start, end);

  return {
    start,
    end,
    ...dates,
  };
}

function getCostPeriod(options: OpenAiUsageOptions): { start: number; end: number; startDate: string; endDate: string } {
  const now = options.now ?? new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
  const dates = periodDates(start, end);

  return {
    start,
    end,
    ...dates,
  };
}

function getLastMonthPeriod(options: OpenAiUsageOptions): { start: number; end: number; startDate: string; endDate: string } {
  const now = options.now ?? new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) / 1000;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const dates = periodDates(start, end);

  return {
    start,
    end,
    ...dates,
  };
}

function safeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function apiKeyLabel(apiKeyId: string, labels: Record<string, string> | undefined): string {
  return labels?.[apiKeyId] ?? apiKeyId;
}

function usageKey(result: OpenAiUsageBucketResult): { apiKeyId: string; model: string } {
  return {
    apiKeyId: result.apiKeyId?.trim() || 'unknown_api_key',
    model: result.model?.trim() || 'unknown_model',
  };
}

function aggregateUsage(buckets: OpenAiUsageBucket[], labels: Record<string, string> | undefined): UsageAccumulator[] {
  const totals = new Map<string, UsageAccumulator>();

  for (const bucket of buckets) {
    for (const result of bucket.results) {
      const key = usageKey(result);
      const mapKey = `${key.apiKeyId}:${key.model}`;
      const existing =
        totals.get(mapKey) ??
        ({
          apiKeyId: key.apiKeyId,
          apiKeyLabel: apiKeyLabel(key.apiKeyId, labels),
          model: key.model,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          requests: 0,
        } satisfies UsageAccumulator);

      existing.inputTokens += safeNumber(result.inputTokens);
      existing.outputTokens += safeNumber(result.outputTokens);
      existing.cachedInputTokens += safeNumber(result.cachedInputTokens);
      existing.requests += safeNumber(result.requests);
      totals.set(mapKey, existing);
    }
  }

  return Array.from(totals.values()).sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
}

function usageTokenTotal(rows: UsageAccumulator[]): number {
  return rows.reduce((total, row) => total + row.inputTokens + row.outputTokens, 0);
}

function usageMetrics(rows: UsageAccumulator[], collectedAt: string, period: OpenAiMetricPeriod): CollectorMetric[] {
  return rows.flatMap((row) => {
    const metadata = {
      apiKeyId: row.apiKeyId,
      apiKeyLabel: row.apiKeyLabel,
      model: row.model,
      period,
      aggregateOnly: true,
    };

    return [
      {
        provider: 'openai',
        metricKey: 'openai_input_tokens',
        metricValue: row.inputTokens,
        status: 'healthy',
        metadata,
        collectedAt,
      },
      {
        provider: 'openai',
        metricKey: 'openai_output_tokens',
        metricValue: row.outputTokens,
        status: 'healthy',
        metadata,
        collectedAt,
      },
      {
        provider: 'openai',
        metricKey: 'openai_cached_input_tokens',
        metricValue: row.cachedInputTokens,
        status: 'healthy',
        metadata,
        collectedAt,
      },
      {
        provider: 'openai',
        metricKey: 'openai_requests',
        metricValue: row.requests,
        status: 'healthy',
        metadata,
        collectedAt,
      },
    ];
  });
}

function lastMonthUsageMetrics(rows: UsageAccumulator[], collectedAt: string): CollectorMetric[] {
  return [
    {
      provider: 'openai',
      metricKey: 'openai_last_month_tokens',
      metricValue: usageTokenTotal(rows),
      status: 'healthy',
      metadata: {
        period: 'last_month',
        aggregateOnly: true,
      },
      collectedAt,
    },
  ];
}

function usageResources(rows: UsageAccumulator[]): CollectorResource[] {
  const apiKeys = new Map<string, UsageAccumulator>();

  for (const row of rows) {
    apiKeys.set(row.apiKeyId, row);
  }

  return Array.from(apiKeys.values()).map((row) => ({
    provider: 'openai',
    resourceType: 'api_key_usage',
    externalId: row.apiKeyId,
    displayName: row.apiKeyLabel,
    metadata: {
      apiKeyId: row.apiKeyId,
      aggregateOnly: true,
    },
  }));
}

function costRows(
  buckets: OpenAiCostBucket[],
  period: { startDate: string; endDate: string },
  collectedAt: string,
  metricPeriod: OpenAiMetricPeriod,
): CollectorCost[] {
  const totals = new Map<string, CostAccumulator>();

  for (const bucket of buckets) {
    for (const result of bucket.results) {
      const serviceName = result.lineItem?.trim() || 'OpenAI API';
      const projectId = result.projectId?.trim() || undefined;
      const key = `${serviceName}:${projectId ?? 'unallocated'}`;
      const existing =
        totals.get(key) ??
        ({
          serviceName,
          projectId,
          amountUsd: 0,
          hasInvalidAmount: false,
          bucketCount: 0,
        } satisfies CostAccumulator);

      if (typeof result.amountUsd === 'number' && Number.isFinite(result.amountUsd)) {
        existing.amountUsd += result.amountUsd;
      } else {
        existing.hasInvalidAmount = true;
      }

      existing.bucketCount += 1;
      totals.set(key, existing);
    }
  }

  return Array.from(totals.values()).map((row) => ({
    provider: 'openai',
    serviceName: row.serviceName,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    amountUsd: row.hasInvalidAmount ? null : row.amountUsd,
    metadata: {
      source: 'openai_organization_costs',
      projectId: row.projectId,
      bucketCount: row.bucketCount,
      period: metricPeriod,
      aggregateOnly: true,
    },
    collectedAt,
  }));
}

function costMetric(costs: CollectorCost[], collectedAt: string, metricKey: string, period: OpenAiMetricPeriod): CollectorMetric {
  const total = costs.reduce((sum, cost) => {
    return sum + (typeof cost.amountUsd === 'number' && Number.isFinite(cost.amountUsd) ? cost.amountUsd : 0);
  }, 0);

  return {
    provider: 'openai',
    metricKey,
    metricValue: total,
    status: costs.some((cost) => cost.amountUsd === null) ? 'warning' : 'healthy',
    metadata: {
      period,
      aggregateOnly: true,
    },
    collectedAt,
  };
}

export async function collectOpenAiUsage(options: OpenAiUsageOptions): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const collectedAt = new Date().toISOString();
  const usagePeriod = getUsagePeriod(options);
  const costPeriod = getCostPeriod(options);
  const lastMonthPeriod = getLastMonthPeriod(options);

  try {
    const [usageBuckets, costBuckets, lastMonthUsageBuckets, lastMonthCostBuckets] = await Promise.all([
      options.client.getUsage({ startTime: usagePeriod.start, endTime: usagePeriod.end }),
      options.client.getCosts({ startTime: costPeriod.start, endTime: costPeriod.end }),
      options.client.getUsage({ startTime: lastMonthPeriod.start, endTime: lastMonthPeriod.end }),
      options.client.getCosts({ startTime: lastMonthPeriod.start, endTime: lastMonthPeriod.end }),
    ]);
    const usage = aggregateUsage(usageBuckets, options.apiKeyLabels);
    const lastMonthUsage = aggregateUsage(lastMonthUsageBuckets, options.apiKeyLabels);
    const costs = costRows(costBuckets, costPeriod, collectedAt, 'current');
    const lastMonthCosts = costRows(lastMonthCostBuckets, lastMonthPeriod, collectedAt, 'last_month');
    const allCosts = [...costs, ...lastMonthCosts];
    const metrics = [
      ...usageMetrics(usage, collectedAt, 'current'),
      ...lastMonthUsageMetrics(lastMonthUsage, collectedAt),
      costMetric(costs, collectedAt, 'openai_spend_usd', 'current'),
      costMetric(lastMonthCosts, collectedAt, 'openai_last_month_spend_usd', 'last_month'),
    ];
    const status = allCosts.some((cost) => cost.amountUsd === null) ? 'partial_success' : 'success';

    return {
      provider: 'openai',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: `${usage.length} current OpenAI API key/model usage rows, ${lastMonthUsage.length} last-month usage rows, and ${allCosts.length} cost rows collected.`,
      resources: usageResources(usage),
      metrics,
      costs: allCosts,
      healthChecks: [],
      errors: [],
    };
  } catch (error) {
    return {
      provider: 'openai',
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: 'OpenAI usage collection failed.',
      resources: [],
      metrics: [],
      costs: [],
      healthChecks: [],
      errors: [
        {
          message: getErrorMessage(error, 'OpenAI usage collection failed'),
          retryable: true,
        },
      ],
    };
  }
}

export function createOpenAiUsageAdapter(options: OpenAiUsageOptions): ProviderAdapter {
  return {
    provider: 'openai',
    collect: () => collectOpenAiUsage(options),
  };
}
