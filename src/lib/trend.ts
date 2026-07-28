import type { TrendPoint } from '../types';

/** The most recent day that actually has a reading, so a trailing gap does not read as zero. */
export function latestReading(points: TrendPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].value !== null) {
      return points[index].value;
    }
  }

  return null;
}

/**
 * Caption for a usage trend. The peak is only worth naming when it is behind us — when today is
 * the highest reading, printing the same number twice reads as a rendering fault, and saying so
 * in words carries the meaning the repetition was meant to.
 */
export function trendSummary(points: TrendPoint[], format: (value: number) => string): string {
  const latest = latestReading(points);
  const peak = peakReading(points);

  if (latest === null || peak === null) {
    return 'No readings yet';
  }

  return peak > latest ? `${format(latest)} latest - ${format(peak)} peak` : `${format(latest)} latest, the highest yet`;
}

export function peakReading(points: TrendPoint[]): number | null {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null);

  return values.length === 0 ? null : Math.max(...values);
}

export function averageReading(points: TrendPoint[]): number | null {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null);

  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}
