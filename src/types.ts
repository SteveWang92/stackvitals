// Slugs are data: they live in the `projects` table and in collector config, so any
// non-empty string is a valid slug. The alias is kept for readability at call sites.
export type ProjectSlug = string;

export type StatusLevel = 'healthy' | 'warning' | 'failed' | 'unknown';

export type ProviderKey = 'aws' | 'amplify' | 'supabase' | 'resend' | 'cloudflare' | 'openai' | 'github' | 'http';

/** Whether a provider's data is recent, overdue, or has never arrived. */
export type Freshness = 'fresh' | 'stale' | 'never';

export interface ProviderStatus {
  provider: ProviderKey;
  label: string;
  status: StatusLevel;
  detail: string;
  lastSync: string | null;
  freshness: Freshness;
}

export interface CostSnapshot {
  provider: ProviderKey;
  serviceName?: string;
  monthToDateUsd: number | null;
}

export interface ProjectResource {
  id: string;
  provider: ProviderKey;
  type: string;
  name: string;
  status: StatusLevel;
  detail: string;
}

export interface SnapshotSummary {
  label: string;
  provider: ProviderKey;
  status: StatusLevel;
  value: string;
  collectedAt: string | null;
}

export interface CollectorErrorSummary {
  provider: ProviderKey;
  message: string;
  occurredAt: string;
}

export interface CollectorRunSummary {
  provider: ProviderKey;
  providerLabel: string;
  status: 'success' | 'partial_success' | 'skipped' | 'failed';
  summary: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastSyncedAt: string | null;
  durationMs: number | null;
  affectedProjects: ProjectSlug[];
}

export interface OpenAiUsageRow {
  apiKeyLabel: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  requests: number;
}

export interface OpenAiUsageSummary {
  totalTokens: number;
  cachedInputTokens: number;
  requests: number;
  spendUsd: number | null;
  lastMonthTokens: number | null;
  lastMonthSpendUsd: number | null;
  lastSync: string | null;
  rows: OpenAiUsageRow[];
}

export interface GitHubActionsUsageRow {
  projectSlug: ProjectSlug;
  projectName: string;
  repository: string;
  latestRun: string;
  recentRuns: number | null;
  recentFailures: number | null;
  scheduledRuns: number | null;
  scheduledFailures: number | null;
  durationSeconds: number | null;
  runtimeMinutes: number | null;
  lastSync: string | null;
  status: StatusLevel;
}

export interface GitHubActionsUsageSummary {
  runtimeMinutes: number;
  recentRuns: number;
  recentFailures: number;
  lastSync: string | null;
  rows: GitHubActionsUsageRow[];
}

export interface LatencyPoint {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** Median response time for that day, or null when no check ran. */
  p50Ms: number | null;
}

/** 'no-data' is a distinct state from 'down': a missed collector run is not an outage. */
export type UptimeDayState = 'up' | 'degraded' | 'down' | 'no-data';

export interface UptimeDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  state: UptimeDayState;
  /** 0 means the collector wrote nothing that day, which yields 'no-data'. */
  checks: number;
  failed: number;
}

export interface ProjectHistory {
  windowDays: number;
  /** One entry per day in the window, oldest first, gaps included. */
  latency: LatencyPoint[];
  /** One entry per day in the window, oldest first, gaps included. */
  uptime: UptimeDay[];
}

export interface CostPoint {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** Cumulative month-to-date spend as of that collection day, not daily spend. */
  cumulativeUsd: number;
}

export interface ProjectStatus {
  slug: ProjectSlug;
  name: string;
  publicUrl: string;
  deployStatus: StatusLevel;
  uptimeStatus: StatusLevel;
  lastSync: string | null;
  providers: ProviderStatus[];
  costs: CostSnapshot[];
  resources: ProjectResource[];
  recentSnapshots: SnapshotSummary[];
  collectorErrors: CollectorErrorSummary[];
  history: ProjectHistory;
}

export interface DomainDnsRecord {
  type: string;
  name: string;
  proxied: boolean | null;
}

export interface DomainSummary {
  domain: string;
  status: StatusLevel;
  zoneStatus: string;
  registrar: string | null;
  expiresAt: string | null;
  expirationDays: number | null;
  autoRenew: boolean | null;
  locked: boolean | null;
  dnsRecordCount: number | null;
  proxiedRecordCount: number | null;
  mxRecordCount: number | null;
  apexRecordPresent: boolean | null;
  wwwRecordPresent: boolean | null;
  lastSync: string | null;
  dnsRecords: DomainDnsRecord[];
}

export interface UnallocatedCostSnapshot {
  provider: ProviderKey;
  serviceName: string;
  monthToDateUsd: number | null;
}
