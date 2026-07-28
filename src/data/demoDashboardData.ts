import { HISTORY_WINDOW_DAYS, utcDayRange } from '../services/dashboardData';
import type { DashboardData } from '../services/dashboardData';
import type { CostPoint, ProjectHistory, ProjectStatus, TrendPoint } from '../types';

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Deterministic jitter. The demo build feeds stackvitals.app and the committed screenshots, so
 * this must never use Math.random() — the same day must always render the same chart.
 */
function jitter(index: number, seed: number): number {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

/**
 * Fictional 30-day history. `degradedDay` and `gapDay` are indexes into the window (0 = oldest)
 * so the demo can show all four uptime states — without them the strip is 30 identical green
 * cells and the feature reads as decoration.
 */
function demoHistory(baseMs: number, options: { degradedDay?: number; gapDay?: number } = {}): ProjectHistory {
  const days = utcDayRange(HISTORY_WINDOW_DAYS);

  return {
    windowDays: HISTORY_WINDOW_DAYS,
    latency: days.map((day, index) => {
      if (index === options.gapDay) {
        return { day, p50Ms: null };
      }

      const spread = 0.82 + jitter(index, baseMs) * 0.36;

      return { day, p50Ms: Math.round(baseMs * (index === options.degradedDay ? spread * 3.4 : spread)) };
    }),
    uptime: days.map((day, index) => {
      if (index === options.gapDay) {
        return { day, state: 'no-data' as const, checks: 0, failed: 0 };
      }

      if (index === options.degradedDay) {
        return { day, state: 'degraded' as const, checks: 2, failed: 1 };
      }

      return { day, state: 'up' as const, checks: 1, failed: 0 };
    }),
  };
}

/**
 * Cumulative month-to-date spend, one point per collection day, ending exactly at the MTD total.
 * Built by accumulating uneven daily amounts rather than a smooth curve: the Costs tab charts the
 * day-over-day rise, and a smooth curve would flatten into a straight line there.
 */
function demoMtdCostSeries(total: number): CostPoint[] {
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const weights = Array.from({ length: dayOfMonth }, (_, index) => 0.55 + jitter(index, total) * 0.95);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let running = 0;

  return weights.map((weight, index) => {
    running += (total * weight) / weightTotal;

    return {
      day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1)).toISOString().slice(0, 10),
      cumulativeUsd: Number(running.toFixed(2)),
    };
  });
}

/**
 * A usage trend that climbs to `latest` on the newest day, so the chart and the summary tile above
 * it agree. `gapDay` is an index into the window (0 = oldest) and models a day the collector never
 * ran, which the chart must render as a break rather than a drop to zero.
 */
function demoTrendSeries(days: number, latest: number, seed: number, gapDay?: number): TrendPoint[] {
  const shape = Array.from({ length: days }, (_, index) => 0.58 + (index / days) * 0.42 + jitter(index, seed) * 0.14);
  const scale = latest / shape[days - 1];

  return utcDayRange(days).map((day, index) => ({
    day,
    value: index === gapDay ? null : Number((shape[index] * scale).toFixed(2)),
  }));
}

