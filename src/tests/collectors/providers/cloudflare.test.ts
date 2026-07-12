import { describe, expect, it, vi } from 'vitest';
import { collectCloudflareDomains, type CloudflareClient, type CloudflareDomainInventory } from '../../../collectors/providers/cloudflare';

function inventory(overrides: Partial<CloudflareDomainInventory> = {}): CloudflareDomainInventory {
  return {
    zone: {
      id: 'zone-1',
      name: 'example.org',
      status: 'active',
      paused: false,
      type: 'full',
      nameServers: ['amy.ns.cloudflare.com', 'lee.ns.cloudflare.com'],
      originalRegistrar: 'Cloudflare Registrar',
      planName: 'Free Website',
    },
    dnsRecords: [
      {
        id: 'record-apex',
        name: 'example.org',
        type: 'A',
        proxied: true,
      },
      {
        id: 'record-www',
        name: 'www.example.org',
        type: 'CNAME',
        proxied: true,
      },
      {
        id: 'record-mx',
        name: 'example.org',
        type: 'MX',
      },
    ],
    registrarDomain: {
      domain: 'example.org',
      registrar: 'Cloudflare Registrar',
      expiresAt: '2026-12-31T00:00:00Z',
      autoRenew: true,
      locked: true,
    },
    ...overrides,
  };
}

function createClient(result: CloudflareDomainInventory | Error = inventory()): CloudflareClient {
  return {
    getDomainInventory: result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
  };
}

describe('collectCloudflareDomains', () => {
  it('collects aggregate zone, DNS, and registrar health', async () => {
    const client = createClient();

    const result = await collectCloudflareDomains([{ projectSlug: 'acme_site', domain: 'example.org' }], { client });

    expect(client.getDomainInventory).toHaveBeenCalledWith('example.org');
    expect(result.status).toBe('success');
    expect(result.summary).toBe('1/1 Cloudflare domains collected.');
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'cloudflare',
          resourceType: 'zone',
          externalId: 'zone-1',
          displayName: 'example.org',
        }),
        expect.objectContaining({
          provider: 'cloudflare',
          resourceType: 'dns_record',
          displayName: 'A example.org',
        }),
      ]),
    );
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'cloudflare_zone_active',
          metricValue: 1,
          status: 'healthy',
        }),
        expect.objectContaining({
          metricKey: 'cloudflare_dns_record_count',
          metricValue: 3,
          status: 'healthy',
        }),
        expect.objectContaining({
          metricKey: 'cloudflare_registrar_on_cloudflare',
          metricValue: 1,
          status: 'healthy',
        }),
        expect.objectContaining({
          metricKey: 'cloudflare_domain_expiration_days',
          status: 'healthy',
        }),
      ]),
    );
    expect(result.errors).toHaveLength(0);
    expect(result.metrics.every((metric) => metric.metadata?.aggregateOnly === true)).toBe(true);
  });

  it('leaves shared domains unallocated when projectSlug is omitted', async () => {
    const result = await collectCloudflareDomains([{ domain: 'example.org' }], { client: createClient() });

    expect(result.status).toBe('success');
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.resources.every((resource) => resource.projectSlug === undefined)).toBe(true);
    expect(result.metrics.every((metric) => metric.projectSlug === undefined)).toBe(true);
  });

  it('keeps non-Cloudflare registrar state informational during transfer', async () => {
    const result = await collectCloudflareDomains(
      [
        {
          projectSlug: 'acme_site',
          domain: 'example.com',
        },
      ],
      {
        client: createClient(
          inventory({
            zone: {
              ...inventory().zone,
              name: 'example.com',
              originalRegistrar: 'GoDaddy',
            },
            dnsRecords: [
              {
                id: 'record-apex-me',
                name: 'example.com',
                type: 'A',
                proxied: true,
              },
              {
                id: 'record-www-me',
                name: 'www.example.com',
                type: 'CNAME',
                proxied: true,
              },
            ],
            registrarDomain: null,
          }),
        ),
      },
    );

    expect(result.status).toBe('success');
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'cloudflare_registrar_on_cloudflare',
          metricValue: 0,
          status: 'healthy',
          metadata: expect.objectContaining({
            registrar: 'GoDaddy',
          }),
        }),
        expect.objectContaining({
          metricKey: 'cloudflare_domain_expiration_days',
          metricValue: undefined,
          status: 'unknown',
        }),
      ]),
    );
  });

  it('marks inactive zones and missing key DNS records as attention signals', async () => {
    const result = await collectCloudflareDomains([{ projectSlug: 'acme_site', domain: 'example.org' }], {
      client: createClient(
        inventory({
          zone: {
            ...inventory().zone,
            status: 'pending',
          },
          dnsRecords: [],
        }),
      ),
    });

    expect(result.status).toBe('partial_success');
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'cloudflare_zone_active',
          metricValue: 0,
          status: 'failed',
        }),
        expect.objectContaining({
          metricKey: 'cloudflare_apex_record_present',
          metricValue: 0,
          status: 'warning',
        }),
        expect.objectContaining({
          metricKey: 'cloudflare_www_record_present',
          metricValue: 0,
          status: 'warning',
        }),
      ]),
    );
  });

  it('isolates Cloudflare API failures without throwing', async () => {
    const result = await collectCloudflareDomains([{ projectSlug: 'acme_site', domain: 'example.org' }], {
      client: createClient(new Error('invalid token')),
    });

    expect(result.status).toBe('failed');
    expect(result.metrics).toEqual([
      expect.objectContaining({
        metricKey: 'cloudflare_domain_inventory_available',
        metricValue: 0,
        status: 'failed',
        metadata: expect.objectContaining({
          domain: 'example.org',
          aggregateOnly: true,
        }),
      }),
    ]);
    expect(result.errors).toEqual([
      {
        projectSlug: 'acme_site',
        message: 'invalid token',
        retryable: true,
      },
    ]);
  });

  it('skips cleanly when there are no configured domains', async () => {
    const result = await collectCloudflareDomains([], { client: createClient() });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No Cloudflare domains configured.');
  });
});
