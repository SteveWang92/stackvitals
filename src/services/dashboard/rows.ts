import type { CollectorRunSummary, ProjectSlug, ProviderKey, StatusLevel } from '../../types';

/**
 * The raw `snake_case` shapes the Supabase reads return, plus the primitives every other
 * aggregation module needs to interrogate them. The app-facing `camelCase` types live in
 * `src/types.ts`; nothing outside this folder should have to know about a row.
 */

export interface ProviderRow {
  key: ProviderKey;
  name: string;
}

export interface ProjectRow {
  id: string;
  slug: ProjectSlug;
  name: string;
  public_url: string | null;
}

export interface ResourceRow {
  id: string;
  project_id: string | null;
  resource_type: string;
  display_name: string;
  metadata: Record<string, unknown> | null;
  last_seen_at: string | null;
  providers: ProviderRow | ProviderRow[] | null;
}

export interface MetricSnapshotRow {
  project_id: string | null;
  metric_key: string;
  metric_value: number | null;
  status: StatusLevel;
  metadata: Record<string, unknown> | null;
  collected_at: string;
  providers: ProviderRow | ProviderRow[] | null;
}

export interface CostSnapshotRow {
  project_id: string | null;
  service_name: string;
  period_start: string;
  period_end: string;
  amount_usd: number | null;
  metadata: Record<string, unknown> | null;
  collected_at: string;
  providers: ProviderRow | ProviderRow[] | null;
}

export interface HealthCheckRow {
  project_id: string;
  url: string;
  status: StatusLevel;
  http_status: number | null;
  response_time_ms: number | null;
  error_message: string | null;
  checked_at: string;
}

/**
 * Trimmed projection of health_checks for the 30-day window. Kept in its own array and never
 * merged into DashboardRows.healthChecks, so every existing dedup-to-latest path is untouched
 * by construction.
 */
export interface HealthCheckHistoryRow {
  project_id: string;
  status: StatusLevel;
  response_time_ms: number | null;
  checked_at: string;
}

export interface CollectorRunRow {
  started_at: string;
  finished_at: string | null;
  status: CollectorRunSummary['status'];
  summary: string | null;
  error_message: string | null;
  metadata: {
    adapterKey?: string;
    errors?: Array<{ projectSlug?: ProjectSlug; message: string }>;
  } | null;
  providers: ProviderRow | ProviderRow[] | null;
}

export interface DashboardRows {
  projects: ProjectRow[];
  resources: ResourceRow[];
  metrics: MetricSnapshotRow[];
  costs: CostSnapshotRow[];
  healthChecks: HealthCheckRow[];
  healthCheckHistory: HealthCheckHistoryRow[];
  collectorRuns: CollectorRunRow[];
}

const providerLabels: Record<ProviderKey, string> = {
  aws: 'AWS',
  amplify: 'Amplify',
  supabase: 'Supabase',
  resend: 'Resend',
  cloudflare: 'Cloudflare',
  openai: 'OpenAI',
  github: 'GitHub Actions',
  http: 'Public URL',
};

export function providerLabel(provider: ProviderKey): string {
  return providerLabels[provider] ?? provider;
}

/** Supabase embeds a joined row as either an object or a single-element array. */
export function providerKey(row: { providers: ProviderRow | ProviderRow[] | null }): ProviderKey | null {
  const provider = Array.isArray(row.providers) ? row.providers[0] : row.providers;

  return provider?.key ?? null;
}

export function latestBy<T>(rows: T[], getTime: (row: T) => string | null | undefined): T | undefined {
  return rows.slice().sort((a, b) => new Date(getTime(b) ?? 0).getTime() - new Date(getTime(a) ?? 0).getTime())[0];
}

export function metadataText(metadata: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

export function stringMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];

  return typeof value === 'string' ? value : null;
}

export function booleanMetadata(metadata: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = metadata?.[key];

  return typeof value === 'boolean' ? value : null;
}
