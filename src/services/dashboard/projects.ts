import { freshnessOf, getOverallStatus } from '../../lib/status';
import type { ProjectResource, ProjectStatus, ProviderKey, ProviderStatus, SnapshotSummary } from '../../types';
import { collectorErrors } from './collectorRuns';
import { buildProjectHistory } from './history';
import {
  latestBy,
  providerKey,
  providerLabel,
  type DashboardRows,
  type HealthCheckRow,
  type MetricSnapshotRow,
  type ProjectRow,
  type ResourceRow,
} from './rows';
import { latestMetricRowsBySubject, latestSnapshotRows, metricValue, snapshotLabel } from './snapshots';

function resourceDetail(resource: ResourceRow): string {
  const details = Object.entries(resource.metadata)
    .filter(
      ([key, value]) => key !== 'aggregateOnly' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    )
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return details.length > 0 ? details.join(', ') : `Last seen ${resource.last_seen_at ?? 'unknown'}`;
}

function providerDetail(
  provider: ProviderKey,
  latestMetric: MetricSnapshotRow | undefined,
  latestHealth: HealthCheckRow | undefined,
  latestResource: ResourceRow | undefined,
) {
  if (provider === 'http' && latestHealth) {
    return latestHealth.http_status
      ? `${latestHealth.http_status} in ${latestHealth.response_time_ms ?? 0} ms`
      : (latestHealth.error_message ?? 'HTTP health check failed');
  }

  if (latestMetric) {
    return `${snapshotLabel(latestMetric.metric_key)}: ${metricValue(latestMetric)}`;
  }

  if (latestResource) {
    return resourceDetail(latestResource);
  }

  return 'Waiting for first collector sync';
}

export function latestProviderStatuses(
  projectId: string,
  metrics: MetricSnapshotRow[],
  healthChecks: HealthCheckRow[],
  resources: ResourceRow[],
): ProviderStatus[] {
  const providers = new Set<ProviderKey>();

  metrics
    .filter((metric) => metric.project_id === projectId)
    .forEach((metric) => {
      const key = providerKey(metric);

      if (key) {
        providers.add(key);
      }
    });

  resources
    .filter((resource) => resource.project_id === projectId)
    .forEach((resource) => {
      const key = providerKey(resource);

      if (key) {
        providers.add(key);
      }
    });

  if (healthChecks.some((check) => check.project_id === projectId)) {
    providers.add('http');
  }

  return Array.from(providers)
    .sort()
    .map((provider) => {
      const latestMetrics = latestMetricRowsBySubject(
        metrics.filter((metric) => metric.project_id === projectId && providerKey(metric) === provider),
      );
      const latestMetric = latestBy(latestMetrics, (metric) => metric.collected_at);
      const latestHealth =
        provider === 'http'
          ? latestBy(
              healthChecks.filter((check) => check.project_id === projectId),
              (check) => check.checked_at,
            )
          : undefined;
      const latestResource = latestBy(
        resources.filter((resource) => resource.project_id === projectId && providerKey(resource) === provider),
        (resource) => resource.last_seen_at,
      );
      const metricStatus = getOverallStatus(latestMetrics.map((metric) => metric.status));
      const status = latestHealth?.status ?? metricStatus;
      const detailMetric = latestMetrics.find((metric) => metric.status === status) ?? latestMetric;
      const lastSync =
        latestBy(
          [latestHealth?.checked_at, latestMetric?.collected_at, latestResource?.last_seen_at].filter((value): value is string =>
            Boolean(value),
          ),
          (value) => value,
        ) ?? null;

      return {
        provider,
        label: providerLabel(provider),
        // A resource-inventory row records that something exists, not that it is working, so it
        // cannot stand in for a health signal. Without a check or a metric the status is unknown.
        status,
        detail: providerDetail(provider, detailMetric, latestHealth, latestResource),
        lastSync,
        freshness: freshnessOf(lastSync),
      };
    });
}

export function projectFromRows(project: ProjectRow, rows: DashboardRows): ProjectStatus {
  const metrics = rows.metrics.filter((metric) => metric.project_id === project.id);
  const resources = rows.resources.filter((resource) => resource.project_id === project.id);
  const healthChecks = rows.healthChecks.filter((check) => check.project_id === project.id);
  const latestHttp = latestBy(healthChecks, (check) => check.checked_at);
  const latestDeploy = latestBy(
    metrics.filter((metric) => providerKey(metric) === 'amplify' || metric.metric_key.endsWith('_deploy_status')),
    (metric) => metric.collected_at,
  );
  const lastSync = latestBy(
    [...metrics.map((metric) => metric.collected_at), ...healthChecks.map((check) => check.checked_at)],
    (value) => value,
  );

  return {
    slug: project.slug,
    name: project.name,
    publicUrl: project.public_url ?? '',
    deployStatus: latestDeploy?.status ?? 'unknown',
    uptimeStatus: latestHttp?.status ?? 'unknown',
    lastSync: lastSync ?? null,
    providers: latestProviderStatuses(project.id, rows.metrics, rows.healthChecks, rows.resources),
    resources: resources
      .filter((resource) => providerKey(resource) !== 'cloudflare')
      .map<ProjectResource>((resource) => ({
        id: resource.id,
        provider: providerKey(resource),
        type: resource.resource_type,
        name: resource.display_name,
        status: 'healthy',
        detail: resourceDetail(resource),
      })),
    recentSnapshots: latestSnapshotRows(metrics)
      .slice(0, 8)
      .map<SnapshotSummary>((metric) => ({
        label: snapshotLabel(metric.metric_key),
        provider: providerKey(metric) ?? 'http',
        status: metric.status,
        value: metricValue(metric),
        collectedAt: metric.collected_at,
      })),
    collectorErrors: collectorErrors(project.slug, rows.collectorRuns),
    history: buildProjectHistory(project.id, rows.healthCheckHistory),
  };
}
