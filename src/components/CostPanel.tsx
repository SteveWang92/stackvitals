import { DollarSign } from 'lucide-react';
import { toDailyCostSeries } from '../lib/chart';
import type { CostRow } from '../lib/costRows';
import { formatCurrencyUsd } from '../lib/status';
import { averageReading, latestReading } from '../lib/trend';
import type { CostPoint } from '../types';
import { EmptyState } from './EmptyState';
import { TrendChart } from './TrendChart';

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
  mtdCostSeries,
}: {
  costRows: CostRow[];
  monthToDateCost: number;
  lastMonthCostUsd: number | null;
  mtdCostSeries: CostPoint[];
}) {
  const dailyCost = toDailyCostSeries(mtdCostSeries);

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
          <TrendChart
            title="Daily spend this month"
            points={dailyCost}
            label="Spend per day, this billing period"
            valueLabel={`${formatCurrencyUsd(latestReading(dailyCost))} on the latest collected day - ${formatCurrencyUsd(averageReading(dailyCost))} daily average`}
          />
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
