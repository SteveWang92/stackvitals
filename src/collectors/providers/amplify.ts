import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface AmplifyTarget {
  projectSlug: ProjectSlug;
  appId: string;
  branchName: string;
}

export interface AmplifyApp {
  appId: string;
  name: string;
  defaultDomain?: string;
  repository?: string;
  updateTime?: string;
}

export interface AmplifyBranch {
  branchName: string;
  stage?: string;
  displayName?: string;
  enableAutoBuild?: boolean;
  updateTime?: string;
}

export interface AmplifyClient {
  getApp: (input: { appId: string }) => Promise<{ app: AmplifyApp }>;
  getBranch: (input: { appId: string; branchName: string }) => Promise<{ branch: AmplifyBranch }>;
}

export interface AmplifyOptions {
  client: AmplifyClient;
}

function branchStatus(branch: AmplifyBranch): StatusLevel {
  return branch.stage?.toUpperCase() === 'DEVELOPMENT' ? 'warning' : 'healthy';
}

export async function collectAmplifyStatus(targets: AmplifyTarget[], options: AmplifyOptions): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      try {
        const [{ app }, { branch }] = await Promise.all([
          options.client.getApp({ appId: target.appId }),
          options.client.getBranch({ appId: target.appId, branchName: target.branchName }),
        ]);
        const branchLevel = branchStatus(branch);

        resources.push(
          {
            projectSlug: target.projectSlug,
            provider: 'amplify',
            resourceType: 'app',
            externalId: app.appId,
            displayName: app.name,
            metadata: {
              defaultDomain: app.defaultDomain,
              hasRepository: Boolean(app.repository),
              updateTime: app.updateTime,
            },
          },
          {
            projectSlug: target.projectSlug,
            provider: 'amplify',
            resourceType: 'branch',
            externalId: `${app.appId}:${branch.branchName}`,
            displayName: branch.displayName ?? branch.branchName,
            metadata: {
              appId: app.appId,
              stage: branch.stage,
              enableAutoBuild: branch.enableAutoBuild,
              updateTime: branch.updateTime,
            },
          },
        );

        metrics.push(
          {
            projectSlug: target.projectSlug,
            provider: 'amplify',
            metricKey: 'amplify_app_available',
            metricValue: 1,
            status: 'healthy',
            metadata: {
              appId: app.appId,
              appName: app.name,
            },
            collectedAt,
          },
          {
            projectSlug: target.projectSlug,
            provider: 'amplify',
            metricKey: 'amplify_branch_available',
            metricValue: 1,
            status: branchLevel,
            metadata: {
              appId: app.appId,
              branchName: branch.branchName,
              stage: branch.stage,
            },
            collectedAt,
          },
        );
      } catch (error) {
        const message = getErrorMessage(error, 'Amplify collection failed');

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'amplify',
          metricKey: 'amplify_target_available',
          metricValue: 0,
          status: 'failed',
          metadata: {
            appId: target.appId,
            branchName: target.branchName,
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
  const status = deriveResultStatus(metrics, errors);

  return {
    provider: 'amplify',
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No Amplify targets configured.'
        : `${targets.length - failedTargets}/${targets.length} Amplify targets collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createAmplifyAdapter(targets: AmplifyTarget[], options: AmplifyOptions): ProviderAdapter {
  return {
    provider: 'amplify',
    collect: () => collectAmplifyStatus(targets, options),
  };
}
