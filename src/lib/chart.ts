import type { CostPoint, TrendPoint } from '../types';

export interface SparklineGeometry {
  /** SVG path data. Contains one `M` subpath per unbroken run of points. */
  path: string;
  lastX: number;
  lastY: number;
  min: number;
  max: number;
}

/**
 * Builds sparkline path data from a fixed-length series where null means "no reading".
 *
 * Nulls break the path into separate subpaths rather than being skipped or zeroed: a gap in the
 * data must look like a gap, never like a line drawn down to the axis. Returns null when there
 * are fewer than two readings, so callers can render text instead of a misleading single dot.
 */
export function buildSparkline(points: Array<number | null>, width: number, height: number): SparklineGeometry | null {
  const values = points.filter((value): value is number => value !== null);

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  // A flat series has no range to scale against; draw it down the middle instead of dividing by zero.
  const toY = (value: number) => (span === 0 ? height / 2 : height - ((value - min) / span) * height);

  let path = '';
  let penDown = false;
  let lastX = 0;
  let lastY = height / 2;

  points.forEach((value, index) => {
    if (value === null) {
      penDown = false;
      return;
    }

    const x = index * stepX;
    const y = toY(value);

    path += `${penDown ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    path += index === points.length - 1 ? '' : ' ';
    penDown = true;
    lastX = x;
    lastY = y;
  });

  return { path: path.trim(), lastX, lastY, min, max };
}

function utcDay(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Turns the cumulative month-to-date cost series into spend per calendar day.
 *
 * The stored amounts are period totals, so a day's spend is the rise since the previous
 * collection. When the collector skipped days, that rise covers all of them and is spread evenly
 * across the gap rather than spiking on the day it came back — the money was spent over the whole
 * gap, and a spike would read as an incident. The month starts from zero, so the first collection
 * of the month is spread back to the 1st the same way. Days after the last collection stay null:
 * nothing has been reported for them yet, which is not the same as spending nothing.
 *
 * Providers do revise estimates downward, which would otherwise produce a negative day; those are
 * clamped to zero.
 */
export function toDailyCostSeries(points: CostPoint[], now = new Date()): TrendPoint[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const series: TrendPoint[] = Array.from({ length: today }, (_, index) => ({
    day: utcDay(year, month, index + 1),
    value: null,
  }));
  const dayIndex = new Map(series.map((point, index) => [point.day, index]));
  let previousIndex = -1;
  let previousCumulative = 0;

  for (const point of points.slice().sort((a, b) => a.day.localeCompare(b.day))) {
    const index = dayIndex.get(point.day);

    if (index === undefined || index <= previousIndex) {
      continue;
    }

    const perDay = Math.max(0, point.cumulativeUsd - previousCumulative) / (index - previousIndex);

    for (let fill = previousIndex + 1; fill <= index; fill += 1) {
      series[fill].value = perDay;
    }

    previousIndex = index;
    previousCumulative = point.cumulativeUsd;
  }

  return series;
}
