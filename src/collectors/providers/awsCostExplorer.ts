import type { CollectorAdapterResult, CollectorCost, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';

export interface CostExplorerGroup {
  Keys: string[];
  Metrics?: {
    UnblendedCost?: {
      Amount?: string;
      Unit?: string;
    };
  };
}

export interface CostExplorerResultByTime {
  TimePeriod?: {
    Start?: string;
    End?: string;
  };
  Groups?: CostExplorerGroup[];
}

export interface CostExplorerClient {
  getCostAndUsage: (input: {
    TimePeriod: { Start: string; End: string };
    Granularity: 'MONTHLY';
    Metrics: ['UnblendedCost'];
    GroupBy: [{ Type: 'DIMENSION'; Key: 'SERVICE' }];
  }) => Promise<{ ResultsByTime?: CostExplorerResultByTime[] }>;
}

export interface AwsCostExplorerOptions {
  client: CostExplorerClient;
  now?: Date;
}

function getMonthToDatePeriod(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: tomorrow.toISOString().slice(0, 10),
  };
}

function getLastMonthPeriod(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function parseAmount(group: CostExplorerGroup): number | null {
  const amount = group.Metrics?.UnblendedCost?.Amount;

  if (amount === undefined) {
    return null;
  }

  const parsed = Number(amount);

  return Number.isFinite(parsed) ? parsed : null;
}

function buildCostRows(
  group: CostExplorerGroup,
  period: { start: string; end: string },
  collectedAt: string,
  metricPeriod: 'current' | 'last_month',
): CollectorCost[] {
  const serviceName = group.Keys[0] ?? 'Unknown AWS Service';
  const amountUsd = parseAmount(group);

  return [
    {
      provider: 'aws',
      serviceName,
      periodStart: period.start,
      periodEnd: period.end,
      amountUsd,
      metadata: {
        source: 'cost_explorer',
        unit: group.Metrics?.UnblendedCost?.Unit ?? 'USD',
        period: metricPeriod,
      },
      collectedAt,
    },
  ];
}

async function collectCostPeriod(
  options: AwsCostExplorerOptions,
  period: { start: string; end: string },
  metricPeriod: 'current' | 'last_month',
  collectedAt: string,
): Promise<CollectorCost[]> {
  const response = await options.client.getCostAndUsage({
    TimePeriod: {
      Start: period.start,
      End: period.end,
    },
    Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  });
  const groups = response.ResultsByTime?.flatMap((result) => result.Groups ?? []) ?? [];

  return groups.flatMap((group) => buildCostRows(group, period, collectedAt, metricPeriod));
}

export async function collectAwsCostExplorer(options: AwsCostExplorerOptions): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const collectedAt = new Date().toISOString();
  const period = getMonthToDatePeriod(options.now);
  const lastMonthPeriod = getLastMonthPeriod(options.now);

  try {
    const [costs, lastMonthCosts] = await Promise.all([
      collectCostPeriod(options, period, 'current', collectedAt),
      collectCostPeriod(options, lastMonthPeriod, 'last_month', collectedAt),
    ]);
    const allCosts = [...costs, ...lastMonthCosts];

    return {
      provider: 'aws',
      status: allCosts.some((cost) => cost.amountUsd === null) ? 'partial_success' : 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: `${costs.length} current AWS cost rows, ${lastMonthCosts.length} last-month rows collected.`,
      resources: [],
      metrics: [],
      costs: allCosts,
      healthChecks: [],
      errors: [],
    };
  } catch (error) {
    return {
      provider: 'aws',
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: 'AWS Cost Explorer collection failed.',
      resources: [],
      metrics: [],
      costs: [],
      healthChecks: [],
      errors: [
        {
          message: getErrorMessage(error, 'AWS Cost Explorer collection failed'),
          retryable: true,
        },
      ],
    };
  }
}

export function createAwsCostExplorerAdapter(options: AwsCostExplorerOptions): ProviderAdapter {
  return {
    provider: 'aws',
    collect: () => collectAwsCostExplorer(options),
  };
}
