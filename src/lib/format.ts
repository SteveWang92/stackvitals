import type { DomainSummary } from '../types';

export function displayCostLabel(label: string | undefined): string {
  const normalized = label?.trim();

  if (!normalized || normalized.toLowerCase() === 'unknown' || normalized.toLowerCase() === 'unallocated') {
    return 'Cost line';
  }

  return normalized;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'In progress or not recorded';
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMinutes(value: number | null): string {
  if (value === null) {
    return 'Unknown';
  }

  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)} min`;
}

export function formatDomainExpiry(domain: DomainSummary): string {
  if (!domain.expiresAt) {
    return 'Unknown';
  }

  const date = new Intl.DateTimeFormat('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(domain.expiresAt));

  return domain.expirationDays === null ? date : `${date} (${domain.expirationDays}d)`;
}

export function formatDnsBreakdown(domain: DomainSummary): string {
  if (domain.dnsRecordCount === null) {
    return 'No DNS data yet';
  }

  const parts = [`${domain.dnsRecordCount} total`];

  if (domain.proxiedRecordCount !== null) {
    parts.push(`${domain.proxiedRecordCount} proxied`);
  }

  if (domain.mxRecordCount !== null) {
    parts.push(`${domain.mxRecordCount} MX`);
  }

  if (domain.apexRecordPresent === false) {
    parts.push('apex missing');
  }

  if (domain.wwwRecordPresent === false) {
    parts.push('www missing');
  }

  return parts.join(', ');
}
