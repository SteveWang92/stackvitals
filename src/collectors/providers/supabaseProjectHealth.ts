import type { ProjectSlug } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface SupabaseProjectHealthTarget {
  projectSlug: ProjectSlug;
  projectRef: string;
  projectUrl: string;
}

export interface SupabaseProjectHealthClient {
  checkRestHealth: (projectUrl: string) => Promise<{ ok: boolean; detail: string }>;
}

export interface SupabaseProjectHealthOptions {
  client: SupabaseProjectHealthClient;
}

// Several adapters share the 'supabase' provider key; the adapter key keeps their
// collector runs distinguishable in the run history.
const adapterKey = 'supabase_project_health';

export async function collectSupabaseProjectHealth(
  targets: SupabaseProjectHealthTarget[],
  options: SupabaseProjectHealthOptions,
): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      resources.push({
        projectSlug: target.projectSlug,
        provider: 'supabase',
        resourceType: 'project',
        externalId: target.projectRef,
        displayName: target.projectRef,
        metadata: {
          projectUrl: target.projectUrl,
        },
      });

      try {
        const result = await options.client.checkRestHealth(target.projectUrl);

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'supabase',
          metricKey: 'supabase_rest_available',
          metricValue: result.ok ? 1 : 0,
          status: result.ok ? 'healthy' : 'failed',
          metadata: {
            projectRef: target.projectRef,
            detail: result.detail,
          },
          collectedAt,
        });

        if (!result.ok) {
          errors.push({
            projectSlug: target.projectSlug,
            message: result.detail,
            retryable: true,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Supabase project health collection failed');

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'supabase',
          metricKey: 'supabase_rest_available',
          metricValue: 0,
          status: 'failed',
          metadata: {
            projectRef: target.projectRef,
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
    adapterKey,
    status: deriveResultStatus(metrics, errors),
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No Supabase project health targets configured.'
        : `${targets.length - failedTargets}/${targets.length} Supabase project health targets collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createSupabaseProjectHealthAdapter(
  targets: SupabaseProjectHealthTarget[],
  options: SupabaseProjectHealthOptions,
): ProviderAdapter {
  return {
    provider: 'supabase',
    adapterKey,
    collect: () => collectSupabaseProjectHealth(targets, options),
  };
}
