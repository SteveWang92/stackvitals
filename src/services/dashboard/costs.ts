import type { CostPoint } from '../../types';
import { utcDayKey } from './history';
import { providerKey, type CostSnapshotRow } from './rows';

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

export function latestCostRows(rows: CostSnapshotRow[]): CostSnapshotRow[] {
  const latest = new Map<string, CostSnapshotRow>();

  for (const row of rows) {
    const key = [row.project_id ?? 'unallocated', providerKey(row) ?? 'unknown', row.service_name, row.period_start].join(':');
    const existing = latest.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      latest.set(key, row);
    }
  }

  return Array.from(latest.values()).filter((row) => (row.amount_usd ?? 0) > 0);
}

export function costTotal(rows: CostSnapshotRow[]): number | null {
  return rows.reduce<number | null>((total, row) => {
    if (row.amount_usd === null) {
      return total;
    }

    return (total ?? 0) + row.amount_usd;
  }, null);
}

/**
 * cost_snapshots.amount_usd is cumulative for its period and resets on the 1st, so this is
 * scoped to the current month only. A naive 30-day series would render the rollover as a
 * cliff. Points are cumulative MTD totals as of each collection day, not daily spend.
 */
export function buildMtdCostSeries(costs: CostSnapshotRow[], now = new Date()): CostPoint[] {
  const period = currentMonthBounds(now);
  const latestPerDay = new Map<string, Map<string, CostSnapshotRow>>();

  for (const row of costs.filter((cost) => isPeriodRow(cost, period))) {
    const day = utcDayKey(row.collected_at);
    const key = [row.project_id ?? 'unallocated', providerKey(row) ?? 'unknown', row.service_name].join(':');
    const dayRows = latestPerDay.get(day) ?? new Map<string, CostSnapshotRow>();
    const existing = dayRows.get(key);

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      dayRows.set(key, row);
    }

    latestPerDay.set(day, dayRows);
  }

  return Array.from(latestPerDay.entries())
    .map(([day, dayRows]) => ({
      day,
      cumulativeUsd: Array.from(dayRows.values()).reduce((total, row) => total + (row.amount_usd ?? 0), 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
