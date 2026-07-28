import { describe, expect, it } from 'vitest';
import { buildSparkline, toDailyCostSeries } from '../../lib/chart';

describe('buildSparkline', () => {
  it('returns null when there are fewer than two readings', () => {
    expect(buildSparkline([], 100, 20)).toBeNull();
    expect(buildSparkline([null, null], 100, 20)).toBeNull();
    expect(buildSparkline([180, null, null], 100, 20)).toBeNull();
  });

  it('draws a single connected path when every point has a reading', () => {
    const geometry = buildSparkline([100, 200, 300], 100, 20);

    expect(geometry).not.toBeNull();
    expect(geometry?.path.match(/M/g)).toHaveLength(1);
    expect(geometry?.min).toBe(100);
    expect(geometry?.max).toBe(300);
  });

  it('breaks the path at gaps instead of drawing through them', () => {
    const geometry = buildSparkline([100, 200, null, 300, 400], 100, 20);

    // Two subpaths: one before the gap, one after. A single M would mean the gap was drawn over.
    expect(geometry?.path.match(/M/g)).toHaveLength(2);
  });

  it('maps the highest reading to the top and the lowest to the bottom', () => {
    const geometry = buildSparkline([100, 300], 100, 20);

    expect(geometry?.path).toBe('M0.00 20.00 L100.00 0.00');
  });

  it('draws a flat series down the middle without dividing by zero', () => {
    const geometry = buildSparkline([200, 200, 200], 100, 20);

    expect(geometry?.path).toBe('M0.00 10.00 L50.00 10.00 L100.00 10.00');
    expect(geometry?.path).not.toContain('NaN');
  });

  it('reports the last drawn point so callers can mark the current value', () => {
    const geometry = buildSparkline([100, 200, null], 100, 20);

    expect(geometry?.lastX).toBe(50);
    expect(geometry?.lastY).toBe(0);
  });
});

describe('toDailyCostSeries', () => {
  const now = new Date('2026-07-05T09:00:00.000Z');

  it('reports the rise since the previous collection as that day spend', () => {
    const series = toDailyCostSeries(
      [
        { day: '2026-07-01', cumulativeUsd: 2 },
        { day: '2026-07-02', cumulativeUsd: 5 },
        { day: '2026-07-03', cumulativeUsd: 6 },
      ],
      now,
    );

    expect(series.slice(0, 3)).toEqual([
      { day: '2026-07-01', value: 2 },
      { day: '2026-07-02', value: 3 },
      { day: '2026-07-03', value: 1 },
    ]);
  });

  it('spreads a gap across the days it covers instead of spiking on the day collection resumed', () => {
    const series = toDailyCostSeries(
      [
        { day: '2026-07-01', cumulativeUsd: 2 },
        { day: '2026-07-04', cumulativeUsd: 8 },
      ],
      now,
    );

    expect(series.map((point) => point.value)).toEqual([2, 2, 2, 2, null]);
  });

  it('spreads the first collection of the month back to the 1st', () => {
    const series = toDailyCostSeries([{ day: '2026-07-03', cumulativeUsd: 9 }], now);

    expect(series.map((point) => point.value)).toEqual([3, 3, 3, null, null]);
  });

  it('leaves days after the last collection null rather than reporting no spend', () => {
    const series = toDailyCostSeries([{ day: '2026-07-02', cumulativeUsd: 4 }], now);

    expect(series.slice(2).every((point) => point.value === null)).toBe(true);
  });

  it('clamps a downward revision to zero instead of charting negative spend', () => {
    const series = toDailyCostSeries(
      [
        { day: '2026-07-01', cumulativeUsd: 7 },
        { day: '2026-07-02', cumulativeUsd: 5 },
      ],
      now,
    );

    expect(series[1].value).toBe(0);
  });
});
