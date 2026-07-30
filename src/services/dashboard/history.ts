import type { LatencyPoint, ProjectHistory, TrendPoint, UptimeDay } from '../../types';
import type { HealthCheckHistoryRow, MetricSnapshotRow } from './rows';

/** How many days of latency/uptime history the dashboard reads and renders. */
export const HISTORY_WINDOW_DAYS = 30;

/**
 * Day keys are UTC throughout, matching currentMonthBounds/lastMonthBounds. Display code must
 * label cells with the explicit date rather than a local-time weekday, or the two disagree.
 */
export function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** The window's day keys, oldest first, always exactly `days` long including today. */
export function utcDayRange(days: number, now = new Date()): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Array.from({ length: days }, (_, index) => new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

/** Inclusive lower bound for the history query: midnight UTC on the window's first day. */
export function historySince(days: number, now = new Date()): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return new Date(today - (days - 1) * 86_400_000).toISOString();
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function groupChecksByDay(checks: HealthCheckHistoryRow[]): Map<string, HealthCheckHistoryRow[]> {
  const byDay = new Map<string, HealthCheckHistoryRow[]>();

  for (const check of checks) {
    const day = utcDayKey(check.checked_at);
    const existing = byDay.get(day);

    if (existing) {
      existing.push(check);
    } else {
      byDay.set(day, [check]);
    }
  }

  return byDay;
}

/**
 * One cell per day in the window. Days the collector never wrote become 'no-data', never
 * 'down' — a missed run is silence, not an outage, and conflating them invents incidents.
 */
function buildUptimeDays(checks: HealthCheckHistoryRow[], days: string[]): UptimeDay[] {
  const byDay = groupChecksByDay(checks);

  return days.map((day) => {
    const dayChecks = byDay.get(day) ?? [];
    const failed = dayChecks.filter((check) => check.status === 'failed').length;
    const degraded = dayChecks.filter((check) => check.status === 'warning').length;

    if (dayChecks.length === 0) {
      return { day, state: 'no-data', checks: 0, failed: 0 };
    }

    if (failed === dayChecks.length) {
      return { day, state: 'down', checks: dayChecks.length, failed };
    }

    if (failed > 0 || degraded > 0) {
      return { day, state: 'degraded', checks: dayChecks.length, failed };
    }

    return { day, state: 'up', checks: dayChecks.length, failed };
  });
}

/**
 * Median rather than mean: with a retry outlier on a low-sample day, the mean misrepresents
 * the typical response. Days without a check carry null so the sparkline renders a gap.
 */
function buildLatencyPoints(checks: HealthCheckHistoryRow[], days: string[]): LatencyPoint[] {
  const byDay = groupChecksByDay(checks);

  return days.map((day) => {
    const times = (byDay.get(day) ?? [])
      .map((check) => check.response_time_ms)
      .filter((value): value is number => typeof value === 'number');

    return { day, p50Ms: times.length === 0 ? null : Math.round(median(times)) };
  });
}

export function buildProjectHistory(
  projectId: string,
  checks: HealthCheckHistoryRow[],
  windowDays = HISTORY_WINDOW_DAYS,
  now = new Date(),
): ProjectHistory {
  const days = utcDayRange(windowDays, now);
  const projectChecks = checks.filter((check) => check.project_id === projectId);

  return {
    windowDays,
    latency: buildLatencyPoints(projectChecks, days),
    uptime: buildUptimeDays(projectChecks, days),
  };
}

/**
 * Sums a metric across its per-day snapshots, one point per day from the first reading to today.
 *
 * Unlike the cost series these metrics are rolling-window totals rather than period totals, so the
 * point for a day is the value the collector reported that day, not the change since the day
 * before — a difference the chart headings have to state. Where a day holds several snapshots for
 * the same subject (a re-run), the newest wins before summing, and a day with no run stays null so
 * the chart shows a gap instead of a drop to zero.
 */
export function buildTrendSeries(
  rows: MetricSnapshotRow[],
  subjectKey: (row: MetricSnapshotRow) => string,
  scale = 1,
  now = new Date(),
): TrendPoint[] {
  const latestPerDay = new Map<string, Map<string, MetricSnapshotRow>>();

  for (const row of rows) {
    const day = utcDayKey(row.collected_at);
    const daySubjects = latestPerDay.get(day) ?? new Map<string, MetricSnapshotRow>();
    const existing = daySubjects.get(subjectKey(row));

    if (!existing || new Date(row.collected_at).getTime() > new Date(existing.collected_at).getTime()) {
      daySubjects.set(subjectKey(row), row);
    }

    latestPerDay.set(day, daySubjects);
  }

  if (latestPerDay.size === 0) {
    return [];
  }

  const firstDay = Array.from(latestPerDay.keys()).sort()[0];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const spanDays = Math.round((today - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000) + 1;
  // Same window as the uptime history, so a collector that stopped months ago cannot stretch the
  // chart into a strip of empty days.
  const windowDays = Math.min(HISTORY_WINDOW_DAYS, Math.max(1, spanDays));

  return utcDayRange(windowDays, now).map((day) => {
    const daySubjects = latestPerDay.get(day);

    return {
      day,
      value: daySubjects ? Array.from(daySubjects.values()).reduce((total, row) => total + (row.metric_value ?? 0), 0) * scale : null,
    };
  });
}
