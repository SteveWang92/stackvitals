import { access, appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { createAmplifyAdapter } from './providers/amplify';
import { createAwsAppBackendAdapter } from './providers/awsAppBackend';
import { createAwsCostExplorerAdapter } from './providers/awsCostExplorer';
import { createHttpHealthAdapter } from './providers/httpHealth';
import { createCloudflareDomainsAdapter } from './providers/cloudflare';
import { createCloudflarePagesAdapter } from './providers/cloudflarePages';
import { createGitHubActionsAdapter } from './providers/githubActions';
import { createOpenAiUsageAdapter } from './providers/openaiUsage';
import { createResendDomainHealthAdapter } from './providers/resend';
import { createSupabaseAggregateAdapter } from './providers/supabaseAggregate';
import { createSupabaseProjectHealthAdapter } from './providers/supabaseProjectHealth';
import { buildGithubStepSummary } from './githubStepSummary';
import { collectRunFailures, formatRunFailures } from './runFailures';
import { runCollectors } from './runCollectors';
import { createSupabaseCollectorRunRecorder } from './stores/supabaseCollectorRunRecorder';
import { getArgValue, resolveEnvPlaceholders, type CollectorConfig } from './config';
import { createLiveAmplifyClient, createLiveAwsAppBackendClient, createLiveCostExplorerClient } from './liveClients/aws';
import { createLiveResendClient } from './liveClients/resend';
import {
  createLiveSupabaseAggregateClient,
  createLiveSupabaseCollectorRunClient,
  createLiveSupabaseProjectHealthClient,
  createLiveSupabaseSnapshotPruneClient,
} from './liveClients/supabase';
import { formatPruneResults, parseRetentionDays, pruneSnapshots } from './stores/pruneSnapshots';
import type { ProviderAdapter } from './types';
import { createLiveCloudflareClient, createLiveCloudflarePagesClient } from './liveClients/cloudflare';
import { createLiveGitHubActionsClient } from './liveClients/github';
import { createLiveOpenAiUsageClient } from './liveClients/openai';

function loadLocalEnv(): void {
  const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }
}

