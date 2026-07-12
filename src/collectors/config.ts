import type { ProjectSlug } from '../types';

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
    resendDomain?: string;
    resendVerificationCategory?: string;
    githubRepository?: string;
    githubActionsEnabled?: boolean;
    healthCheckUrl?: string;
  };
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
  openAi?: {
    apiKeyLabels?: Record<string, string>;
    usageLookbackDays?: number;
  };
  githubActions?: {
    usageLookbackDays?: number;
    runLimit?: number;
  };
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
