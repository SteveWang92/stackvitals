import type { CostSnapshot, ProviderKey } from '../types';
import { displayCostLabel } from './format';

export interface CostRow {
  provider: ProviderKey;
  label: string;
  amountUsd: number | null;
}

/**
 * Order the cost snapshots for display, largest first. Rows without a positive amount are dropped
 * so empty cost lines never pad the table.
 */
export function buildCostRows(costs: CostSnapshot[]): CostRow[] {
  return costs
    .map((cost) => ({
      provider: cost.provider,
      label: displayCostLabel(cost.serviceName),
      amountUsd: cost.monthToDateUsd,
    }))
    .filter((row) => (row.amountUsd ?? 0) > 0)
    .sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0));
}