function hasAwsCredentials(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function getHubSupabaseServiceRoleKey(): string | undefined {
  return process.env.HUB_SUPABASE_JWT_SERVICE_ROLE_KEY;
}

function isJwtKey(key: string | undefined): key is string {
  return Boolean(key && key.split('.').length === 3);
}

function githubActionsToken(): string | undefined {
  return process.env.GH_ACTIONS_TOKEN ?? process.env.GITHUB_TOKEN;
}

function githubRepositoryParts(repository: string): { owner: string; repo: string } | null {
  const [owner, repo, ...rest] = repository.split('/').map((part) => part.trim());

  if (!owner || !repo || rest.length > 0) {
    return null;
  }

  return { owner, repo };
}

async function readConfig(path: string): Promise<CollectorConfig> {
  const url = pathToFileURL(resolve(path));
  const parsed = JSON.parse(await readFile(url, 'utf8')) as CollectorConfig;

  return resolveEnvPlaceholders(parsed, process.env, path);
}

async function defaultConfigPath(): Promise<string> {
  try {
    await access(resolve('projects.config.json'));
    return 'projects.config.json';
  } catch {
    return 'projects.example.json';
  }
}

loadLocalEnv();

const configPath = getArgValue(process.argv, '--config') ?? (await defaultConfigPath());
const config = await readConfig(configPath);
// Parsed before any provider work so a bad retention value fails immediately instead of
// after a full round of API calls.
const retentionDays = parseRetentionDays(process.env.SNAPSHOT_RETENTION_DAYS);
const adapters: ProviderAdapter[] = [];

const httpTargets = config.projects
  .filter((project) => project.resources?.healthCheckUrl || project.publicUrl)
  .map((project) => ({
    projectSlug: project.slug,
    url: project.resources?.healthCheckUrl ?? project.publicUrl!,
  }));

adapters.push(
  createHttpHealthAdapter(httpTargets, {
    fetch,
    bypassHeaderName: process.env.HTTP_HEALTH_CHECK_HEADER_NAME,
    bypassHeaderValue: process.env.HTTP_HEALTH_CHECK_HEADER_VALUE,
  }),
);

if (hasAwsCredentials()) {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const amplifyTargets = config.projects
    .filter((project) => project.resources?.amplifyAppId && project.resources?.amplifyBranchName)
    .map((project) => ({
      projectSlug: project.slug,
      appId: project.resources!.amplifyAppId!,
      branchName: project.resources!.amplifyBranchName!,
    }));

  adapters.push(createAmplifyAdapter(amplifyTargets, { client: createLiveAmplifyClient(region) }));
  adapters.push(createAwsCostExplorerAdapter({ client: createLiveCostExplorerClient(region) }));

  // Apps whose auth/data backend is Cognito + DynamoDB rather than a managed platform. A
  // project opts in by naming either resource; the shared AWS credentials need read-only
  // cognito-idp:DescribeUserPool / dynamodb:DescribeTable on those ARNs.
  const awsBackendTargets = config.projects
    .filter((project) => project.resources?.cognitoUserPoolId || (project.resources?.dynamoDbTables?.length ?? 0) > 0)
    .map((project) => ({
      projectSlug: project.slug,
      region: project.resources!.awsBackendRegion ?? region,
      cognitoUserPoolId: project.resources!.cognitoUserPoolId,
      dynamoDbTables: project.resources!.dynamoDbTables ?? [],
    }));

  if (awsBackendTargets.length > 0) {
    adapters.push(createAwsAppBackendAdapter(awsBackendTargets, { client: createLiveAwsAppBackendClient() }));
  }
}

const hubSupabaseServiceRoleKey = getHubSupabaseServiceRoleKey();
const hubSupabaseReadKey = process.env.VITE_SUPABASE_ANON_KEY;

if (process.env.VITE_SUPABASE_URL && hubSupabaseReadKey) {
  const hubSupabaseProject = config.projects.find((project) => project.resources?.hubSupabase && project.resources?.supabaseProjectRef);

  if (hubSupabaseProject?.resources?.supabaseProjectRef) {
    // The REST root probe requires a secret-tier key (service-role JWT); publishable/anon
    // keys get a 401 "Secret API key required" from Supabase's newer key system.
    const healthCheckKey = isJwtKey(hubSupabaseServiceRoleKey) ? hubSupabaseServiceRoleKey : hubSupabaseReadKey;

    adapters.push(
      createSupabaseProjectHealthAdapter(
        [
          {
            projectSlug: hubSupabaseProject.slug,
            projectRef: hubSupabaseProject.resources.supabaseProjectRef,
            projectUrl: process.env.VITE_SUPABASE_URL,
          },
        ],
        { client: createLiveSupabaseProjectHealthClient(healthCheckKey, healthCheckKey) },
      ),
    );
  }
}

// Each watched app declares its own Supabase aggregate credentials in the collector
// config (as `${ENV_VAR}` placeholders), so every project gets a client scoped to its
// own Supabase instance.
for (const project of config.projects) {
  const resources = project.resources;

  if (
    !resources?.supabaseProjectRef ||
    !resources.supabaseAggregateRpcName ||
    !resources.supabaseUrl ||
    !resources.supabaseServiceRoleKey
  ) {
    continue;
  }

  adapters.push(
    createSupabaseAggregateAdapter(
      [
        {
          projectSlug: project.slug,
          projectRef: resources.supabaseProjectRef,
          rpcName: resources.supabaseAggregateRpcName,
        },
      ],
      { client: createLiveSupabaseAggregateClient(resources.supabaseUrl, resources.supabaseServiceRoleKey, resources.supabaseAnonKey) },
    ),
  );
}

if (process.env.RESEND_API_KEY) {
  const resendTargets = config.projects
    .filter((project) => project.resources?.resendDomain)
    .map((project) => ({
      projectSlug: project.slug,
      domain: project.resources!.resendDomain!,
    }));

  adapters.push(createResendDomainHealthAdapter(resendTargets, { client: createLiveResendClient(process.env.RESEND_API_KEY) }));
}

if (process.env.CLOUDFLARE_API_TOKEN) {
  const cloudflareTargets = (config.domains ?? []).flatMap((group) => {
    if (group.provider !== 'cloudflare') {
      console.warn(
        `Skipping domain group for ${group.projectSlug ?? 'unallocated'}: provider "${String(group.provider)}" is not supported (only cloudflare).`,
      );
      return [];
    }

    return group.domains.map((domain) => ({
      projectSlug: group.projectSlug,
      domain,
    }));
  });

  adapters.push(
    createCloudflareDomainsAdapter(cloudflareTargets, {
      client: createLiveCloudflareClient(process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID),
    }),
  );

  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    const pagesTargets = config.projects
      .filter((project) => project.resources?.cloudflarePagesProject)
      .map((project) => ({
        projectSlug: project.slug,
        projectName: project.resources!.cloudflarePagesProject!,
      }));

    if (pagesTargets.length > 0) {
      adapters.push(
        createCloudflarePagesAdapter(pagesTargets, {
          client: createLiveCloudflarePagesClient(process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID),
        }),
      );
    }
  }
}

