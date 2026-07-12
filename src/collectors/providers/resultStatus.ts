import type { CollectorAdapterResult, CollectorMetric } from '../types';

// Shared status derivation for metric-based adapters (Cloudflare, GitHub Actions):
// skipped when nothing ran, failed when every metric failed or only errors were
// recorded, partial_success on any error/failure/warning, success otherwise.
export function deriveResultStatus(metrics: CollectorMetric[], errors: CollectorAdapterResult['errors']): CollectorAdapterResult['status'] {
  if (metrics.length === 0 && errors.length === 0) {
    return 'skipped';
  }

  if (metrics.length === 0 && errors.length > 0) {
    return 'failed';
  }

  if (metrics.length > 0 && metrics.every((item) => item.status === 'failed')) {
    return 'failed';
  }

  if (errors.length > 0 || metrics.some((item) => item.status === 'failed' || item.status === 'warning')) {
    return 'partial_success';
  }

  return 'success';
}
