import { describe, expect, it, vi } from 'vitest';
import { collectOpenAiUsage, type OpenAiUsageClient } from '../../../collectors/providers/openaiUsage';

function createClient(options: { error?: string } = {}): OpenAiUsageClient {
  if (options.error) {
    return {
      getUsage: vi.fn().mockRejectedValue(new Error(options.error)),
      getCosts: vi.fn().mockRejectedValue(new Error(options.error)),
    };
  }

  const currentUsageBuckets = [
    {
      startTime: 1782604800,
      endTime: 1782691200,
      results: [
        {
          apiKeyId: 'key_a',
          model: 'gpt-4.1-mini',
          inputTokens: 100,
          outputTokens: 40,
          cachedInputTokens: 20,
          requests: 3,
        },
        {
          apiKeyId: 'key_a',
          model: 'gpt-4.1-mini',
          inputTokens: 50,
          outputTokens: 10,
          cachedInputTokens: 5,
          requests: 1,
        },
        {
          apiKeyId: 'key_b',
          model: 'gpt-4.1',
          inputTokens: 200,
          outputTokens: 70,
          cachedInputTokens: 0,
          requests: 2,
        },
      ],
    },
  ];
  const lastMonthUsageBuckets = [
    {
      startTime: 1777593600,
      endTime: 1780272000,
      results: [
        {
          apiKeyId: 'key_a',
          model: 'gpt-4.1-mini',
          inputTokens: 1000,
          outputTokens: 250,
          cachedInputTokens: 100,
          requests: 14,
        },
      ],
    },
  ];
  const currentCostBuckets = [
    {
      startTime: 1782000000,
      endTime: 1782086400,
      results: [
        {
          amountUsd: 0.1,
          lineItem: 'OpenAI API',
          projectId: 'proj_123',
        },
      ],
    },
    {
      startTime: 1782604800,
      endTime: 1782691200,
      results: [
        {
          amountUsd: 0.01,
          lineItem: 'OpenAI API',
          projectId: 'proj_123',
        },
      ],
    },
  ];
  const lastMonthCostBuckets = [
    {
      startTime: 1777593600,
      endTime: 1780272000,
      results: [
        {
          amountUsd: 0.42,
          lineItem: 'OpenAI API',
          projectId: 'proj_123',
        },
      ],
    },
  ];

  return {
    getUsage: vi.fn().mockImplementation(({ startTime }) => {
      return Promise.resolve(startTime === 1777593600 ? lastMonthUsageBuckets : currentUsageBuckets);
    }),
    getCosts: vi.fn().mockImplementation(({ startTime }) => {
      return Promise.resolve(startTime === 1777593600 ? lastMonthCostBuckets : currentCostBuckets);
    }),
  };
}

describe('collectOpenAiUsage', () => {
  it('collects aggregate usage by API key and model with cost snapshots', async () => {
    const client = createClient();

    const result = await collectOpenAiUsage({
      client,
      apiKeyLabels: {
        key_a: 'Dashboard collector',
      },
      lookbackDays: 7,
      now: new Date('2026-06-28T12:00:00.000Z'),
    });

    expect(client.getUsage).toHaveBeenCalledWith({
      startTime: 1782086400,
      endTime: 1782691200,
    });
    expect(client.getUsage).toHaveBeenCalledWith({
      startTime: 1777593600,
      endTime: 1780272000,
    });
    expect(client.getCosts).toHaveBeenCalledWith({
      startTime: 1780272000,
      endTime: 1782691200,
    });
    expect(client.getCosts).toHaveBeenCalledWith({
      startTime: 1777593600,
      endTime: 1780272000,
    });
    expect(result.status).toBe('success');
    expect(result.resources).toEqual([
      {
        provider: 'openai',
        resourceType: 'api_key_usage',
        externalId: 'key_b',
        displayName: 'key_b',
        metadata: {
          apiKeyId: 'key_b',
          aggregateOnly: true,
        },
      },
      {
        provider: 'openai',
        resourceType: 'api_key_usage',
        externalId: 'key_a',
        displayName: 'Dashboard collector',
        metadata: {
          apiKeyId: 'key_a',
          aggregateOnly: true,
        },
      },
    ]);
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai',
          metricKey: 'openai_input_tokens',
          metricValue: 150,
          metadata: {
            apiKeyId: 'key_a',
            apiKeyLabel: 'Dashboard collector',
            model: 'gpt-4.1-mini',
            period: 'current',
            aggregateOnly: true,
          },
        }),
        expect.objectContaining({
          provider: 'openai',
          metricKey: 'openai_requests',
          metricValue: 2,
          metadata: {
            apiKeyId: 'key_b',
            apiKeyLabel: 'key_b',
            model: 'gpt-4.1',
            period: 'current',
            aggregateOnly: true,
          },
        }),
        expect.objectContaining({
          provider: 'openai',
          metricKey: 'openai_spend_usd',
          metricValue: 0.11,
        }),
        expect.objectContaining({
          provider: 'openai',
          metricKey: 'openai_last_month_tokens',
          metricValue: 1250,
        }),
        expect.objectContaining({
          provider: 'openai',
          metricKey: 'openai_last_month_spend_usd',
          metricValue: 0.42,
        }),
      ]),
    );
    expect(result.costs).toEqual([
      {
        provider: 'openai',
        serviceName: 'OpenAI API',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-29',
        amountUsd: 0.11,
        metadata: {
          source: 'openai_organization_costs',
          projectId: 'proj_123',
          bucketCount: 2,
          period: 'current',
          aggregateOnly: true,
        },
        collectedAt: expect.any(String),
      },
      {
        provider: 'openai',
        serviceName: 'OpenAI API',
        periodStart: '2026-05-01',
        periodEnd: '2026-06-01',
        amountUsd: 0.42,
        metadata: {
          source: 'openai_organization_costs',
          projectId: 'proj_123',
          bucketCount: 1,
          period: 'last_month',
          aggregateOnly: true,
        },
        collectedAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('prompt');
  });

  it('marks non-USD or malformed cost amounts as partial success', async () => {
    const client: OpenAiUsageClient = {
      getUsage: vi.fn().mockResolvedValue([]),
      getCosts: vi.fn().mockResolvedValue([
        {
          startTime: 1782604800,
          endTime: 1782691200,
          results: [
            {
              amountUsd: null,
              lineItem: 'OpenAI API',
            },
          ],
        },
      ]),
    };

    const result = await collectOpenAiUsage({
      client,
      now: new Date('2026-06-28T12:00:00.000Z'),
    });

    expect(result.status).toBe('partial_success');
    expect(result.costs[0]).toMatchObject({
      amountUsd: null,
    });
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'openai_spend_usd',
          metricValue: 0,
          status: 'warning',
        }),
      ]),
    );
  });

  it('returns a failed result when the OpenAI API request fails', async () => {
    const result = await collectOpenAiUsage({
      client: createClient({ error: 'invalid admin key' }),
      now: new Date('2026-06-28T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      provider: 'openai',
      status: 'failed',
      summary: 'OpenAI usage collection failed.',
      resources: [],
      metrics: [],
      costs: [],
      errors: [
        {
          message: 'invalid admin key',
          retryable: true,
        },
      ],
    });
  });
});
