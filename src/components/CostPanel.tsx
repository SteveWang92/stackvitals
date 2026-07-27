import { DollarSign } from 'lucide-react';
import type { CostRow } from '../lib/costRows';
import { formatCurrencyUsd } from '../lib/status';
import { EmptyState } from './EmptyState';

function CostSummary({
  costRows,
  monthToDateCost,
  lastMonthCostUsd,
}: {
  costRows: CostRow[];
  monthToDateCost: number;
  lastMonthCostUsd: number | null;
}) {
  const largestCost = costRows[0] ?? null;

  return (
    <div className="cost-summary">
      <div>
        <span>MTD cost</span>
        <strong>{formatCurrencyUsd(monthToDateCost)}</strong>
      </div>
      <div>
        <span>Cost lines</span>
        <strong>{costRows.length}</strong>
      </div>
      <div>
        <span>Last month cost</span>
        <strong>{formatCurrencyUsd(lastMonthCostUsd)}</strong>
      </div>
      <div className="cost-summary-wide">
        <span>Largest line</span>
        <strong>{largestCost ? `${largestCost.label} - ${formatCurrencyUsd(largestCost.amountUsd)}` : 'No cost rows'}</strong>
      </div>
    </div>
  );
}

export function CostPanel({
  costRows,
  monthToDateCost,
  lastMonthCostUsd,
}: {
  costRows: CostRow[];
  monthToDateCost: number;
  lastMonthCostUsd: number | null;
}) {
  return (
    <section className="cost-panel" aria-label="Cost breakdown">
      <div className="section-heading">
        <DollarSign aria-hidden="true" size={18} />
        <h2>Cost Snapshot</h2>
      </div>
      {costRows.length === 0 ? (
        <div className="panel-empty">
          <EmptyState message="No cost rows are available. Run the cost collector or check provider credentials." title="No cost rows" />
        </div>
      ) : (
        <>
          <CostSummary costRows={costRows} monthToDateCost={monthToDateCost} lastMonthCostUsd={lastMonthCostUsd} />
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Cost line</th>
                <th>Month to date</th>
              </tr>
            </thead>
            <tbody>
              {costRows.map((cost, index) => (
                <tr key={`${cost.provider}-${cost.label}-${index}`}>
                  <td>{cost.provider.toUpperCase()}</td>
                  <td>{cost.label}</td>
                  <td>{formatCurrencyUsd(cost.amountUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
