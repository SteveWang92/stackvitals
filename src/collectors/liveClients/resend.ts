import type { ResendClient, ResendDeliveryCounts, ResendDomainStatus } from '../providers/resend';

interface ResendDomainResponse {
  id?: string;
  name?: string;
  status?: ResendDomainStatus['status'];
  region?: string;
}

interface ResendDomainsListResponse {
  data?: ResendDomainResponse[];
}

export function createLiveResendClient(apiKey: string): ResendClient {
  async function request<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.resend.com${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      const detail = text.trim() ? `: ${text.slice(0, 500)}` : '';
      throw new Error(`Resend API request failed with ${response.status}${detail}`);
    }

    return JSON.parse(text) as T;
  }

  async function findDomain(domain: string): Promise<ResendDomainResponse> {
    const list = await request<ResendDomainsListResponse>('/domains');
    const matched = (list.data ?? []).find((candidate) => candidate.name?.toLowerCase() === domain.toLowerCase());

    if (!matched) {
      throw new Error(`Resend domain ${domain} was not found in the account.`);
    }

    if (!matched.id) {
      return matched;
    }

    return request<ResendDomainResponse>(`/domains/${matched.id}`);
  }

  return {
    getDomainStatus: async (domain) => {
      const result = await findDomain(domain);

      return {
        domain: result.name ?? domain,
        status: result.status ?? 'unknown',
        region: result.region,
      };
    },
    getVerificationEmailCounts: async () => {
      // Resend event analytics varies by account setup. Keep the first live
      // client conservative and aggregate-only until event access is confirmed.
      return {
        sent: 0,
        delivered: 0,
        bounced: 0,
        complained: 0,
        failed: 0,
      } satisfies ResendDeliveryCounts;
    },
  };
}
