/**
 * Snapshot tables are append-only, so without a retention pass they grow forever. Nothing
 * ever reads far back: the dashboard's widest query is a 30-day history window, and every
 * other read is a newest-first `limit(N)`. Rows past the retention window are pure storage
 * cost on a free-tier database.
 *
 * Pruning runs at the end of a collector run rather than on a database schedule, so it needs
 * no pg_cron and no always-on service — the collector is already the only thing that writes
 * these tables.
 */

export const DEFAULT_RETENTION_DAYS = 90;

/**
 * The dashboard's history charts read 30 days back. Retention below that would silently
 * truncate them, so the floor is a day wider than the window the frontend asks for.
 */
export const MIN_RETENTION_DAYS = 31;

interface PrunableTable {
  table: string;
  timestampColumn: string;
}

const PRUNABLE_TABLES: PrunableTable[] = [
  { table: 'metric_snapshots', timestampColumn: 'collected_at' },
  { table: 'cost_snapshots', timestampColumn: 'collected_at' },
  { table: 'health_checks', timestampColumn: 'checked_at' },
  { table: 'collector_runs', timestampColumn: 'started_at' },
];

export interface SnapshotPruneClient {
  deleteRowsOlderThan: (table: string, timestampColumn: string, cutoff: string) => Promise<number>;
}

export interface PruneResult {
  table: string;
  deleted: number;
}

export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_RETENTION_DAYS;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    throw new Error(`SNAPSHOT_RETENTION_DAYS must be a whole number of days, got "${raw}".`);
  }

  if (parsed < MIN_RETENTION_DAYS) {
    throw new Error(
      `SNAPSHOT_RETENTION_DAYS must be at least ${MIN_RETENTION_DAYS} so the dashboard's 30-day history stays intact, got ${parsed}.`,
    );
  }

  return parsed;
}

export function retentionCutoff(retentionDays: number, now: Date = new Date()): string {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function pruneSnapshots(client: SnapshotPruneClient, options: { retentionDays: number; now?: Date }): Promise<PruneResult[]> {
  const cutoff = retentionCutoff(options.retentionDays, options.now);
  const results: PruneResult[] = [];

  for (const { table, timestampColumn } of PRUNABLE_TABLES) {
    results.push({
      table,
      deleted: await client.deleteRowsOlderThan(table, timestampColumn, cutoff),
    });
  }

  return results;
}

export function formatPruneResults(results: PruneResult[], retentionDays: number): string {
  const total = results.reduce((sum, result) => sum + result.deleted, 0);

  if (total === 0) {
    return `Snapshot retention: nothing older than ${retentionDays} days to prune.`;
  }

  const detail = results
    .filter((result) => result.deleted > 0)
    .map((result) => `${result.table} ${result.deleted}`)
    .join(', ');

  return `Snapshot retention: pruned ${total} row${total === 1 ? '' : 's'} older than ${retentionDays} days (${detail}).`;
}
