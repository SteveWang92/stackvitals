import type { ProjectSlug, ProviderKey, StatusLevel } from '../types';

export type CollectorRunStatus = 'success' | 'partial_success' | 'skipped' | 'failed';

export interface CollectorContext {
  startedAt: string;
}

export interface CollectorResource {
  projectSlug?: ProjectSlug;
  provider: ProviderKey;
  resourceType: string;
  externalId?: string;
  displayName: string;
  metadata?: Record<string, unknown>;
}

export interface CollectorMetric {
  projectSlug?: ProjectSlug;
  provider: ProviderKey;
  metricKey: string;
  metricValue?: number;
  status: StatusLevel;
  metadata?: Record<string, unknown>;
  collectedAt: string;
}

/**
 * Costs are account-level. There is deliberately no project field: providers bill by service, and
 * no adapter can say which of your apps a shared line belongs to without inventing an allocation.
 */
export interface CollectorCost {
  provider: ProviderKey;
  serviceName: string;
  periodStart: string;
  periodEnd: string;
  amountUsd: number | null;
  metadata?: Record<string, unknown>;
  collectedAt: string;
}

export interface CollectorHealthCheck {
  projectSlug: ProjectSlug;
  url: string;
  status: StatusLevel;
  httpStatus: number | null;
  responseTimeMs: number;
  checkedAt: string;
  errorMessage?: string;
}

export interface CollectorError {
  projectSlug?: ProjectSlug;
  message: string;
  retryable: boolean;
}

export interface CollectorAdapterResult {
  provider: ProviderKey;
  // Distinguishes runs when several adapters share one provider key (e.g. the supabase
  // project-health adapter and each watched app's aggregate adapter).
  adapterKey?: string;
  status: CollectorRunStatus;
  startedAt: string;
  finishedAt: string;
  summary: string;
  resources: CollectorResource[];
  metrics: CollectorMetric[];
  costs: CollectorCost[];
  healthChecks: CollectorHealthCheck[];
  errors: CollectorError[];
}

export interface ProviderAdapter {
  provider: ProviderKey;
  adapterKey?: string;
  collect: (context: CollectorContext) => Promise<CollectorAdapterResult>;
}

export interface CollectorRunRecord {
  provider: ProviderKey;
  startedAt: string;
  finishedAt: string;
  status: CollectorRunStatus;
  summary: string;
  errorMessage: string | null;
  metadata: {
    adapterKey?: string;
    resources: number;
    metrics: number;
    costs: number;
    healthChecks: number;
    errors: CollectorError[];
  };
}

export interface CollectorRunRecorder {
  recordCollectorResult: (result: CollectorAdapterResult) => Promise<void>;
}

export interface CollectorRunSummary {
  status: CollectorRunStatus;
  startedAt: string;
  finishedAt: string;
  results: CollectorAdapterResult[];
}
