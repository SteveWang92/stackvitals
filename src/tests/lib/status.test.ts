import { describe, expect, it } from 'vitest';
import { formatCurrencyUsd, getOverallStatus, isStaleSync } from '../../lib/status';

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

  it('detects sync times older than the threshold', () => {
    const now = new Date('2026-06-27T12:00:00.000Z');

    expect(isStaleSync('2026-06-26T11:59:59.000Z', now)).toBe(true);
    expect(isStaleSync('2026-06-26T12:30:00.000Z', now)).toBe(false);
  });
});
