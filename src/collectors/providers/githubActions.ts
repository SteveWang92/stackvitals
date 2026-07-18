import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface GitHubActionsTarget {
  projectSlug: ProjectSlug;
  owner: string;
  repo: string;
  // Workflow file name (e.g. "deploy-site.yml") whose latest run is reported as the
  // project's deploy status, for projects deployed via GitHub Actions instead of Amplify.
  deployWorkflow?: string;
}

export interface GitHubWorkflowRun {
  id: number;
  workflowId: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
  event: string;
  branch: string;
  runStartedAt: string | null;
  updatedAt: string | null;
}

export interface GitHubActionsClient {
  listWorkflowRuns: (input: { owner: string; repo: string; since: string; limit: number }) => Promise<GitHubWorkflowRun[]>;
  // Latest runs of one workflow file, newest first. Resolves null when the workflow
  // does not exist (or the token cannot see it), so misconfiguration is reportable.
  listWorkflowRunsForWorkflow: (input: { owner: string; repo: string; workflow: string; limit: number }) => Promise<GitHubWorkflowRun[] | null>;
}

export interface GitHubActionsOptions {
  client: GitHubActionsClient;
  now?: Date;
  lookbackDays?: number;
  runLimit?: number;
}

interface TargetCollection {
  target: GitHubActionsTarget;
  runs: GitHubWorkflowRun[];
  // undefined: no deploy workflow configured; null: configured but not found.
  deployRuns?: GitHubWorkflowRun[] | null;
}

const deployRunLimit = 5;

function lookbackStart(options: GitHubActionsOptions): string {
  const now = options.now ?? new Date();
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? 30));

  return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}

function runLimit(options: GitHubActionsOptions): number {
  return Math.min(100, Math.max(1, Math.floor(options.runLimit ?? 50)));
}

function repositoryName(target: GitHubActionsTarget): string {
  return `${target.owner}/${target.repo}`;
}

function conclusionStatus(run: GitHubWorkflowRun | undefined): StatusLevel {
  if (!run) {
    return 'unknown';
  }

  if (run.status !== 'completed') {
    return 'warning';
  }

  if (run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral') {
    return 'healthy';
  }

  return 'failed';
}

function isFailedRun(run: GitHubWorkflowRun): boolean {
  return run.status === 'completed' && Boolean(run.conclusion) && !['success', 'skipped', 'neutral'].includes(run.conclusion ?? '');
}

function durationSeconds(run: GitHubWorkflowRun): number {
  if (!run.runStartedAt || !run.updatedAt) {
    return 0;
  }

  const startedAt = Date.parse(run.runStartedAt);
  const updatedAt = Date.parse(run.updatedAt);

  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt) || updatedAt < startedAt) {
    return 0;
  }

  return Math.round((updatedAt - startedAt) / 1000);
}

function metric(
  target: GitHubActionsTarget,
  key: string,
  value: number | undefined,
  status: StatusLevel,
  metadata: Record<string, unknown>,
  collectedAt: string,
): CollectorMetric {
  return {
    projectSlug: target.projectSlug,
    provider: 'github',
    metricKey: key,
    metricValue: value,
    status,
    metadata: {
      repository: repositoryName(target),
      aggregateOnly: true,
      ...metadata,
    },
    collectedAt,
  };
}

function targetResources(collection: TargetCollection): CollectorResource[] {
  const workflows = new Map<number, GitHubWorkflowRun>();

  for (const run of collection.runs) {
    if (!workflows.has(run.workflowId)) {
      workflows.set(run.workflowId, run);
    }
  }

  return [
    {
      projectSlug: collection.target.projectSlug,
      provider: 'github',
      resourceType: 'repository',
      externalId: repositoryName(collection.target),
      displayName: repositoryName(collection.target),
      metadata: {
        aggregateOnly: true,
      },
    },
    ...Array.from(workflows.values()).map<CollectorResource>((run) => ({
      projectSlug: collection.target.projectSlug,
      provider: 'github',
      resourceType: 'workflow',
      externalId: `${repositoryName(collection.target)}:${run.workflowId}`,
      displayName: run.workflowName,
      metadata: {
        workflowId: run.workflowId,
        latestStatus: run.status,
        latestConclusion: run.conclusion,
        latestBranch: run.branch,
        latestEvent: run.event,
        latestRunStartedAt: run.runStartedAt,
        aggregateOnly: true,
      },
    })),
  ];
}

