import { STALE_AFTER_HOURS, isStaleSync } from '../../lib/status';
import { metadataText, providerKey, type MetricSnapshotRow, type ResourceRow } from './rows';

/**
 * "Recent snapshots" on a project's detail view: the newest reading per provider/subject,
 * formatted for display.
 */

export function metricSubjectKey(row: MetricSnapshotRow): string {
  const provider = providerKey(row) ?? 'unknown';
  const service =
    metadataText(row.metadata, ['serviceName', 'url', 'domain', 'appId', 'projectRef', 'rpcName', 'userPoolId', 'tableName', 'category']) ??
    row.metric_key;

  return `${provider}:${service}`;
}

function snapshotMetricKey(row: MetricSnapshotRow): string {
  return `${metricSubjectKey(row)}:${row.metric_key}`;
}

/**
 * Keeps the newest collection for each provider subject, including every metric emitted by
 * that collection. Adapters commonly give a subject's status and aggregate counts the same
 * timestamp, so reducing to one row would discard either health or useful detail.
 *
 * Subjects the collector has stopped reporting are dropped rather than carried forever.
 * Snapshots are append-only and pruned only at the retention horizon, so a resource removed
 * from the config while its last reading was a warning or a failure would otherwise pin its
 * project to that status for months. A subject counts as retired once it is a full staleness
 * window behind the newest reading this provider produced.
 */
export function latestMetricRowsBySubject(rows: MetricSnapshotRow[]): MetricSnapshotRow[] {
  const latest = new Map<string, { timestamp: number; collectedAt: string; rows: MetricSnapshotRow[] }>();
  let newestTimestamp = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const key = metricSubjectKey(row);
    const timestamp = new Date(row.collected_at).getTime();

    newestTimestamp = Math.max(newestTimestamp, timestamp);

    const existing = latest.get(key);

    if (!existing || timestamp > existing.timestamp) {
      latest.set(key, { timestamp, collectedAt: row.collected_at, rows: [row] });
    } else if (timestamp === existing.timestamp) {
      existing.rows.push(row);
    }
  }

  if (newestTimestamp === Number.NEGATIVE_INFINITY) {
    return [];
  }

  const newest = new Date(newestTimestamp);

  return Array.from(latest.values())
    .filter((entry) => !isStaleSync(entry.collectedAt, newest, STALE_AFTER_HOURS))
    .flatMap((entry) => entry.rows);
}

/**
 * Resources are upserted and never deleted, so a DNS record or domain removed at the provider
 * would otherwise stay listed forever. Within one project's provider, a resource is dropped once
 * it is a full staleness window behind the newest one written there. Grouping by project keeps a
 * provider that went quiet as a whole visible as stale, and a never-seen resource (null
 * `last_seen_at`) stays as the inventory's "Unknown, never synced" marker.
 */
export function currentResources(resources: ResourceRow[]): ResourceRow[] {
  const groupKey = (resource: ResourceRow) => `${resource.project_id ?? 'unallocated'}:${providerKey(resource)}`;
  const newestByGroup = new Map<string, number>();

  for (const resource of resources) {
    if (resource.last_seen_at) {
      const key = groupKey(resource);

      newestByGroup.set(key, Math.max(newestByGroup.get(key) ?? 0, new Date(resource.last_seen_at).getTime()));
    }
  }

  return resources.filter(
    (resource) =>
      !resource.last_seen_at || !isStaleSync(resource.last_seen_at, new Date(newestByGroup.get(groupKey(resource))!), STALE_AFTER_HOURS),
  );
}

// GitHub Actions metrics have their own tab and would otherwise crowd out every other
// provider in the eight-row snapshot list.
function isRecentSnapshotMetric(row: MetricSnapshotRow): boolean {
  return !row.metric_key.startsWith('github_actions_');
}

export function latestSnapshotRows(rows: MetricSnapshotRow[]): MetricSnapshotRow[] {
  const latest = new Map<string, MetricSnapshotRow>();

  for (const row of rows.filter(isRecentSnapshotMetric)) {
    const key = snapshotMetricKey(row);
    const existing = latest.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latest.set(key, row);
    }
  }

  return Array.from(latest.values()).sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime());
}

export function snapshotLabel(metricKey: string): string {
  return metricKey.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function metricValue(metric: MetricSnapshotRow): string {
  if (metric.metric_value === null) {
    return 'No numeric value';
  }

  if (metric.metric_key.includes('cost')) {
    return `$${metric.metric_value.toFixed(2)}`;
  }

  return String(metric.metric_value);
}
