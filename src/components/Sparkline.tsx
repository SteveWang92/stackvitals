import { buildSparkline } from '../lib/chart';

/**
 * `valueLabel` is rendered as visible text beside the graphic, not only inside the SVG: the
 * numbers must be readable without interpreting the shape or the colour.
 *
 * `formatValue` adds the scale the line is drawn against — the highest and lowest reading in the
 * window — down the left edge. Without it the line only shows a shape: every sparkline is scaled
 * to its own range, so the same peak height can mean 200 ms or 2 seconds. The labels live in HTML
 * rather than inside the SVG because the viewBox is stretched horizontally, which would smear any
 * text drawn in it.
 */
export function Sparkline({
  points,
  label,
  valueLabel,
  formatValue,
  width = 120,
  height = 28,
}: {
  points: Array<number | null>;
  label: string;
  valueLabel: string;
  formatValue?: (value: number) => string;
  width?: number;
  height?: number;
}) {
  const geometry = buildSparkline(points, width, height);

  if (!geometry) {
    return <p className="sparkline-empty">Not enough history yet</p>;
  }

  // A flat series has one value, not a range: printing it twice would suggest a spread that is
  // not there.
  const scaleLabels = !formatValue
    ? []
    : geometry.max === geometry.min
      ? [formatValue(geometry.max)]
      : [formatValue(geometry.max), formatValue(geometry.min)];

  return (
    <div className="sparkline">
      <div className="sparkline-plot">
        {scaleLabels.length > 0 && (
          <div aria-hidden="true" className="sparkline-scale">
            {scaleLabels.map((scaleLabel) => (
              <span key={scaleLabel}>{scaleLabel}</span>
            ))}
          </div>
        )}
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
          {/* The viewBox is stretched to the container width, which would otherwise scale the
              stroke with it and leave vertical segments fatter than horizontal ones.
              non-scaling-stroke pins every stroke to the same on-screen width. The end marker is a
              zero-length path rather than a circle for the same reason: a circle would scale into
              an ellipse. */}
          <path
            d={geometry.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M${geometry.lastX.toFixed(2)} ${geometry.lastY.toFixed(2)} L${geometry.lastX.toFixed(2)} ${geometry.lastY.toFixed(2)}`}
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <span className="sparkline-value">{valueLabel}</span>
    </div>
  );
}
