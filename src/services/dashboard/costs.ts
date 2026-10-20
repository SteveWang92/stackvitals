import type { CostPoint } from '../../types';
import { utcDayKey } from './history';
import { providerKey, stringMetadata, type CostSnapshotRow } from './rows';

type PositiveCostSnapshotRow = CostSnapshotRow & { amount_usd: number };

export interface CostPeriod {
  startDate: string;
  endDate: string;
}

export function currentMonthBounds(now = new Date()): CostPeriod {
  return {
    startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10),
  };
}

export function lastMonthBounds(now = new Date()): CostPeriod {
  return {
    startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
  };
}

export function isPeriodRow(row: CostSnapshotRow, period: CostPeriod): boolean {
  return row.period_start === period.startDate && row.period_end <= period.endDate && row.period_end > period.startDate;
}

/**
 * One billed line within a period. A provider's own project id (OpenAI bills the same line item
 * once per OpenAI project) lives only in metadata, so it is part of the key.
 */
function costLineKey(row: CostSnapshotRow): string {
  return [row.project_id ?? 'unallocated', providerKey(row), row.service_name, stringMetadata(row.metadata, 'projectId') ?? ''].join(':');
}

export function latestCostRows(rows: CostSnapshotRow[]): PositiveCostSnapshotRow[] {
  const latest = new Map<string, CostSnapshotRow>();

  for (const row of rows) {
    const key = `${costLineKey(row)}:${row.period_start}`;
    const existing = latest.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latest.set(key, row);
    }
  }

  return Array.from(latest.values()).filter((row): row is PositiveCostSnapshotRow => row.amount_usd !== null && row.amount_usd > 0);
}

export function costTotal(rows: PositiveCostSnapshotRow[]): number | null {
  return rows.length === 0 ? null : rows.reduce((total, row) => total + row.amount_usd, 0);
}

/**
 * cost_snapshots.amount_usd is cumulative for its period and resets on the 1st, so this is
 * scoped to the current month only. A naive 30-day series would render the rollover as a
 * cliff. Points are cumulative MTD totals as of each collection day, not daily spend.
 *
 * Each line keeps its latest amount until a newer reading replaces it, so a day on which one
 * provider failed to collect still totals every line instead of dropping that provider's share.
 */
export function buildMtdCostSeries(costs: CostSnapshotRow[], now = new Date()): CostPoint[] {
  const period = currentMonthBounds(now);
  const rows = costs
    .filter((cost) => isPeriodRow(cost, period))
    .sort((a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime());
  const latestByLine = new Map<string, number>();
  const cumulativeByDay = new Map<string, number>();

  for (const row of rows) {
    if (row.amount_usd !== null) {
      latestByLine.set(costLineKey(row), row.amount_usd);
    }

    cumulativeByDay.set(
      utcDayKey(row.collected_at),
      Array.from(latestByLine.values()).reduce((total, amount) => total + amount, 0),
    );
  }

  return Array.from(cumulativeByDay, ([day, cumulativeUsd]) => ({ day, cumulativeUsd }));
}