function targetMetrics(collection: TargetCollection, since: string, collectedAt: string): CollectorMetric[] {
  const runs = collection.runs;
  // Skip in-progress/queued runs (e.g. the collector's own workflow run while it is collecting) so the
  // reported "latest run" status reflects the most recent completed run instead of flickering to "warning".
  const latestRun = runs.find((run) => run.status === 'completed') ?? runs[0];
  const failedRuns = runs.filter(isFailedRun);
  const scheduledRuns = runs.filter((run) => run.event === 'schedule');
  const failedScheduledRuns = scheduledRuns.filter(isFailedRun);
  const totalDurationSeconds = runs.reduce((total, run) => total + durationSeconds(run), 0);
  const latestStatus = conclusionStatus(latestRun);
  const failureStatus: StatusLevel = latestStatus === 'failed' ? 'failed' : 'healthy';
  const scheduledStatus: StatusLevel = latestStatus === 'failed' && failedScheduledRuns.length > 0 ? 'failed' : 'healthy';

  return [
    metric(collection.target, 'github_actions_recent_run_count', runs.length, 'healthy', { since }, collectedAt),
    metric(collection.target, 'github_actions_recent_failure_count', failedRuns.length, failureStatus, { since }, collectedAt),
    metric(collection.target, 'github_actions_recent_duration_seconds', totalDurationSeconds, 'healthy', { since }, collectedAt),
    metric(
      collection.target,
      'github_actions_latest_run_status',
      latestRun ? 1 : undefined,
      latestStatus,
      {
        workflowId: latestRun?.workflowId,
        workflowName: latestRun?.workflowName,
        status: latestRun?.status,
        conclusion: latestRun?.conclusion,
        branch: latestRun?.branch,
        event: latestRun?.event,
        runStartedAt: latestRun?.runStartedAt,
        updatedAt: latestRun?.updatedAt,
      },
      collectedAt,
    ),
    metric(collection.target, 'github_actions_scheduled_run_count', scheduledRuns.length, scheduledStatus, { since }, collectedAt),
    metric(
      collection.target,
      'github_actions_scheduled_failure_count',
      failedScheduledRuns.length,
      scheduledStatus,
      { since },
      collectedAt,
    ),
    ...deployMetrics(collection, collectedAt),
  ];
}

// Projects deployed by a GitHub Actions workflow (e.g. GitHub Pages) report the latest run
// of that workflow as their deploy status, mirroring what Amplify metrics provide for
// Amplify-hosted projects.
function deployMetrics(collection: TargetCollection, collectedAt: string): CollectorMetric[] {
  const workflow = collection.target.deployWorkflow;

  if (!workflow || collection.deployRuns === undefined) {
    return [];
  }

  if (collection.deployRuns === null) {
    return [metric(collection.target, 'github_actions_deploy_status', 0, 'failed', { deployWorkflow: workflow }, collectedAt)];
  }

  const runs = collection.deployRuns;
  const latestRun = runs.find((run) => run.status === 'completed') ?? runs[0];

  return [
    metric(
      collection.target,
      'github_actions_deploy_status',
      latestRun ? 1 : undefined,
      conclusionStatus(latestRun),
      {
        deployWorkflow: workflow,
        workflowId: latestRun?.workflowId,
        workflowName: latestRun?.workflowName,
        status: latestRun?.status,
        conclusion: latestRun?.conclusion,
        branch: latestRun?.branch,
        event: latestRun?.event,
        runStartedAt: latestRun?.runStartedAt,
        updatedAt: latestRun?.updatedAt,
      },
      collectedAt,
    ),
  ];
}

export async function collectGitHubActionsUsage(
  targets: GitHubActionsTarget[],
  options: GitHubActionsOptions,
): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const collectedAt = new Date().toISOString();
  const since = lookbackStart(options);
  const limit = runLimit(options);
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      try {
        const runs = await options.client.listWorkflowRuns({ owner: target.owner, repo: target.repo, since, limit });

        let deployRuns: GitHubWorkflowRun[] | null | undefined;
        if (target.deployWorkflow) {
          try {
            deployRuns = await options.client.listWorkflowRunsForWorkflow({
              owner: target.owner,
              repo: target.repo,
              workflow: target.deployWorkflow,
              limit: deployRunLimit,
            });
            if (deployRuns === null) {
              errors.push({
                projectSlug: target.projectSlug,
                message: `Deploy workflow "${target.deployWorkflow}" not found in ${repositoryName(target)}.`,
                retryable: false,
              });
            }
          } catch (deployError) {
            deployRuns = null;
            errors.push({
              projectSlug: target.projectSlug,
              message: getErrorMessage(deployError, `Deploy workflow "${target.deployWorkflow}" collection failed`),
              retryable: true,
            });
          }
        }

        const collection = { target, runs, deployRuns };

        resources.push(...targetResources(collection));
        metrics.push(...targetMetrics(collection, since, collectedAt));
      } catch (error) {
        const message = getErrorMessage(error, 'GitHub Actions collection failed');

        metrics.push(
          metric(
            target,
            'github_actions_repository_available',
            0,
            'failed',
            {
              owner: target.owner,
              repo: target.repo,
            },
            collectedAt,
          ),
        );
        errors.push({
          projectSlug: target.projectSlug,
          message,
          retryable: true,
        });
      }
    }),
  );

  const status = deriveResultStatus(metrics, errors);

  return {
    provider: 'github',
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No GitHub Actions targets configured.'
        : `${targets.length - errors.length}/${targets.length} GitHub Actions repositories collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createGitHubActionsAdapter(targets: GitHubActionsTarget[], options: GitHubActionsOptions): ProviderAdapter {
  return {
    provider: 'github',
    collect: () => collectGitHubActionsUsage(targets, options),
  };
}