if (process.env.OPENAI_ADMIN_API_KEY) {
  adapters.push(
    createOpenAiUsageAdapter({
      client: createLiveOpenAiUsageClient(process.env.OPENAI_ADMIN_API_KEY),
      apiKeyLabels: config.openAi?.apiKeyLabels,
      lookbackDays: config.openAi?.usageLookbackDays,
    }),
  );
}

const githubToken = githubActionsToken();

if (githubToken) {
  const githubTargets = config.projects.flatMap((project) => {
    const repository = project.resources?.githubRepository;

    if (!repository || project.resources?.githubActionsEnabled === false) {
      return [];
    }

    const parts = githubRepositoryParts(repository);

    if (!parts) {
      console.warn(`Skipping invalid GitHub repository mapping for ${project.slug}: expected owner/repo.`);
      return [];
    }

    return [
      {
        projectSlug: project.slug,
        owner: parts.owner,
        repo: parts.repo,
        deployWorkflow: project.resources?.githubDeployWorkflow,
      },
    ];
  });

  adapters.push(
    createGitHubActionsAdapter(githubTargets, {
      client: createLiveGitHubActionsClient(githubToken),
      lookbackDays: config.githubActions?.usageLookbackDays,
      runLimit: config.githubActions?.runLimit,
    }),
  );
}

const recorder =
  process.env.VITE_SUPABASE_URL && isJwtKey(hubSupabaseServiceRoleKey)
    ? createSupabaseCollectorRunRecorder(
        createLiveSupabaseCollectorRunClient(process.env.VITE_SUPABASE_URL, hubSupabaseServiceRoleKey, process.env.VITE_SUPABASE_ANON_KEY),
      )
    : undefined;

if (process.env.VITE_SUPABASE_URL && hubSupabaseServiceRoleKey && !isJwtKey(hubSupabaseServiceRoleKey)) {
  console.warn('Collector result recording skipped: configure HUB_SUPABASE_JWT_SERVICE_ROLE_KEY with a JWT-style service-role key.');
}

const summary = await runCollectors(adapters, { recorder });

console.log(
  JSON.stringify(
    {
      status: summary.status,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      providers: summary.results.map((result) => ({
        provider: result.provider,
        status: result.status,
        summary: result.summary,
        resources: result.resources.length,
        metrics: result.metrics.length,
        costs: result.costs.length,
        healthChecks: result.healthChecks.length,
        errors: result.errors.map((error) => ({
          projectSlug: error.projectSlug,
          message: error.message,
          retryable: error.retryable,
        })),
        degradedHealthChecks: result.healthChecks
          .filter((check) => check.status !== 'healthy')
          .map((check) => ({
            projectSlug: check.projectSlug,
            url: check.url,
            status: check.status,
            httpStatus: check.httpStatus,
          })),
        // Warning/failed metrics are why a metric-based provider (Cloudflare, GitHub
        // Actions) reports partial_success without any errors; surface them so the reason
        // is visible in the run output instead of only in the recorded snapshots.
        degradedMetrics: result.metrics
          .filter((metric) => metric.status === 'warning' || metric.status === 'failed')
          .map((metric) => ({
            projectSlug: metric.projectSlug,
            metricKey: metric.metricKey,
            status: metric.status,
            domain: metric.metadata?.domain,
          })),
      })),
    },
    null,
    2,
  ),
);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, buildGithubStepSummary(summary));
}

// Retention runs after the write, and only when this run could write at all — pruning from a
// collector that just failed to record anything would trim history while adding none. A prune
// failure is logged rather than thrown: the run's collected data is already safely stored, and
// storage housekeeping is not worth turning a good run into a failed one.
if (process.env.VITE_SUPABASE_URL && isJwtKey(hubSupabaseServiceRoleKey)) {
  try {
    const pruneClient = createLiveSupabaseSnapshotPruneClient(
      process.env.VITE_SUPABASE_URL,
      hubSupabaseServiceRoleKey,
      process.env.VITE_SUPABASE_ANON_KEY,
    );

    console.log(formatPruneResults(await pruneSnapshots(pruneClient, { retentionDays }), retentionDays));
  } catch (error) {
    console.warn(`Snapshot retention skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

// Alerting is the scheduled workflow's own failure notification: GitHub emails the owner
// when a cron run fails, so a non-zero exit is the whole delivery mechanism — no webhook,
// no always-on service. Snapshots are already recorded by this point, so failing here
// costs no data.
const failures = collectRunFailures(summary);

if (failures.length > 0) {
  console.error(formatRunFailures(failures));
  process.exitCode = 1;
}
