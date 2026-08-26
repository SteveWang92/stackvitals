import type { CollectorRunSummary, Freshness, StatusLevel } from '../types';

/**
 * The collector cron runs once a day, so a 24h threshold trips on ordinary scheduling drift.
 * 36h leaves room for a late run while still catching a collector that actually stopped.
 */
export const STALE_AFTER_HOURS = 36;

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

  const parsed = new Date(value);

  // h23, not the locale default: every timestamp on the dashboard is a machine event, and a
  // 24-hour clock reads the same in every locale the browser might be set to.
  return new Intl.DateTimeFormat('en-AU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed);
}

/**
 * Distinguishes "we have not heard from it" from "it is broken". Staleness annotates a provider
 * rather than downgrading its status, so a stale-but-last-known-healthy provider stays readable.
 */
export function freshnessOf(lastSync: string | null, now = new Date()): Freshness {
  if (!lastSync) {
    return 'never';
  }

  return isStaleSync(lastSync, now, STALE_AFTER_HOURS) ? 'stale' : 'fresh';
}

export function isStaleSync(value: string | null, now = new Date(), staleAfterHours = STALE_AFTER_HOURS): boolean {
  if (!value) {
    return true;
  }

  const syncedAt = new Date(value).getTime();

  return now.getTime() - syncedAt > staleAfterHours * 60 * 60 * 1000;
}
