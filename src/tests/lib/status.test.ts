import { describe, expect, it } from 'vitest';
import { STALE_AFTER_HOURS, formatCurrencyUsd, freshnessOf, getOverallStatus, isStaleSync } from '../../lib/status';

describe('getOverallStatus', () => {
  it('returns failed when any provider failed', () => {
    expect(getOverallStatus(['healthy', 'failed', 'warning'])).toBe('failed');
  });

  it('returns warning before healthy', () => {
    expect(getOverallStatus(['healthy', 'warning'])).toBe('warning');
  });

  it('returns unknown when there is no signal', () => {
    expect(getOverallStatus([])).toBe('unknown');
    expect(getOverallStatus(['unknown'])).toBe('unknown');
  });
});

describe('formatCurrencyUsd', () => {
  it('formats known costs', () => {
    expect(formatCurrencyUsd(12.3)).toBe('$12.30');
  });

  it('labels unknown costs', () => {
    expect(formatCurrencyUsd(null)).toBe('Unknown');
  });
});

describe('isStaleSync', () => {
  it('treats missing or invalid sync times as stale', () => {
    expect(isStaleSync(null)).toBe(true);
    expect(isStaleSync('not-a-date')).toBe(true);
  });

  it('detects sync times older than the default threshold', () => {
    const now = new Date('2026-06-27T12:00:00.000Z');

    // Default is 36h, not the 24h collector cadence, so ordinary cron drift is not flagged.
    expect(isStaleSync('2026-06-25T23:59:59.000Z', now)).toBe(true);
    expect(isStaleSync('2026-06-26T11:59:59.000Z', now)).toBe(false);
  });

  it('honours an explicit threshold', () => {
    const now = new Date('2026-06-27T12:00:00.000Z');

    expect(isStaleSync('2026-06-26T11:59:59.000Z', now, 24)).toBe(true);
  });
});

describe('freshnessOf', () => {
  const now = new Date('2026-06-27T12:00:00.000Z');

  it('separates never-synced from stale', () => {
    expect(freshnessOf(null, now)).toBe('never');
    expect(freshnessOf('2026-06-25T23:59:59.000Z', now)).toBe('stale');
  });

  it('treats a sync inside the window as fresh', () => {
    expect(freshnessOf('2026-06-27T09:00:00.000Z', now)).toBe('fresh');
  });

  it('uses the shared threshold constant', () => {
    const justInside = new Date(now.getTime() - (STALE_AFTER_HOURS - 1) * 60 * 60 * 1000).toISOString();
    const justOutside = new Date(now.getTime() - (STALE_AFTER_HOURS + 1) * 60 * 60 * 1000).toISOString();

    expect(freshnessOf(justInside, now)).toBe('fresh');
    expect(freshnessOf(justOutside, now)).toBe('stale');
  });
});
