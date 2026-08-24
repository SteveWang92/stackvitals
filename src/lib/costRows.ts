import type { CostSnapshot, ProviderKey } from '../types';
import { displayCostLabel } from './format';

export interface CostRow {
  provider: ProviderKey;
  label: string;
  amountUsd: number;
}

/**
 * Order the cost snapshots for display, largest first. Rows without a positive amount are dropped
 * so empty cost lines never pad the table.
 */
export function buildCostRows(costs: CostSnapshot[]): CostRow[] {
  return costs
    .filter((cost): cost is CostSnapshot & { monthToDateUsd: number } => cost.monthToDateUsd !== null && cost.monthToDateUsd > 0)
    .map((cost) => ({
      provider: cost.provider,
      label: displayCostLabel(cost.serviceName),
      amountUsd: cost.monthToDateUsd,
    }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
}
