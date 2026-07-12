import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface CloudflareTarget {
  // Undefined leaves the domain unallocated (`project_id` null) — used for domains shared
  // across multiple projects.
  projectSlug?: ProjectSlug;
  domain: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'moved' | 'initializing' | 'deleted' | 'deactivated' | string;
  paused?: boolean;
  type?: string;
  nameServers?: string[];
  originalRegistrar?: string | null;
  planName?: string | null;
}

export interface CloudflareDnsRecord {
  id: string;
  name: string;
  type: string;
  content?: string;
  proxied?: boolean;
}

export interface CloudflareRegistrarDomain {
  domain: string;
  registrar?: string | null;
  expiresAt?: string | null;
  autoRenew?: boolean | null;
  locked?: boolean | null;
}

export interface CloudflareDomainInventory {
  zone: CloudflareZone;
  dnsRecords: CloudflareDnsRecord[];
  registrarDomain?: CloudflareRegistrarDomain | null;
}

export interface CloudflareClient {
  getDomainInventory: (domain: string) => Promise<CloudflareDomainInventory>;
}

export interface CloudflareOptions {
  client: CloudflareClient;
}

function metric(
  target: CloudflareTarget,
  metricKey: string,
  metricValue: number | undefined,
  status: StatusLevel,
  metadata: Record<string, unknown>,
  collectedAt: string,
): CollectorMetric {
  return {
    projectSlug: target.projectSlug,
    provider: 'cloudflare',
    metricKey,
    metricValue,
    status,
    metadata: {
      domain: target.domain,
      aggregateOnly: true,
      ...metadata,
    },
    collectedAt,
  };
}

function zoneStatusLevel(zone: CloudflareZone): StatusLevel {
  if (zone.status !== 'active') {
    return 'failed';
  }

  return zone.paused ? 'warning' : 'healthy';
}

function expirationDays(expiresAt: string | null | undefined, now = new Date()): number | null {
  if (!expiresAt) {
    return null;
  }

  const expires = new Date(expiresAt).getTime();

  if (!Number.isFinite(expires)) {
    return null;
  }

  return Math.ceil((expires - now.getTime()) / 86_400_000);
}

function expirationStatus(days: number | null): StatusLevel {
  if (days === null) {
    return 'unknown';
  }

  if (days < 7) {
    return 'failed';
  }

  if (days < 30) {
    return 'warning';
  }

  return 'healthy';
}

function registrarName(inventory: CloudflareDomainInventory): string | null {
  return inventory.registrarDomain?.registrar ?? inventory.zone.originalRegistrar ?? null;
}

function isCloudflareRegistrar(name: string | null): boolean {
  return Boolean(name?.toLowerCase().includes('cloudflare'));
}

