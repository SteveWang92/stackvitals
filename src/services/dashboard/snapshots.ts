import { metadataText, providerKey, type MetricSnapshotRow } from './rows';

/**
 * "Recent snapshots" on a project's detail view: the newest reading per provider/subject,
 * formatted for display.
 */

function snapshotServiceKey(row: MetricSnapshotRow): string {
  const provider = providerKey(row) ?? 'unknown';
  const service =
    metadataText(row.metadata, ['serviceName', 'url', 'domain', 'appId', 'projectRef', 'rpcName', 'category']) ?? row.metric_key;

  return `${provider}:${service}`;
}

// GitHub Actions metrics have their own tab and would otherwise crowd out every other
// provider in the eight-row snapshot list.
function isRecentSnapshotMetric(row: MetricSnapshotRow): boolean {
  return !row.metric_key.startsWith('github_actions_');
}

export function latestSnapshotRows(rows: MetricSnapshotRow[]): MetricSnapshotRow[] {
  const latest = new Map<string, MetricSnapshotRow>();

  for (const row of rows.filter(isRecentSnapshotMetric)) {
    const key = snapshotServiceKey(row);
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
