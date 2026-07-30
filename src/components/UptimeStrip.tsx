import type { UptimeDay, UptimeDayState } from '../types';

const stateLabel: Record<UptimeDayState, string> = {
  up: 'up',
  degraded: 'degraded',
  down: 'down',
  'no-data': 'no data',
};

function cellTitle(day: UptimeDay): string {
  if (day.state === 'no-data') {
    return `${day.day} — no data (the collector did not run)`;
  }

  if (day.state === 'up') {
    return `${day.day} — up (${day.checks} of ${day.checks} checks passed)`;
  }

  return `${day.day} — ${stateLabel[day.state]} (${day.failed} of ${day.checks} checks failed)`;
}

/**
 * One cell per day. Colour is the last of three encodings, not the only one: the summary line
 * carries the counts in text, and each state also differs in shape (hollow for no-data,
 * half-height for degraded), so the strip is readable without colour vision.
 */
export function UptimeStrip({ days, label = 'Uptime, last 30 days' }: { days: UptimeDay[]; label?: string }) {
  if (days.length === 0) {
    return null;
  }

  const up = days.filter((day) => day.state === 'up').length;
  const degraded = days.filter((day) => day.state === 'degraded').length;
  const down = days.filter((day) => day.state === 'down').length;
  const noData = days.filter((day) => day.state === 'no-data').length;
  const summary = [
    `${up}/${days.length} days up`,
    degraded > 0 ? `${degraded} degraded` : null,
    down > 0 ? `${down} down` : null,
    noData > 0 ? `${noData} no data` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const cellWidth = 100 / days.length;

  return (
    <div className="uptime-strip">
      <svg
        role="img"
        aria-label={`${label}: ${summary}`}
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        className="uptime-strip-svg"
        focusable="false"
      >
        <title>{`${label}: ${summary}`}</title>
        {days.map((day, index) => (
          <rect
            key={day.day}
            className={`uptime-day uptime-day-${day.state}`}
            x={index * cellWidth + cellWidth * 0.12}
            y={day.state === 'degraded' ? 6 : 0}
            width={cellWidth * 0.76}
            height={day.state === 'degraded' ? 6 : 12}
            rx={0.8}
          >
            <title>{cellTitle(day)}</title>
          </rect>
        ))}
      </svg>
      <p className="uptime-strip-summary">{summary}</p>
    </div>
  );
}
