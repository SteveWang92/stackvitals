import { buildCollectorRunRecord } from '../collectorRunRecords';
import type {
  CollectorCost,
  CollectorHealthCheck,
  CollectorMetric,
  CollectorResource,
  CollectorRunRecord,
  CollectorRunRecorder,
} from '../types';

export interface CollectorRunsInsert {
  provider_id: string;
  started_at: string;
  finished_at: string;
  status: string;
  summary: string;
  error_message: string | null;
  metadata: CollectorRunRecord['metadata'];
}

export interface ResourceUpsert {
  project_id: string | null;
  provider_id: string;
  resource_type: string;
  external_id: string;
  display_name: string;
  metadata: Record<string, unknown>;
  last_seen_at: string;
}

export interface MetricSnapshotInsert {
  project_id: string | null;
  provider_id: string;
  metric_key: string;
  metric_value: number | null;
  status: string;
  metadata: Record<string, unknown>;
  collected_at: string;
}

export interface CostSnapshotInsert {
  project_id: string | null;
  provider_id: string;
  service_name: string;
  period_start: string;
  period_end: string;
  amount_usd: number | null;
  metadata: Record<string, unknown>;
  collected_at: string;
}

export interface HealthCheckInsert {
  project_id: string;
  url: string;
  status: string;
  http_status: number | null;
  response_time_ms: number;
  error_message?: string;
  checked_at: string;
}

export interface SupabaseCollectorRunClient {
  getProviderId: (providerKey: string) => Promise<string>;
  getProjectId: (projectSlug: string) => Promise<string>;
  upsertResources: (rows: ResourceUpsert[]) => Promise<void>;
  insertMetricSnapshots: (rows: MetricSnapshotInsert[]) => Promise<void>;
  insertCostSnapshots: (rows: CostSnapshotInsert[]) => Promise<void>;
  insertHealthChecks: (rows: HealthCheckInsert[]) => Promise<void>;
  insertCollectorRun: (row: CollectorRunsInsert) => Promise<void>;
}

function resourceExternalId(resource: CollectorResource): string {
  return resource.externalId ?? `${resource.projectSlug ?? 'global'}:${resource.resourceType}:${resource.displayName}`;
}

export function createSupabaseCollectorRunRecorder(client: SupabaseCollectorRunClient): CollectorRunRecorder {
  const providerIds = new Map<string, string>();
  const projectIds = new Map<string, string>();

  async function providerId(provider: string): Promise<string> {
    const cached = providerIds.get(provider);

    if (cached) {
      return cached;
    }

    const id = await client.getProviderId(provider);
    providerIds.set(provider, id);
    return id;
  }

  async function projectId(projectSlug: string): Promise<string> {
    const cached = projectIds.get(projectSlug);

    if (cached) {
      return cached;
    }

    const id = await client.getProjectId(projectSlug);
    projectIds.set(projectSlug, id);
    return id;
  }

  async function nullableProjectId(projectSlug: string | undefined): Promise<string | null> {
    return projectSlug ? projectId(projectSlug) : null;
  }

  async function resourceRows(resources: CollectorResource[], seenAt: string): Promise<ResourceUpsert[]> {
    return Promise.all(
      resources.map(async (resource) => ({
        project_id: await nullableProjectId(resource.projectSlug),
        provider_id: await providerId(resource.provider),
        resource_type: resource.resourceType,
        external_id: resourceExternalId(resource),
        display_name: resource.displayName,
        metadata: resource.metadata ?? {},
        last_seen_at: seenAt,
      })),
    );
  }

  async function metricRows(metrics: CollectorMetric[]): Promise<MetricSnapshotInsert[]> {
    return Promise.all(
      metrics.map(async (metric) => {
        const normalizedValue = normalizeMetricValue(metric.metricValue);

        if (normalizedValue === undefined && metric.metricValue !== undefined) {
          console.warn('[collector] skipping invalid metric value', {
            provider: metric.provider,
            metricKey: metric.metricKey,
            metricValue: metric.metricValue,
          });
        }
        return {
          project_id: await nullableProjectId(metric.projectSlug),
          provider_id: await providerId(metric.provider),
          metric_key: metric.metricKey,
          metric_value: normalizedValue ?? null,
          status: metric.status,
          metadata: metric.metadata ?? {},
          collected_at: metric.collectedAt,
        };
      }),
    );
  }

  function normalizeMetricValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  async function costRows(costs: CollectorCost[]): Promise<CostSnapshotInsert[]> {
    return Promise.all(
      costs.map(async (cost) => ({
        // Always null: costs are account-level. The column stays for a future allocation scheme.
        project_id: null,
        provider_id: await providerId(cost.provider),
        service_name: cost.serviceName,
        period_start: cost.periodStart,
        period_end: cost.periodEnd,
        amount_usd: cost.amountUsd,
        metadata: cost.metadata ?? {},
        collected_at: cost.collectedAt,
      })),
    );
  }

  async function healthRows(healthChecks: CollectorHealthCheck[]): Promise<HealthCheckInsert[]> {
    return Promise.all(
      healthChecks.map(async (check) => ({
        project_id: await projectId(check.projectSlug),
        url: check.url,
        status: check.status,
        http_status: check.httpStatus,
        response_time_ms: check.responseTimeMs,
        error_message: check.errorMessage,
        checked_at: check.checkedAt,
      })),
    );
  }

  return {
    recordCollectorResult: async (result) => {
      const record = buildCollectorRunRecord(result);

      await client.upsertResources(await resourceRows(result.resources, result.finishedAt));
      await client.insertMetricSnapshots(await metricRows(result.metrics));
      await client.insertCostSnapshots(await costRows(result.costs));
      await client.insertHealthChecks(await healthRows(result.healthChecks));
      await client.insertCollectorRun({
        provider_id: await providerId(record.provider),
        started_at: record.startedAt,
        finished_at: record.finishedAt,
        status: record.status,
        summary: record.summary,
        error_message: record.errorMessage,
        metadata: record.metadata,
      });
    },
  };
}