const acmeSite: ProjectStatus = {
  slug: 'acme_site',
  name: 'Acme Site',
  publicUrl: 'https://acme.example.dev',
  deployStatus: 'healthy',
  uptimeStatus: 'healthy',
  lastSync: hoursAgo(3),
  providers: [
    {
      provider: 'amplify',
      label: 'Amplify',
      status: 'healthy',
      detail: 'Branch main deployed 3 hours ago (build #214).',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'supabase',
      label: 'Supabase',
      status: 'healthy',
      detail: 'Database reachable, 12 active connections.',
      // Deliberately overdue: shows a last-known-healthy provider that stopped reporting, which
      // is the case the freshness badge exists for. Status stays healthy; only the badge warns.
      lastSync: hoursAgo(52),
      freshness: 'stale',
    },
    {
      provider: 'resend',
      label: 'Resend',
      status: 'warning',
      detail: 'Monthly email quota at 82% (2,460 of 3,000 sends).',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'http',
      label: 'HTTP Health',
      status: 'healthy',
      detail: 'Public URL returned 200 in 184 ms.',
      lastSync: hoursAgo(1),
      freshness: 'fresh',
    },
  ],
  costs: [
    { provider: 'openai', serviceName: 'OpenAI API', monthToDateUsd: 3.1 },
    { provider: 'amplify', serviceName: 'AWS Amplify hosting', monthToDateUsd: 1.42 },
    { provider: 'resend', serviceName: 'Resend email', monthToDateUsd: 0 },
  ],
  resources: [
    {
      id: 'demo-res-1',
      provider: 'amplify',
      type: 'amplify_app',
      name: 'acme-site',
      status: 'healthy',
      detail: 'main branch, auto build enabled',
    },
    {
      id: 'demo-res-2',
      provider: 'supabase',
      type: 'supabase_project',
      name: 'acme-site-db',
      status: 'healthy',
      detail: 'Free tier, ap-southeast-2',
    },
  ],
  recentSnapshots: [
    { label: 'Deploy status', provider: 'amplify', status: 'healthy', value: 'SUCCEED (build #214)', collectedAt: hoursAgo(3) },
    { label: 'HTTP latency', provider: 'http', status: 'healthy', value: '184 ms', collectedAt: hoursAgo(1) },
    { label: 'Email quota', provider: 'resend', status: 'warning', value: '82% of monthly quota', collectedAt: hoursAgo(3) },
  ],
  collectorErrors: [],
  history: demoHistory(184),
};

const todoApp: ProjectStatus = {
  slug: 'todo_app',
  name: 'Todo App',
  publicUrl: 'https://todo.example.dev',
  deployStatus: 'healthy',
  uptimeStatus: 'healthy',
  lastSync: hoursAgo(3),
  providers: [
    {
      provider: 'amplify',
      label: 'Amplify',
      status: 'healthy',
      detail: 'Branch main deployed yesterday (build #98).',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'supabase',
      label: 'Supabase',
      status: 'healthy',
      detail: '1,284 aggregate records, RPC checks passing.',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'http',
      label: 'HTTP Health',
      status: 'healthy',
      detail: 'Public URL returned 200 in 231 ms.',
      lastSync: hoursAgo(1),
      freshness: 'fresh',
    },
  ],
  costs: [
    { provider: 'openai', serviceName: 'OpenAI API', monthToDateUsd: 1.35 },
    { provider: 'amplify', serviceName: 'AWS Amplify hosting', monthToDateUsd: 0.96 },
  ],
  resources: [
    {
      id: 'demo-res-3',
      provider: 'amplify',
      type: 'amplify_app',
      name: 'todo-app',
      status: 'healthy',
      detail: 'main branch, auto build enabled',
    },
    {
      id: 'demo-res-4',
      provider: 'supabase',
      type: 'supabase_project',
      name: 'todo-app-db',
      status: 'healthy',
      detail: 'Free tier, ap-southeast-2',
    },
  ],
  recentSnapshots: [
    { label: 'Deploy status', provider: 'amplify', status: 'healthy', value: 'SUCCEED (build #98)', collectedAt: hoursAgo(3) },
    { label: 'Aggregate rows', provider: 'supabase', status: 'healthy', value: '1,284 records', collectedAt: hoursAgo(3) },
    { label: 'HTTP latency', provider: 'http', status: 'healthy', value: '231 ms', collectedAt: hoursAgo(1) },
  ],
  collectorErrors: [],
  history: demoHistory(231, { degradedDay: 12 }),
};

