import type { ProjectStatus, ProviderKey, UnallocatedCostSnapshot } from '../types';
import { displayCostLabel } from './format';

export interface CostRow {
  provider: ProviderKey;
  label: string;
  amountUsd: number | null;
}

/**
 * Flatten per-project and unallocated cost snapshots into one descending list.
 * Rows without a positive amount are dropped so empty cost lines never pad the table.
 */
export function buildCostRows(projects: ProjectStatus[], unallocatedCosts: UnallocatedCostSnapshot[]): CostRow[] {
  return [
    ...projects.flatMap((project) =>
      project.costs.map((cost) => ({
        provider: cost.provider,
        label: displayCostLabel(cost.serviceName),
        amountUsd: cost.monthToDateUsd,
      })),
    ),
    ...unallocatedCosts.map((cost) => ({
      provider: cost.provider,
      label: displayCostLabel(cost.serviceName),
      amountUsd: cost.monthToDateUsd,
    })),
  ]
    .filter((row) => (row.amountUsd ?? 0) > 0)
    .sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0));
}
