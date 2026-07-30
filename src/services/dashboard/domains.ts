import { getOverallStatus } from '../../lib/status';
import type { DomainSummary } from '../../types';
import { booleanMetadata, latestBy, providerKey, stringMetadata, type MetricSnapshotRow, type ResourceRow } from './rows';

function domainMetric(metrics: MetricSnapshotRow[], domain: string, metricKey: string): MetricSnapshotRow | undefined {
  return latestBy(
    metrics.filter(
      (metric) => providerKey(metric) === 'cloudflare' && metric.metric_key === metricKey && metric.metadata?.domain === domain,
    ),
    (metric) => metric.collected_at,
  );
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

export function buildDomainSummaries(resources: ResourceRow[], metrics: MetricSnapshotRow[]): DomainSummary[] {
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