const recipeBox: ProjectStatus = {
  slug: 'recipe_box',
  name: 'Recipe Box',
  publicUrl: 'https://recipes.example.dev',
  deployStatus: 'healthy',
  uptimeStatus: 'warning',
  lastSync: hoursAgo(3),
  providers: [
    {
      provider: 'amplify',
      label: 'Amplify',
      status: 'healthy',
      detail: 'Branch main deployed 2 days ago (build #61).',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'supabase',
      label: 'Supabase',
      status: 'healthy',
      detail: 'Database reachable, storage at 14% of quota.',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'http',
      label: 'HTTP Health',
      status: 'warning',
      detail: 'Public URL returned 200 in 1,940 ms (slow response).',
      lastSync: hoursAgo(1),
      freshness: 'fresh',
    },
  ],
  costs: [{ provider: 'amplify', serviceName: 'AWS Amplify hosting', monthToDateUsd: 0.61 }],
  resources: [
    {
      id: 'demo-res-5',
      provider: 'amplify',
      type: 'amplify_app',
      name: 'recipe-box',
      status: 'healthy',
      detail: 'main branch, auto build enabled',
    },
    {
      id: 'demo-res-6',
      provider: 'supabase',
      type: 'supabase_project',
      name: 'recipe-box-db',
      status: 'healthy',
      detail: 'Free tier, ap-southeast-2',
    },
  ],
  recentSnapshots: [
    { label: 'Deploy status', provider: 'amplify', status: 'healthy', value: 'SUCCEED (build #61)', collectedAt: hoursAgo(3) },
    { label: 'HTTP latency', provider: 'http', status: 'warning', value: '1,940 ms', collectedAt: hoursAgo(1) },
  ],
  collectorErrors: [{ provider: 'http', message: 'Response time exceeded the 1,500 ms warning threshold.', occurredAt: hoursAgo(1) }],
  history: demoHistory(640, { degradedDay: 29 }),
};

const statusHub: ProjectStatus = {
  slug: 'status_hub',
  name: 'Status Hub',
  publicUrl: 'https://status.example.dev',
  deployStatus: 'healthy',
  uptimeStatus: 'healthy',
  lastSync: hoursAgo(3),
  providers: [
    {
      provider: 'amplify',
      label: 'Amplify',
      status: 'healthy',
      detail: 'Branch main deployed 5 hours ago (build #142).',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'supabase',
      label: 'Supabase',
      status: 'healthy',
      detail: 'Hub database reachable, snapshots writing normally.',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'github',
      label: 'GitHub Actions',
      status: 'healthy',
      detail: 'Scheduled collector workflow passing on main.',
      lastSync: hoursAgo(3),
      freshness: 'fresh',
    },
    {
      provider: 'http',
      label: 'HTTP Health',
      status: 'healthy',
      detail: 'Public URL returned 200 in 152 ms.',
      lastSync: hoursAgo(1),
      freshness: 'fresh',
    },
  ],
  costs: [{ provider: 'amplify', serviceName: 'AWS Amplify hosting', monthToDateUsd: 0.84 }],
  resources: [
    {
      id: 'demo-res-7',
      provider: 'amplify',
      type: 'amplify_app',
      name: 'status-hub',
      status: 'healthy',
      detail: 'main branch, auto build enabled',
    },
    {
      id: 'demo-res-8',
      provider: 'supabase',
      type: 'supabase_project',
      name: 'status-hub-db',
      status: 'healthy',
      detail: 'Free tier, ap-southeast-2',
    },
  ],
  recentSnapshots: [
    { label: 'Deploy status', provider: 'amplify', status: 'healthy', value: 'SUCCEED (build #142)', collectedAt: hoursAgo(3) },
    { label: 'Collector workflow', provider: 'github', status: 'healthy', value: 'success (daily cron)', collectedAt: hoursAgo(3) },
    { label: 'HTTP latency', provider: 'http', status: 'healthy', value: '152 ms', collectedAt: hoursAgo(1) },
  ],
  collectorErrors: [],
  history: demoHistory(152, { gapDay: 18 }),
};

