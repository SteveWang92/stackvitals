import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface CloudflarePagesTarget {
  projectSlug: ProjectSlug;
  projectName: string;
}

export interface CloudflarePagesDeployment {
  id: string;
  url: string | null;
  environment: string;
  latestStage: {
    name: string;
    status: string;
  };
  createdOn: string;
  modifiedOn: string;
  branch: string | null;
  commitMessage: string | null;
}

export interface CloudflarePagesClient {
  getLatestProductionDeployment: (projectName: string) => Promise<CloudflarePagesDeployment | null>;
}

export interface CloudflarePagesOptions {
  client: CloudflarePagesClient;
}

function stageStatusLevel(status: string): StatusLevel {
  switch (status) {
    case 'success':
      return 'healthy';
    case 'failure':
      return 'failed';
    case 'active':
      return 'warning';
    case 'canceled':
      return 'failed';
    default:
      return 'unknown';
  }
}

export async function collectCloudflarePages(
  targets: CloudflarePagesTarget[],
  options: CloudflarePagesOptions,
): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      try {
        const deployment = await options.client.getLatestProductionDeployment(target.projectName);

        resources.push({
          projectSlug: target.projectSlug,
          provider: 'cloudflare',
          resourceType: 'pages_project',
          externalId: target.projectName,
          displayName: target.projectName,
          metadata: { aggregateOnly: true },
        });

        if (deployment) {
          const status = stageStatusLevel(deployment.latestStage.status);

          metrics.push({
            projectSlug: target.projectSlug,
            provider: 'cloudflare',
            metricKey: 'cloudflare_pages_deploy_status',
            metricValue: 1,
            status,
            metadata: {
              deploymentId: deployment.id,
              url: deployment.url,
              stageName: deployment.latestStage.name,
              stageStatus: deployment.latestStage.status,
              branch: deployment.branch,
              commitMessage: deployment.commitMessage,
            },
            collectedAt,
          });
        } else {
          metrics.push({
            projectSlug: target.projectSlug,
            provider: 'cloudflare',
            metricKey: 'cloudflare_pages_deploy_status',
            metricValue: undefined,
            status: 'unknown',
            metadata: { reason: 'no_production_deployments' },
            collectedAt,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Cloudflare Pages collection failed');

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'cloudflare',
          metricKey: 'cloudflare_pages_deploy_status',
          metricValue: 0,
          status: 'failed',
          metadata: {},
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

  return {
    provider: 'cloudflare',
    adapterKey: 'cloudflare_pages',
    status: deriveResultStatus(metrics, errors),
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No Cloudflare Pages projects configured.'
        : `${targets.length - errors.length}/${targets.length} Cloudflare Pages projects collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createCloudflarePagesAdapter(targets: CloudflarePagesTarget[], options: CloudflarePagesOptions): ProviderAdapter {
  return {
    provider: 'cloudflare',
    adapterKey: 'cloudflare_pages',
    collect: () => collectCloudflarePages(targets, options),
  };
}
