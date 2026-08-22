import { metadataText, providerKey, type MetricSnapshotRow } from './rows';

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
 */
export function latestMetricRowsBySubject(rows: MetricSnapshotRow[]): MetricSnapshotRow[] {
  const latest = new Map<string, { timestamp: number; rows: MetricSnapshotRow[] }>();

  for (const row of rows) {
    const key = metricSubjectKey(row);
    const timestamp = new Date(row.collected_at).getTime();
    const existing = latest.get(key);

    if (!existing || timestamp > existing.timestamp) {
      latest.set(key, { timestamp, rows: [row] });
    } else if (timestamp === existing.timestamp) {
      existing.rows.push(row);
    }
  }

  return Array.from(latest.values()).flatMap((entry) => entry.rows);
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
