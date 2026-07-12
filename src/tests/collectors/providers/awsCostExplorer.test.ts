import { describe, expect, it, vi } from 'vitest';
import { collectAwsCostExplorer, type CostExplorerClient, type CostExplorerGroup } from '../../../collectors/providers/awsCostExplorer';

interface TestCostGroup {
  serviceName: string;
  amount?: string;
  unit?: string;
}

function groupsForResponse(groups: TestCostGroup[]): CostExplorerGroup[] {
  return groups.map((group) => ({
    Keys: [group.serviceName],
    Metrics: {
      UnblendedCost: {
        Amount: group.amount,
        Unit: group.unit ?? 'USD',
      },
    },
  }));
}

function createClient(groups: TestCostGroup[], lastMonthGroups: TestCostGroup[] = []): CostExplorerClient {
  return {
    getCostAndUsage: vi.fn().mockImplementation(({ TimePeriod }) => {
      const isLastMonth = TimePeriod.Start === '2026-05-01';

      return Promise.resolve({
        ResultsByTime: [
          {
            TimePeriod: {
              Start: TimePeriod.Start,
              End: TimePeriod.End,
            },
            Groups: groupsForResponse(isLastMonth ? lastMonthGroups : groups),
          },
        ],
      });
    }),
  };
}

function createErrorClient(error: Error): CostExplorerClient {
  return {
    getCostAndUsage: vi.fn().mockImplementation(({ TimePeriod }) => {
      if (TimePeriod.Start === '2026-06-01') {
        return Promise.reject(error);
      }

      return Promise.resolve({
        ResultsByTime: [
          {
            TimePeriod: {
              Start: TimePeriod.Start,
              End: TimePeriod.End,
            },
            Groups: [],
          },
        ],
      });
    }),
  };
}

function expectedCostRow(options: {
  serviceName: string;
  periodStart: string;
  periodEnd: string;
  amountUsd: number | null;
  period: 'current' | 'last_month';
}) {
  return {
    provider: 'aws',
    serviceName: options.serviceName,
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    amountUsd: options.amountUsd,
    metadata: {
      source: 'cost_explorer',
      unit: 'USD',
      period: options.period,
    },
    collectedAt: expect.any(String),
  };
}

describe('collectAwsCostExplorer', () => {
  it('collects current and last-month AWS costs as account-level unallocated rows', async () => {
    const client = createClient(
      [
        { serviceName: 'AWS Amplify', amount: '3.14' },
        { serviceName: 'Tax', amount: '0.25' },
      ],
      [
        { serviceName: 'AWS Amplify', amount: '2.71' },
        { serviceName: 'Tax', amount: '0.2' },
      ],
    );

    const result = await collectAwsCostExplorer({
      client,
      now: new Date('2026-06-27T12:00:00.000Z'),
    });

    expect(client.getCostAndUsage).toHaveBeenCalledWith({
      TimePeriod: {
        Start: '2026-06-01',
        End: '2026-06-28',
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });
    expect(client.getCostAndUsage).toHaveBeenCalledWith({
      TimePeriod: {
        Start: '2026-05-01',
        End: '2026-06-01',
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });
    expect(result.status).toBe('success');
    expect(result.summary).toBe('2 current AWS cost rows, 2 last-month rows collected.');
    expect(result.metrics).toEqual([]);
    expect(result.costs).toEqual([
      expectedCostRow({
        serviceName: 'AWS Amplify',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-28',
        amountUsd: 3.14,
        period: 'current',
      }),
      expectedCostRow({
        serviceName: 'Tax',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-28',
        amountUsd: 0.25,
        period: 'current',
      }),
      expectedCostRow({
        serviceName: 'AWS Amplify',
        periodStart: '2026-05-01',
        periodEnd: '2026-06-01',
        amountUsd: 2.71,
        period: 'last_month',
      }),
      expectedCostRow({
        serviceName: 'Tax',
        periodStart: '2026-05-01',
        periodEnd: '2026-06-01',
        amountUsd: 0.2,
        period: 'last_month',
      }),
    ]);
  });

  it('marks malformed cost amounts as partial warning signals', async () => {
    const result = await collectAwsCostExplorer({
      client: createClient([{ serviceName: 'AWS Amplify', amount: 'not-a-number' }]),
      now: new Date('2026-06-27T12:00:00.000Z'),
    });

    expect(result.status).toBe('partial_success');
    expect(result.costs[0]).toMatchObject({
      serviceName: 'AWS Amplify',
      amountUsd: null,
    });
  });

  it('returns failed result when Cost Explorer throws', async () => {
    const result = await collectAwsCostExplorer({
      client: createErrorClient(new Error('AccessDeniedException')),
      now: new Date('2026-06-27T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      provider: 'aws',
      status: 'failed',
      summary: 'AWS Cost Explorer collection failed.',
      costs: [],
      errors: [
        {
          message: 'AccessDeniedException',
          retryable: true,
        },
      ],
    });
  });
});
