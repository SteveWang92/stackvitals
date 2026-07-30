import { AlertTriangle } from 'lucide-react';
import type { AttentionItem } from '../lib/attention';
import type { ProjectSlug } from '../types';
import { StaleBadge } from './StaleBadge';
import { StatusPill } from './StatusPill';

export function AttentionPanel({
  items,
  staleCount,
  onSelect,
}: {
  items: AttentionItem[];
  staleCount: number;
  onSelect: (slug: ProjectSlug) => void;
}) {
  // A silent collector is the one failure mode nothing else on the page reports, so the panel
  // still appears when the only thing wrong is that providers have gone quiet.
  if (items.length === 0 && staleCount === 0) {
    return null;
  }

  return (
    <section className="attention-panel" aria-label="Needs attention">
      <div className="section-heading">
        <AlertTriangle aria-hidden="true" size={18} />
        <h2>Needs Attention</h2>
      </div>

      {items.length > 0 && (
        <div className="compact-list">
          {items.map((item) => (
            <button
              className="compact-row attention-row"
              type="button"
              key={`${item.projectSlug}-${item.provider}-${item.label}`}
              onClick={() => onSelect(item.projectSlug)}
            >
              <div>
                <strong>
                  {item.projectName} - {item.label}
                </strong>
                <span>{item.detail}</span>
              </div>
              <StaleBadge freshness={item.freshness} lastSync={item.lastSync} />
              <StatusPill status={item.status} />
            </button>
          ))}
        </div>
      )}

      {staleCount > 0 && (
        <p className="attention-footnote">
          {staleCount} provider{staleCount === 1 ? '' : 's'} {staleCount === 1 ? 'has' : 'have'} not reported recently. Stale data is
          counted separately from failures.
        </p>
      )}
    </section>
  );
}
