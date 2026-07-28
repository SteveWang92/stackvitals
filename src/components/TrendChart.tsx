import type { TrendPoint } from '../types';
import { Sparkline } from './Sparkline';

/**
 * The trend block used by the cost and usage panels. Renders nothing below two readings: a single
 * point is a number, not a trend, and the panel already states the number above it.
 */
export function TrendChart({
  title,
  points,
  label,
  valueLabel,
}: {
  title: string;
  points: TrendPoint[];
  label: string;
  valueLabel: string;
}) {
  if (points.filter((point) => point.value !== null).length < 2) {
    return null;
  }

  return (
    <div className="panel-trend">
      <h3>{title}</h3>
      <Sparkline points={points.map((point) => point.value)} label={label} valueLabel={valueLabel} width={320} height={56} />
    </div>
  );
}
