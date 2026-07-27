import { formatCurrencyUsd } from '../lib/status';

export function SummaryTiles({
  trackedApps,
  healthyProjects,
  providersNeedingAttention,
  monthToDateCost,
}: {
  trackedApps: number;
  healthyProjects: number;
  providersNeedingAttention: number;
  monthToDateCost: number;
}) {
  return (
    <section className="summary-grid" aria-label="Summary">
      <div className="summary-panel">
        <span>Tracked apps</span>
        <strong>{trackedApps}</strong>
      </div>
      <div className="summary-panel">
        <span>Healthy apps</span>
        <strong>{healthyProjects}</strong>
      </div>
      <div className="summary-panel">
        <span>Needs attention</span>
        <strong>{providersNeedingAttention}</strong>
      </div>
      <div className="summary-panel">
        <span>MTD cost</span>
        <strong>{formatCurrencyUsd(monthToDateCost)}</strong>
      </div>
    </section>
  );
}
