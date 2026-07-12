import type { CloudflareClient, CloudflareDnsRecord, CloudflareRegistrarDomain, CloudflareZone } from '../providers/cloudflare';

interface CloudflareEnvelope<T> {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: T;
}

interface CloudflareZoneResponse {
  id?: string;
  name?: string;
  status?: string;
  paused?: boolean;
  type?: string;
  name_servers?: string[];
  original_registrar?: string | null;
  plan?: {
    name?: string | null;
  } | null;
}

interface CloudflareDnsRecordResponse {
  id?: string;
  name?: string;
  type?: string;
  content?: string;
  proxied?: boolean;
}

interface CloudflareRegistrarDomainResponse {
  domain?: string;
  name?: string;
  registrar?: string | null;
  expires_at?: string | null;
  expires_on?: string | null;
  auto_renew?: boolean | null;
  locked?: boolean | null;
}

function errorDetail(errors: Array<{ message?: string }> | undefined): string {
  const message = errors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join('; ');

  return message ? `: ${message}` : '';
}

function normalizeZone(zone: CloudflareZoneResponse): CloudflareZone {
  if (!zone.id || !zone.name || !zone.status) {
    throw new Error('Cloudflare zone response was missing id, name, or status.');
  }

  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    paused: zone.paused,
    type: zone.type,
    nameServers: zone.name_servers,
    originalRegistrar: zone.original_registrar,
    planName: zone.plan?.name ?? null,
  };
}

function normalizeRecord(record: CloudflareDnsRecordResponse): CloudflareDnsRecord | null {
  if (!record.id || !record.name || !record.type) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    content: record.content,
    proxied: record.proxied,
  };
}

function normalizeRegistrarDomain(domain: CloudflareRegistrarDomainResponse): CloudflareRegistrarDomain | null {
  const name = domain.domain ?? domain.name;

  if (!name) {
    return null;
  }

  return {
    domain: name,
    registrar: domain.registrar,
    expiresAt: domain.expires_at ?? domain.expires_on,
    autoRenew: domain.auto_renew,
    locked: domain.locked,
  };
}

export function createLiveCloudflareClient(apiToken: string, accountId?: string): CloudflareClient {
  async function request<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });
    const body = (await response.json()) as CloudflareEnvelope<T>;

    if (!response.ok || body.success === false || body.result === undefined) {
      throw new Error(`Cloudflare API request failed with ${response.status}${errorDetail(body.errors)}`);
    }

    return body.result;
  }

  async function optionalRequest<T>(path: string): Promise<T | null> {
    try {
      return await request<T>(path);
    } catch {
      return null;
    }
  }

  return {
    getDomainInventory: async (domain) => {
      const zones = await request<CloudflareZoneResponse[]>(`/zones?name=${encodeURIComponent(domain)}&per_page=1`);
      const zoneResponse = zones[0];

      if (!zoneResponse) {
        throw new Error(`Cloudflare zone ${domain} was not found.`);
      }

      const zone = normalizeZone(zoneResponse);
      const dnsRecords = (await request<CloudflareDnsRecordResponse[]>(`/zones/${encodeURIComponent(zone.id)}/dns_records?per_page=100`))
        .map(normalizeRecord)
        .filter((record): record is CloudflareDnsRecord => Boolean(record));
      const registrarDomain = accountId
        ? normalizeRegistrarDomain(
            (await optionalRequest<CloudflareRegistrarDomainResponse>(
              `/accounts/${encodeURIComponent(accountId)}/registrar/domains/${encodeURIComponent(domain)}`,
            )) ?? {},
          )
        : null;

      return {
        zone,
        dnsRecords,
        registrarDomain,
      };
    },
  };
}
