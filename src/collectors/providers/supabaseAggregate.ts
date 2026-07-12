import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface SupabaseAggregateTarget {
  projectSlug: ProjectSlug;
  projectRef: string;
  rpcName: string;
}

export interface SupabaseAggregateRow {
  metric_key: string;
  metric_value: number | null;
  status?: StatusLevel;
  resource_type?: string;
  resource_name?: string;
  metadata?: Record<string, unknown>;
}

export interface SupabaseAggregateClient {
  rpc: (
    rpcName: string,
    params: { project_ref: string },
  ) => Promise<{
    data: SupabaseAggregateRow[] | null;
    error: { message: string } | null;
  }>;
}

export interface SupabaseAggregateOptions {
  client: SupabaseAggregateClient;
}

// Several adapters share the 'supabase' provider key (project health plus one aggregate
// adapter per watched app); the adapter key keeps their collector runs distinguishable.
function aggregateAdapterKey(targets: SupabaseAggregateTarget[]): string {
  return ['supabase_aggregate', ...targets.map((target) => target.projectSlug)].join(':');
}

function rowStatus(row: SupabaseAggregateRow): StatusLevel {
  return row.status ?? (row.metric_value === null ? 'warning' : 'healthy');
}

export async function collectSupabaseAggregateStatus(
  targets: SupabaseAggregateTarget[],
  options: SupabaseAggregateOptions,
): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      try {
        const result = await options.client.rpc(target.rpcName, { project_ref: target.projectRef });

        if (result.error) {
          throw new Error(result.error.message);
        }

        const rows = result.data ?? [];

        resources.push({
          projectSlug: target.projectSlug,
          provider: 'supabase',
          resourceType: 'project',
          externalId: target.projectRef,
          displayName: target.projectRef,
          metadata: {
            rpcName: target.rpcName,
            aggregateRows: rows.length,
          },
        });

        for (const row of rows) {
          const status = rowStatus(row);

          metrics.push({
            projectSlug: target.projectSlug,
            provider: 'supabase',
            metricKey: row.metric_key,
            metricValue: row.metric_value ?? undefined,
            status,
            metadata: {
              ...row.metadata,
              projectRef: target.projectRef,
              rpcName: target.rpcName,
            },
            collectedAt,
          });

          if (row.resource_type && row.resource_name) {
            resources.push({
              projectSlug: target.projectSlug,
              provider: 'supabase',
              resourceType: row.resource_type,
              externalId: `${target.projectRef}:${row.resource_type}:${row.resource_name}`,
              displayName: row.resource_name,
              metadata: {
                projectRef: target.projectRef,
                rpcName: target.rpcName,
              },
            });
          }
        }

        if (rows.length === 0) {
          metrics.push({
            projectSlug: target.projectSlug,
            provider: 'supabase',
            metricKey: 'supabase_aggregate_rows',
            metricValue: 0,
            status: 'warning',
            metadata: {
              projectRef: target.projectRef,
              rpcName: target.rpcName,
            },
            collectedAt,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Supabase aggregate collection failed');

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'supabase',
          metricKey: 'supabase_aggregate_available',
          metricValue: 0,
          status: 'failed',
          metadata: {
            projectRef: target.projectRef,
            rpcName: target.rpcName,
          },
          collectedAt,
        });
        errors.push({
          projectSlug: target.projectSlug,
          message,
          retryable: true,
        });
      }
    }),
  );

  const failedTargets = errors.length;

  return {
    provider: 'supabase',
    adapterKey: aggregateAdapterKey(targets),
    status: deriveResultStatus(metrics, errors),
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No Supabase aggregate targets configured.'
        : `${targets.length - failedTargets}/${targets.length} Supabase aggregate targets collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createSupabaseAggregateAdapter(targets: SupabaseAggregateTarget[], options: SupabaseAggregateOptions): ProviderAdapter {
  return {
    provider: 'supabase',
    adapterKey: aggregateAdapterKey(targets),
    collect: () => collectSupabaseAggregateStatus(targets, options),
  };
}
