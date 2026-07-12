import type {
  OpenAiCostBucket,
  OpenAiCostBucketResult,
  OpenAiUsageBucket,
  OpenAiUsageBucketResult,
  OpenAiUsageClient,
} from '../providers/openaiUsage';

interface OpenAiUsageResponseResult {
  api_key_id?: string | null;
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  num_model_requests?: number;
}

interface OpenAiUsageResponseBucket {
  start_time?: number;
  end_time?: number;
  results?: OpenAiUsageResponseResult[];
}

interface OpenAiUsageResponse {
  data?: OpenAiUsageResponseBucket[];
}

interface OpenAiCostAmount {
  value?: number | string | null;
  currency?: string;
}

interface OpenAiCostResponseResult {
  amount?: OpenAiCostAmount;
  line_item?: string | null;
  project_id?: string | null;
}

interface OpenAiCostResponseBucket {
  start_time?: number;
  end_time?: number;
  results?: OpenAiCostResponseResult[];
}

interface OpenAiCostResponse {
  data?: OpenAiCostResponseBucket[];
}

function requestUrl(path: string, params: Record<string, string | number | string[]>): string {
  const url = new URL(`https://api.openai.com${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function normalizeUsageResult(result: OpenAiUsageResponseResult): OpenAiUsageBucketResult {
  return {
    apiKeyId: result.api_key_id,
    model: result.model,
    inputTokens: result.input_tokens,
    outputTokens: result.output_tokens,
    cachedInputTokens: result.input_cached_tokens,
    requests: result.num_model_requests,
  };
}

function normalizeCostResult(result: OpenAiCostResponseResult): OpenAiCostBucketResult {
  const amount = result.amount;

  return {
    amountUsd: amount?.currency === 'usd' || amount?.currency === 'USD' ? parseNumericAmount(amount.value) : null,
    lineItem: result.line_item,
    projectId: result.project_id,
  };
}

function parseNumericAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createLiveOpenAiUsageClient(apiKey: string): OpenAiUsageClient {
  async function requestOnce<T>(
    path: string,
    params: Record<string, string | number | string[]>,
  ): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string }> {
    const response = await fetch(requestUrl(path, params), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const text = await response.text();

    if (!response.ok) {
      const detail = text.trim() ? `: ${text.slice(0, 500)}` : '';
      return { ok: false, status: response.status, message: `OpenAI API request failed with ${response.status}${detail}` };
    }

    return { ok: true, value: JSON.parse(text) as T };
  }

  async function request<T>(path: string, params: Record<string, string | number | string[]>): Promise<T> {
    const first = await requestOnce<T>(path, params);

    if (first.ok) {
      return first.value;
    }

    if (first.status < 500) {
      throw new Error(first.message);
    }

    await delay(1000);
    const retry = await requestOnce<T>(path, params);

    if (retry.ok) {
      return retry.value;
    }

    throw new Error(retry.message);
  }

  // Both endpoints use daily buckets with limit: 31 and no pagination, so at most 31 days
  // of data come back per call — an openAi.usageLookbackDays above 31 silently truncates.
  return {
    getUsage: async ({ startTime, endTime }) => {
      const response = await request<OpenAiUsageResponse>('/v1/organization/usage/completions', {
        start_time: startTime,
        end_time: endTime,
        bucket_width: '1d',
        group_by: ['api_key_id', 'model'],
        limit: 31,
      });

      return (response.data ?? []).map<OpenAiUsageBucket>((bucket) => ({
        startTime: bucket.start_time ?? startTime,
        endTime: bucket.end_time ?? endTime,
        results: (bucket.results ?? []).map(normalizeUsageResult),
      }));
    },
    getCosts: async ({ startTime, endTime }) => {
      const response = await request<OpenAiCostResponse>('/v1/organization/costs', {
        start_time: startTime,
        end_time: endTime,
        bucket_width: '1d',
        group_by: ['line_item', 'project_id'],
        limit: 31,
      });

      return (response.data ?? []).map<OpenAiCostBucket>((bucket) => ({
        startTime: bucket.start_time ?? startTime,
        endTime: bucket.end_time ?? endTime,
        results: (bucket.results ?? []).map(normalizeCostResult),
      }));
    },
  };
}
