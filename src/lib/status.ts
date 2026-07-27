import type { CollectorRunSummary, StatusLevel } from '../types';

export const statusLabel: Record<StatusLevel, string> = {
  healthy: 'Healthy',
  warning: 'Needs attention',
  failed: 'Failed',
  unknown: 'Unknown',
};

export function collectorRunStatusLevel(status: CollectorRunSummary['status']): StatusLevel {
  if (status === 'success') {
    return 'healthy';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'partial_success') {
    return 'warning';
  }

  return 'unknown';
}

export function getOverallStatus(statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('failed')) {
    return 'failed';
  }

  if (statuses.includes('warning')) {
    return 'warning';
  }

  if (statuses.length === 0 || statuses.every((status) => status === 'unknown')) {
    return 'unknown';
  }

  return 'healthy';
}

export function formatCurrencyUsd(value: number | null): string {
  if (value === null) {
    return 'Unknown';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatRelativeSync(value: string | null): string {
  if (!value) {
    return 'Never synced';
  }

  return new Intl.DateTimeFormat('en-AU', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function isStaleSync(value: string | null, now = new Date(), staleAfterHours = 24): boolean {
  if (!value) {
    return true;
  }

  const syncedAt = new Date(value).getTime();

  if (Number.isNaN(syncedAt)) {
    return true;
  }

  return now.getTime() - syncedAt > staleAfterHours * 60 * 60 * 1000;
}
