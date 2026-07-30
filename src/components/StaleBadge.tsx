import { Clock3 } from 'lucide-react';
import { formatRelativeSync } from '../lib/status';
import type { Freshness } from '../types';

function ageLabel(lastSync: string | null): string {
  if (!lastSync) {
    return 'Never';
  }

  const elapsedHours = (Date.now() - new Date(lastSync).getTime()) / (60 * 60 * 1000);

  if (Number.isNaN(elapsedHours)) {
    return 'Never';
  }

  return elapsedHours < 48 ? `${Math.round(elapsedHours)}h old` : `${Math.round(elapsedHours / 24)}d old`;
}

/**
 * Annotates a provider whose data has stopped arriving. Deliberately text rather than a colour
 * change: "we have not heard from it" is a different fact from "it is failing", and the status
 * pill still carries the last known state.
 */
export function StaleBadge({ freshness, lastSync }: { freshness: Freshness; lastSync: string | null }) {
  if (freshness === 'fresh') {
    return null;
  }

  return (
    <span className="stale-badge" title={formatRelativeSync(lastSync)}>
      <Clock3 aria-hidden="true" size={13} />
      {ageLabel(lastSync)}
    </span>
  );
}