export const demoDashboardData: DashboardData = {
  projects: [recipeBox, acmeSite, statusHub, todoApp],
  domains: [
    {
      domain: 'example.dev',
      status: 'healthy',
      zoneStatus: 'active',
      registrar: 'Cloudflare',
      expiresAt: daysFromNow(284),
      expirationDays: 284,
      autoRenew: true,
      locked: true,
      dnsRecordCount: 9,
      proxiedRecordCount: 6,
      mxRecordCount: 2,
      apexRecordPresent: true,
      wwwRecordPresent: true,
      lastSync: hoursAgo(3),
      dnsRecords: [
        { type: 'A', name: 'example.dev', proxied: true },
        { type: 'CNAME', name: 'www.example.dev', proxied: true },
        { type: 'CNAME', name: 'acme.example.dev', proxied: true },
        { type: 'CNAME', name: 'todo.example.dev', proxied: true },
        { type: 'CNAME', name: 'recipes.example.dev', proxied: true },
        { type: 'CNAME', name: 'status.example.dev', proxied: true },
        { type: 'MX', name: 'example.dev', proxied: false },
        { type: 'MX', name: 'example.dev', proxied: false },
        { type: 'TXT', name: 'example.dev', proxied: false },
      ],
    },
    {
      domain: 'example-labs.com',
      status: 'warning',
      zoneStatus: 'active',
      registrar: 'GoDaddy',
      expiresAt: daysFromNow(24),
      expirationDays: 24,
      autoRenew: false,
      locked: true,
      dnsRecordCount: 4,
      proxiedRecordCount: 2,
      mxRecordCount: 0,
      apexRecordPresent: true,
      wwwRecordPresent: false,
      lastSync: hoursAgo(3),
      dnsRecords: [
        { type: 'A', name: 'example-labs.com', proxied: true },
        { type: 'CNAME', name: 'app.example-labs.com', proxied: true },
        { type: 'TXT', name: 'example-labs.com', proxied: false },
        { type: 'TXT', name: '_dmarc.example-labs.com', proxied: false },
      ],
    },
  ],
  unallocatedCosts: [
    {
      provider: 'aws',
      serviceName: 'Route 53 hosted zones',
      monthToDateUsd: 1.0,
    },
    {
      provider: 'openai',
      serviceName: 'OpenAI experiments key',
      monthToDateUsd: 0.42,
    },
    {
      provider: 'aws',
      serviceName: 'Tax',
      monthToDateUsd: 0.38,
    },
  ],
  collectorRuns: [
    {
      provider: 'aws',
      providerLabel: 'AWS',
      status: 'success',
      summary: 'Amplify apps, Cost Explorer, and Route 53 collected for 4 projects.',
      errorMessage: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
      lastSyncedAt: hoursAgo(3),
      durationMs: 8421,
      affectedProjects: [],
    },
    {
      provider: 'supabase',
      providerLabel: 'Supabase',
      status: 'success',
      summary: 'Health and aggregate metrics collected for 4 databases.',
      errorMessage: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
      lastSyncedAt: hoursAgo(3),
      durationMs: 3106,
      affectedProjects: [],
    },
    {
      provider: 'cloudflare',
      providerLabel: 'Cloudflare',
      status: 'success',
      summary: 'Zone status and DNS records collected for 2 domains.',
      errorMessage: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
      lastSyncedAt: hoursAgo(3),
      durationMs: 1874,
      affectedProjects: [],
    },
    {
      provider: 'openai',
      providerLabel: 'OpenAI',
      status: 'success',
      summary: 'Usage and cost roll-ups collected for 3 API keys.',
      errorMessage: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
      lastSyncedAt: hoursAgo(3),
      durationMs: 2492,
      affectedProjects: [],
    },
    {
      provider: 'github',
      providerLabel: 'GitHub Actions',
      status: 'success',
      summary: 'Workflow runs and runtime minutes collected for 4 repositories.',
      errorMessage: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
      lastSyncedAt: hoursAgo(3),
      durationMs: 4230,
      affectedProjects: [],
    },
    {
      provider: 'http',
      providerLabel: 'HTTP Health',
      status: 'partial_success',
      summary: 'Probed 4 public URLs.',
      errorMessage: 'Recipe Box responded in 1,940 ms (above the warning threshold).',
      startedAt: hoursAgo(1),
      finishedAt: hoursAgo(1),
      lastSyncedAt: hoursAgo(1),
      durationMs: 5308,
      affectedProjects: ['recipe_box'],
    },
    {
      provider: 'resend',
      providerLabel: 'Resend',
      status: 'success',
      summary: 'Email quota and send stats collected.',
      errorMessage: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
      lastSyncedAt: hoursAgo(3),
      durationMs: 962,
      affectedProjects: [],
    },
  ],
  openAiUsage: {
    totalTokens: 1_284_720,
    cachedInputTokens: 312_400,
    requests: 1_842,
    spendUsd: 4.87,
    lastMonthTokens: 3_921_050,
    lastMonthSpendUsd: 14.32,
    lastSync: hoursAgo(3),
    tokenSeries: demoTrendSeries(14, 1_284_720, 41, 6),
    rows: [
      {
        apiKeyLabel: 'acme-site-prod',
        model: 'gpt-4o-mini',
        inputTokens: 486_210,
        outputTokens: 118_390,
        cachedInputTokens: 204_800,
        requests: 1_012,
      },
      {
        apiKeyLabel: 'acme-site-prod',
        model: 'gpt-4o',
        inputTokens: 96_480,
        outputTokens: 31_240,
        cachedInputTokens: 41_600,
        requests: 214,
      },
      {
        apiKeyLabel: 'todo-app-prod',
        model: 'gpt-4o-mini',
        inputTokens: 301_150,
        outputTokens: 84_050,
        cachedInputTokens: 66_000,
        requests: 486,
      },
      { apiKeyLabel: 'experiments', model: 'o4-mini', inputTokens: 121_900, outputTokens: 45_300, cachedInputTokens: 0, requests: 130 },
    ],
  },
  githubActionsUsage: {
    runtimeMinutes: 96.4,
    recentRuns: 58,
    recentFailures: 2,
    lastSync: hoursAgo(3),
    runtimeSeries: demoTrendSeries(14, 96.4, 17),
    rows: [
      {
        projectSlug: 'acme_site',
        projectName: 'Acme Site',
        repository: 'acme-labs/acme-site',
        latestRun: 'CI on main - success',
        recentRuns: 18,
        recentFailures: 0,
        scheduledRuns: 0,
        scheduledFailures: 0,
        durationSeconds: 1_240,
        runtimeMinutes: 27.8,
        lastSync: hoursAgo(3),
        status: 'healthy',
      },
      {
        projectSlug: 'todo_app',
        projectName: 'Todo App',
        repository: 'acme-labs/todo-app',
        latestRun: 'CI on main - success',
        recentRuns: 12,
        recentFailures: 1,
        scheduledRuns: 0,
        scheduledFailures: 0,
        durationSeconds: 980,
        runtimeMinutes: 19.6,
        lastSync: hoursAgo(3),
        status: 'warning',
      },
      {
        projectSlug: 'recipe_box',
        projectName: 'Recipe Box',
        repository: 'acme-labs/recipe-box',
        latestRun: 'CI on main - success',
        recentRuns: 8,
        recentFailures: 0,
        scheduledRuns: 0,
        scheduledFailures: 0,
        durationSeconds: 610,
        runtimeMinutes: 11.2,
        lastSync: hoursAgo(3),
        status: 'healthy',
      },
      {
        projectSlug: 'status_hub',
        projectName: 'Status Hub',
        repository: 'acme-labs/status-hub',
        latestRun: 'Collect status - success (scheduled)',
        recentRuns: 20,
        recentFailures: 1,
        scheduledRuns: 14,
        scheduledFailures: 1,
        durationSeconds: 1_710,
        runtimeMinutes: 37.8,
        lastSync: hoursAgo(3),
        status: 'healthy',
      },
    ],
  },
  lastMonthCostUsd: 33.06,
  mtdCostSeries: demoMtdCostSeries(10.08),
};
