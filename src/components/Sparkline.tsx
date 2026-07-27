import { buildSparkline } from '../lib/chart';

/**
 * `valueLabel` is rendered as visible text beside the graphic, not only inside the SVG: the
 * numbers must be readable without interpreting the shape or the colour.
 */
export function Sparkline({
  points,
  label,
  valueLabel,
  width = 120,
  height = 28,
}: {
  points: Array<number | null>;
  label: string;
  valueLabel: string;
  width?: number;
  height?: number;
}) {
  const geometry = buildSparkline(points, width, height);

  if (!geometry) {
    return <p className="sparkline-empty">Not enough history yet</p>;
  }

  return (
    <div className="sparkline">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width={width}
        height={height}
        focusable="false"
      >
        <title>{label}</title>
        <path d={geometry.path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={geometry.lastX} cy={geometry.lastY} r={2} fill="currentColor" />
      </svg>
      <span className="sparkline-value">{valueLabel}</span>
    </div>
  );
}
