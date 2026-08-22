import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  formatPruneResults,
  parseRetentionDays,
  pruneSnapshots,
  retentionCutoff,
  type SnapshotPruneClient,
} from '../../../collectors/stores/pruneSnapshots';

function createClient(deletedPerTable: Record<string, number> = {}): SnapshotPruneClient {
  return {
    deleteRowsOlderThan: vi.fn(async (table: string) => deletedPerTable[table] ?? 0),
  };
}

describe('parseRetentionDays', () => {
  it('defaults when unset or blank', () => {
    expect(parseRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parseRetentionDays('   ')).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('accepts a whole number of days at or above the floor', () => {
    expect(parseRetentionDays('365')).toBe(365);
    expect(parseRetentionDays(String(MIN_RETENTION_DAYS))).toBe(MIN_RETENTION_DAYS);
  });

  it('rejects values that would truncate the dashboard history window', () => {
    expect(() => parseRetentionDays('7')).toThrow(/at least 31/);
  });

  it('rejects non-integer values', () => {
    expect(() => parseRetentionDays('ninety')).toThrow(/whole number/);
    expect(() => parseRetentionDays('45.5')).toThrow(/whole number/);
  });
});

describe('retentionCutoff', () => {
  it('subtracts the retention window from now', () => {
    expect(retentionCutoff(90, new Date('2026-07-30T00:00:00.000Z'))).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('pruneSnapshots', () => {
  it('prunes every append-only table with its own timestamp column', async () => {
    const client = createClient();

    const results = await pruneSnapshots(client, { retentionDays: 90, now: new Date('2026-07-30T00:00:00.000Z') });

    expect(results.map((result) => result.table)).toEqual(['metric_snapshots', 'cost_snapshots', 'health_checks', 'collector_runs']);
    expect(client.deleteRowsOlderThan).toHaveBeenCalledWith('metric_snapshots', 'collected_at', '2026-05-01T00:00:00.000Z');
    expect(client.deleteRowsOlderThan).toHaveBeenCalledWith('cost_snapshots', 'collected_at', '2026-05-01T00:00:00.000Z');
    expect(client.deleteRowsOlderThan).toHaveBeenCalledWith('health_checks', 'checked_at', '2026-05-01T00:00:00.000Z');
    expect(client.deleteRowsOlderThan).toHaveBeenCalledWith('collector_runs', 'started_at', '2026-05-01T00:00:00.000Z');
  });

  it('reports the deleted count per table', async () => {
    const results = await pruneSnapshots(createClient({ metric_snapshots: 12, health_checks: 3 }), { retentionDays: 90 });

    expect(results).toEqual([
      { table: 'metric_snapshots', deleted: 12 },
      { table: 'cost_snapshots', deleted: 0 },
      { table: 'health_checks', deleted: 3 },
      { table: 'collector_runs', deleted: 0 },
    ]);
  });
});

describe('formatPruneResults', () => {
  it('says so when there was nothing to prune', () => {
    const results = [
      { table: 'metric_snapshots', deleted: 0 },
      { table: 'health_checks', deleted: 0 },
    ];

    expect(formatPruneResults(results, 90)).toBe('Snapshot retention: nothing older than 90 days to prune.');
  });

  it('lists only the tables that lost rows', () => {
    const results = [
      { table: 'metric_snapshots', deleted: 12 },
      { table: 'cost_snapshots', deleted: 0 },
      { table: 'health_checks', deleted: 3 },
    ];

    expect(formatPruneResults(results, 90)).toBe(
      'Snapshot retention: pruned 15 rows older than 90 days (metric_snapshots 12, health_checks 3).',
    );
  });
});