function domainMetrics(target: CloudflareTarget, inventory: CloudflareDomainInventory, collectedAt: string): CollectorMetric[] {
  const zoneStatus = zoneStatusLevel(inventory.zone);
  const records = inventory.dnsRecords;
  const apexRecords = records.filter((record) => record.name.toLowerCase() === target.domain.toLowerCase());
  const wwwRecords = records.filter((record) => record.name.toLowerCase() === `www.${target.domain}`.toLowerCase());
  const mxRecords = records.filter((record) => record.type.toUpperCase() === 'MX');
  const proxiedRecords = records.filter((record) => record.proxied).length;
  const registrar = registrarName(inventory);
  const registrationDays = expirationDays(inventory.registrarDomain?.expiresAt);

  return [
    metric(
      target,
      'cloudflare_zone_active',
      inventory.zone.status === 'active' ? 1 : 0,
      zoneStatus,
      {
        zoneId: inventory.zone.id,
        zoneStatus: inventory.zone.status,
        zoneType: inventory.zone.type,
        planName: inventory.zone.planName,
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_dns_record_count',
      records.length,
      'healthy',
      {
        zoneId: inventory.zone.id,
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_proxied_record_count',
      proxiedRecords,
      'healthy',
      {
        zoneId: inventory.zone.id,
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_apex_record_present',
      apexRecords.length > 0 ? 1 : 0,
      apexRecords.length > 0 ? 'healthy' : 'warning',
      {
        recordTypes: Array.from(new Set(apexRecords.map((record) => record.type))).sort(),
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_www_record_present',
      wwwRecords.length > 0 ? 1 : 0,
      wwwRecords.length > 0 ? 'healthy' : 'warning',
      {
        recordTypes: Array.from(new Set(wwwRecords.map((record) => record.type))).sort(),
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_mx_record_count',
      mxRecords.length,
      'healthy',
      {
        zoneId: inventory.zone.id,
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_registrar_on_cloudflare',
      isCloudflareRegistrar(registrar) ? 1 : 0,
      registrar ? 'healthy' : 'unknown',
      {
        registrar,
        source: inventory.registrarDomain ? 'registrar_api' : 'zone_metadata',
      },
      collectedAt,
    ),
    metric(
      target,
      'cloudflare_domain_expiration_days',
      registrationDays ?? undefined,
      expirationStatus(registrationDays),
      {
        expiresAt: inventory.registrarDomain?.expiresAt ?? null,
        autoRenew: inventory.registrarDomain?.autoRenew ?? null,
        locked: inventory.registrarDomain?.locked ?? null,
      },
      collectedAt,
    ),
  ];
}

function domainResources(target: CloudflareTarget, inventory: CloudflareDomainInventory): CollectorResource[] {
  const relevantRecords = inventory.dnsRecords.filter((record) => {
    const name = record.name.toLowerCase();

    return name === target.domain.toLowerCase() || name === `www.${target.domain}`.toLowerCase() || record.type.toUpperCase() === 'MX';
  });

  return [
    {
      projectSlug: target.projectSlug,
      provider: 'cloudflare',
      resourceType: 'zone',
      externalId: inventory.zone.id,
      displayName: inventory.zone.name,
      metadata: {
        status: inventory.zone.status,
        paused: inventory.zone.paused ?? false,
        type: inventory.zone.type,
        nameServers: inventory.zone.nameServers ?? [],
        originalRegistrar: inventory.zone.originalRegistrar ?? null,
        planName: inventory.zone.planName ?? null,
        aggregateOnly: true,
      },
    },
    ...relevantRecords.map<CollectorResource>((record) => ({
      projectSlug: target.projectSlug,
      provider: 'cloudflare',
      resourceType: 'dns_record',
      externalId: record.id,
      displayName: `${record.type} ${record.name}`,
      metadata: {
        domain: target.domain,
        type: record.type,
        name: record.name,
        proxied: record.proxied ?? null,
        aggregateOnly: true,
      },
    })),
  ];
}

export async function collectCloudflareDomains(targets: CloudflareTarget[], options: CloudflareOptions): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      try {
        const inventory = await options.client.getDomainInventory(target.domain);

        resources.push(...domainResources(target, inventory));
        metrics.push(...domainMetrics(target, inventory, collectedAt));
      } catch (error) {
        const message = getErrorMessage(error, 'Cloudflare collection failed');

        metrics.push(metric(target, 'cloudflare_domain_inventory_available', 0, 'failed', {}, collectedAt));
        errors.push({
          projectSlug: target.projectSlug,
          message,
          retryable: true,
        });
      }
    }),
  );

  return {
    provider: 'cloudflare',
    status: deriveResultStatus(metrics, errors),
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No Cloudflare domains configured.'
        : `${targets.length - errors.length}/${targets.length} Cloudflare domains collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createCloudflareDomainsAdapter(targets: CloudflareTarget[], options: CloudflareOptions): ProviderAdapter {
  return {
    provider: 'cloudflare',
    collect: () => collectCloudflareDomains(targets, options),
  };
}
