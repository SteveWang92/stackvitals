import type { ProjectSlug, ProviderKey } from '../types';

export interface ProjectCollectorConfig {
  slug: ProjectSlug;
  name: string;
  publicUrl?: string;
  resources?: {
    amplifyAppId?: string;
    amplifyBranchName?: string;
    supabaseProjectRef?: string;
    supabaseAggregateRpcName?: string;
    // Credentials for the watched app's own Supabase project (aggregate RPC calls only).
    // Use `${ENV_VAR}` placeholders here so the config never holds secret values.
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
    supabaseAnonKey?: string;
    // Marks the project that IS this dashboard, so its hub Supabase health is probed.
    hubSupabase?: boolean;
    // Auth/data backend built from AWS primitives instead of a managed platform. Collected
    // with `Describe*` calls only (aggregate pool/table metadata, never records), and the
    // region defaults to AWS_REGION when omitted since a backend often lives in a different
    // region from the Amplify app that fronts it.
    awsBackendRegion?: string;
    cognitoUserPoolId?: string;
    dynamoDbTables?: string[];
    resendDomain?: string;
    githubRepository?: string;
    githubActionsEnabled?: boolean;
    // Workflow file name (e.g. "deploy-site.yml") whose latest run is the project's deploy
    // status, for projects deployed via GitHub Actions (e.g. GitHub Pages) instead of
    // Amplify. Requires githubRepository and GitHub Actions collection to be enabled.
    githubDeployWorkflow?: string;
    // Cloudflare Pages project name whose latest production deployment is the project's
    // deploy status. Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
    cloudflarePagesProject?: string;
    healthCheckUrl?: string;
    // Keep a deployment-origin redirect as the health signal instead of following it to a
    // custom domain. This is useful when the custom domain is protected by a WAF.
    healthCheckFollowRedirects?: boolean;
  };
}

export interface ConfiguredProjectInventory {
  slug: ProjectSlug;
  name: string;
  publicUrl: string | null;
  providers: ProviderKey[];
}

export interface DomainGroupConfig {
  provider: 'cloudflare';
  // Owning project for the domains. Omit to leave the group unallocated (`project_id` null),
  // for domains shared across several projects — they still appear on the Domains tab but are
  // not attributed to any single project on the Detail tab.
  projectSlug?: ProjectSlug;
  domains: string[];
}

export interface CollectorConfig {
  projects: ProjectCollectorConfig[];
  domains?: DomainGroupConfig[];
  aws?: {
    // Kept enabled by default for compatibility with existing collector configs. Set false
    // when AWS credentials are intentionally scoped only to Amplify or app-backend reads.
    costExplorerEnabled?: boolean;
  };
  openAi?: {
    apiKeyLabels?: Record<string, string>;
    usageLookbackDays?: number;
  };
  githubActions?: {
    usageLookbackDays?: number;
    runLimit?: number;
  };
}

export function isAwsCostExplorerEnabled(config: CollectorConfig): boolean {
  return config.aws?.costExplorerEnabled !== false;
}

export function configuredProjectInventory(config: CollectorConfig): ConfiguredProjectInventory[] {
  const cloudflareProjects = new Set((config.domains ?? []).flatMap((group) => (group.projectSlug ? [group.projectSlug] : [])));

  return config.projects.map((project) => {
    const resources = project.resources;
    const providers = new Set<ProviderKey>();

    if (resources?.healthCheckUrl || project.publicUrl) providers.add('http');
    if (resources?.amplifyAppId && resources.amplifyBranchName) providers.add('amplify');
    if (resources?.cognitoUserPoolId || (resources?.dynamoDbTables?.length ?? 0) > 0) providers.add('aws');
    if (
      resources?.supabaseProjectRef &&
      (resources.hubSupabase || (resources.supabaseAggregateRpcName && resources.supabaseUrl && resources.supabaseServiceRoleKey))
    ) {
      providers.add('supabase');
    }
    if (resources?.resendDomain) providers.add('resend');
    if (resources?.githubRepository && resources.githubActionsEnabled !== false) providers.add('github');
    if (resources?.cloudflarePagesProject || cloudflareProjects.has(project.slug)) providers.add('cloudflare');

    return {
      slug: project.slug,
      name: project.name,
      publicUrl: project.publicUrl ?? null,
      providers: Array.from(providers).sort(),
    };
  });
}

const placeholderPattern = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function resolveString(value: string, env: Record<string, string | undefined>, path: string): string {
  return value.replace(placeholderPattern, (match, name: string | undefined) => {
    if (match === '$$') {
      return '$';
    }

    const resolved = env[name!];

    if (resolved === undefined) {
      throw new Error(`Missing environment variable "${name}" referenced by \${${name}} at ${path}.`);
    }

    return resolved;
  });
}

/**
 * Resolves `${ENV_VAR}` placeholders in every string value of a parsed collector config.
 * `$$` escapes a literal `$`. Throws when a referenced variable is not set, naming the
 * variable and the config path so misconfigured secrets fail loudly instead of silently
 * skipping a collector.
 */
export function resolveEnvPlaceholders<T>(value: T, env: Record<string, string | undefined>, path = 'config'): T {
  if (typeof value === 'string') {
    return resolveString(value, env, path) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => resolveEnvPlaceholders(item, env, `${path}[${index}]`)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnvPlaceholders(item, env, `${path}.${key}`)])) as T;
  }

  return value;
}

export function getArgValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}
