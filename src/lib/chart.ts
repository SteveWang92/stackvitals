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
