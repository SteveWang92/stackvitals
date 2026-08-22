/**
 * Fictional demo rows for the LOCAL Supabase stack, written as raw snapshot rows rather than a
 * ready-made DashboardData object. `VITE_DEMO_MODE` (src/data/demoDashboardData.ts) short-circuits
 * the read layer for screenshots; this seeds the database instead, so `fetchDashboardData` does its
 * real dedup-to-latest, month-bounds, roll-up and error-scoping work on the way to the screen. The
 * cast of projects/domains/keys matches the screenshot demo so the two tell the same story.
 *
 * Coverage is the point — every state the UI can render should be present somewhere:
 *   - project status: healthy / warning / failed / never-synced, with and without a public URL
 *   - provider freshness: fresh, stale (>36h), never (a resource that exists but never reported)
 *   - 30-day history: up, degraded, down, and no-data days in both the sparkline and uptime strip
 *   - collectors: success, partial_success, failed, skipped, and a run that never finished
 *   - collector errors: project-scoped, unscoped, and one suppressed by a newer successful run
 *   - usage: multi-key/multi-model OpenAI roll-ups incl. last month; GitHub Actions with failures
 *   - trends: enough collection days for the usage charts, including a day the collector missed
 *   - costs: account-level lines incl. per-model OpenAI billing, last-month total, and a
 *     month-to-date series with uneven daily amounts (a smooth curve would draw the daily-spend
 *     chart as a straight line)
 *   - domains: healthy, expiring-soon, and a pending zone with no expiration data
 *
 * Everything written here is tagged so re-seeding replaces it: `metadata.seed = 'demo'` on snapshot
 * rows, a `demo-` external-id prefix on resources. Rows you added by hand are left alone.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEMO_SEED_TAG = 'demo';
const HISTORY_DAYS = 30;
const COLLECTION_DAYS = 3;
/**
 * Enough to reach the 1st of the month, so the daily-spend chart starts with real collections
 * rather than the flat averaged lead-in the read layer draws before the first one. Kept under the
 * read layer's 400-row cost_snapshots window: 11 keys x 28 days + 11 last month.
 */
const COST_SERIES_DAYS = 28;
/**
 * The usage trend charts need more days than the rest of the fixture, so OpenAI and GitHub Actions
 * metrics carry on past COLLECTION_DAYS. Costed against the read layer's 1000-row metric window:
 * roughly 44 rows a day here, which leaves room for the per-project metrics.
 */
const USAGE_TREND_DAYS = 12;
/** One day in the usage window with no collector run, so the charts have a gap to render. */
const USAGE_GAP_DAY = 5;

/** Deterministic pseudo-jitter — the same day always seeds the same numbers. */
function jitter(index, seed) {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

function isoAt(now, dayOffset, hour, minute = 0) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset);

  return new Date(day + hour * 3_600_000 + minute * 60_000).toISOString();
}

function dayKey(now, dayOffset) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset)).toISOString().slice(0, 10);
}

/** Collector wall-clock for a given day: recent enough that day 0 reads as "synced hours ago". */
function collectedAt(now, dayOffset) {
  return isoAt(now, dayOffset, Math.max(0, now.getUTCHours() - 3), 12);
}

// --- The cast ----------------------------------------------------------------
//
// `history` drives the 30-day strip: indexes are days into the window, 0 = oldest, 29 = today.

const PROJECTS = [
  {
    slug: 'acme_site',
    name: 'Acme Site',
    publicUrl: 'https://acme.example.dev',
    sortOrder: 1,
    latencyMs: 184,
    history: {},
    repository: 'acme-labs/acme-site',
  },
  {
    slug: 'todo_app',
    name: 'Todo App',
    publicUrl: 'https://todo.example.dev',
    sortOrder: 2,
    latencyMs: 231,
    history: { degradedDays: [12], gapDays: [22] },
    repository: 'acme-labs/todo-app',
  },
  {
    slug: 'recipe_box',
    name: 'Recipe Box',
    publicUrl: 'https://recipes.example.dev',
    sortOrder: 3,
    latencyMs: 640,
    // Today is a warning (slow but up), and day 5 was a full outage.
    history: { degradedDays: [26, 29], downDays: [5] },
    repository: 'acme-labs/recipe-box',
  },
  {
    slug: 'status_hub',
    name: 'Status Hub',
    publicUrl: 'https://status.example.dev',
    sortOrder: 4,
    latencyMs: 152,
    history: { gapDays: [18, 19] },
    repository: 'acme-labs/status-hub',
  },
  {
    slug: 'legacy_api',
    name: 'Legacy API',
    publicUrl: 'https://legacy.example.dev',
    sortOrder: 5,
    latencyMs: 910,
    // Broke two days ago and stayed broken — the "failed" card and the outage strip.
    history: { downDays: [27, 28, 29], degradedDays: [24, 25] },
    repository: null,
  },
  {
    // No public URL, no collector has ever reported: everything reads Unknown / Never synced.
    slug: 'draft_site',
    name: 'Draft Site',
    publicUrl: null,
    sortOrder: 6,
    latencyMs: null,
    history: null,
    repository: null,
  },
];

const OPENAI_USAGE = [
  {
    apiKeyLabel: 'acme-site-prod',
    model: 'gpt-4o-mini',
    inputTokens: 486_210,
    outputTokens: 118_390,
    cachedInputTokens: 204_800,
    requests: 1_012,
  },
  { apiKeyLabel: 'acme-site-prod', model: 'gpt-4o', inputTokens: 96_480, outputTokens: 31_240, cachedInputTokens: 41_600, requests: 214 },
  {
    apiKeyLabel: 'todo-app-prod',
    model: 'gpt-4o-mini',
    inputTokens: 301_150,
    outputTokens: 84_050,
    cachedInputTokens: 66_000,
    requests: 486,
  },
  { apiKeyLabel: 'experiments', model: 'o4-mini', inputTokens: 121_900, outputTokens: 45_300, cachedInputTokens: 0, requests: 130 },
];

const DOMAINS = [
  {
    domain: 'example.dev',
    zoneStatus: 'active',
    registrar: 'Cloudflare',
    expirationDays: 284,
    autoRenew: true,
    locked: true,
    records: [
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
    // Expiring inside the warning window, auto-renew off: the domain card's unhappy path.
    domain: 'example-labs.com',
    zoneStatus: 'active',
    registrar: 'GoDaddy',
    expirationDays: 24,
    autoRenew: false,
    locked: true,
    records: [
      { type: 'A', name: 'example-labs.com', proxied: true },
      { type: 'CNAME', name: 'app.example-labs.com', proxied: true },
      { type: 'TXT', name: 'example-labs.com', proxied: false },
      { type: 'TXT', name: '_dmarc.example-labs.com', proxied: false },
    ],
  },
  {
    // Zone never finished activating: no expiration data at all, so the card reads Unknown.
    domain: 'legacy-example.net',
    zoneStatus: 'pending',
    registrar: null,
    expirationDays: null,
    autoRenew: null,
    locked: null,
    records: [{ type: 'A', name: 'legacy-example.net', proxied: false }],
  },
];

/** service_name -> month-to-date total. `project` null means an unallocated (account-level) cost. */
/**
 * Account-level cost lines — none of them belongs to a project. Providers bill by service, and
 * nothing in the pipeline can split a shared Amplify or EC2 bill between apps, so there is one
 * hosting line for the account rather than one per app. OpenAI bills a line per model and
 * direction, which is the shape its cost API actually returns.
 */
const COSTS = [
  { provider: 'aws', serviceName: 'Amazon EC2', amountUsd: 6.4 },
  { provider: 'amplify', serviceName: 'AWS Amplify hosting', amountUsd: 3.83 },
  { provider: 'openai', serviceName: 'gpt-4o-mini-2026-02-11, input', amountUsd: 2.1 },
  { provider: 'openai', serviceName: 'gpt-4o-mini-2026-02-11, output', amountUsd: 1.05 },
  { provider: 'aws', serviceName: 'Route 53 hosted zones', amountUsd: 1.0 },
  { provider: 'openai', serviceName: 'gpt-4o-2026-01-24, input', amountUsd: 0.86 },
  { provider: 'openai', serviceName: 'gpt-4o-2026-01-24, output', amountUsd: 0.44 },
  { provider: 'aws', serviceName: 'Tax', amountUsd: 0.38 },
  { provider: 'openai', serviceName: 'o4-mini-2026-03-17, input', amountUsd: 0.28 },
  { provider: 'openai', serviceName: 'o4-mini-2026-03-17, output', amountUsd: 0.14 },
  { provider: 'resend', serviceName: 'Resend email', amountUsd: 0.12 },
];

// --- Row builders ------------------------------------------------------------

function historyStateFor(project, index) {
  const history = project.history;

  if (!history) {
    return null;
  }

  if (history.gapDays?.includes(index)) {
    return 'no-data';
  }

  if (history.downDays?.includes(index)) {
    return 'down';
  }

  if (history.degradedDays?.includes(index)) {
    return 'degraded';
  }

  return 'up';
}

/**
 * Two probes a day for 30 days. Day 29 is today, and its last probe is what the project card and
 * the Needs Attention panel read as the current uptime status.
 */
function healthCheckRows(project, projectId, now) {
  const rows = [];

  for (let index = 0; index < HISTORY_DAYS; index += 1) {
    const state = historyStateFor(project, index);

    if (state === null || state === 'no-data') {
      continue;
    }

    const dayOffset = HISTORY_DAYS - 1 - index;

    for (const [probe, hour] of [
      [0, 4],
      [1, 16],
    ]) {
      // On a degraded day only the second probe is unhappy, so the day has a mixed sample.
      const unhappy = state === 'down' || (state === 'degraded' && probe === 1);
      const failed = state === 'down';
      const warning = !failed && unhappy;
      const spread = 0.82 + jitter(index * 2 + probe, project.latencyMs) * 0.36;

      rows.push({
        project_id: projectId,
        url: project.publicUrl,
        status: failed ? 'failed' : warning ? 'warning' : 'healthy',
        http_status: failed ? 503 : 200,
        response_time_ms: failed ? null : Math.round(project.latencyMs * (warning ? spread * 3.1 : spread)),
        error_message: failed ? 'Connection timed out after 10000 ms' : null,
        checked_at: isoAt(now, dayOffset, hour, 7),
      });
    }
  }

  return rows;
}

function metric(projectId, provider, metricKey, metricValue, status, metadata, collected) {
  return {
    project_id: projectId,
    provider,
    metric_key: metricKey,
    metric_value: metricValue,
    status,
    metadata: { ...metadata, seed: DEMO_SEED_TAG },
    collected_at: collected,
  };
}

/**
 * Per-project provider metrics for one collection day. `dayOffset` 0 is today; older days exist so
 * the read layer's dedup-to-latest has something to discard.
 */
function projectMetricRows(project, projectId, now, dayOffset) {
  const at = collectedAt(now, dayOffset);
  const rows = [];
  const deployFailed = project.slug === 'legacy_api';
  const buildNumber = 214 - dayOffset;

  if (project.slug === 'draft_site') {
    return rows;
  }

  // Amplify — except status_hub, which deploys from a GitHub Actions workflow instead.
  if (project.slug !== 'status_hub') {
    rows.push(
      metric(
        projectId,
        'amplify',
        'amplify_app_available',
        1,
        'healthy',
        { appId: `d${project.slug}01`, appName: project.slug.replace(/_/g, '-') },
        at,
      ),
      metric(
        projectId,
        'amplify',
        'amplify_branch_available',
        deployFailed ? 0 : 1,
        deployFailed ? 'failed' : 'healthy',
        {
          appId: `d${project.slug}01`,
          branchName: 'main',
          stage: 'PRODUCTION',
          jobStatus: deployFailed ? 'FAILED' : 'SUCCEED',
          buildNumber,
        },
        at,
      ),
    );
  }

  // Supabase — acme_site stopped reporting 4 days ago (stale badge), legacy_api never did.
  if (!['acme_site', 'legacy_api'].includes(project.slug)) {
    rows.push(metric(projectId, 'supabase', 'supabase_rest_available', 1, 'healthy', { projectRef: `${project.slug}-db` }, at));
  }

  if (project.slug === 'todo_app') {
    rows.push(
      metric(projectId, 'supabase', 'supabase_aggregate_rows', 1_284 + dayOffset * 37, 'healthy', { rpcName: 'aggregate_counts' }, at),
      metric(projectId, 'supabase', 'supabase_aggregate_available', 1, 'healthy', { rpcName: 'aggregate_counts' }, at),
    );
  }

  // Resend — a sending domain that has slipped out of verified state.
  if (project.slug === 'acme_site') {
    rows.push(metric(projectId, 'resend', 'resend_domain_verified', 0, 'warning', { domain: 'mail.example.dev' }, at));
  }

  // HTTP response time alongside the health_checks rows, mirroring the http adapter.
  if (project.publicUrl) {
    const state = historyStateFor(project, HISTORY_DAYS - 1 - dayOffset);
    const failed = state === 'down';
    const warning = state === 'degraded';

    rows.push(
      metric(
        projectId,
        'http',
        'http_response_time_ms',
        failed ? null : Math.round(project.latencyMs * (warning ? 3.1 : 1)),
        failed ? 'failed' : warning ? 'warning' : 'healthy',
        { url: project.publicUrl },
        at,
      ),
    );
  }

  if (project.repository) {
    rows.push(...githubMetricRows(project, projectId, at, dayOffset));
  }

  return rows;
}

function githubMetricRows(project, projectId, at, dayOffset) {
  const profile = {
    acme_site: { runs: 18, failures: 0, scheduled: 0, scheduledFailures: 0, seconds: 1_240, conclusion: 'success' },
    todo_app: { runs: 12, failures: 3, scheduled: 0, scheduledFailures: 0, seconds: 980, conclusion: 'failure' },
    recipe_box: { runs: 8, failures: 0, scheduled: 0, scheduledFailures: 0, seconds: 610, conclusion: 'success' },
    status_hub: { runs: 20, failures: 1, scheduled: 14, scheduledFailures: 1, seconds: 1_710, conclusion: 'success' },
  }[project.slug];

  if (!profile) {
    return [];
  }

  const failed = profile.conclusion === 'failure';
  const since = dayKey(new Date(), 7);
  const shared = { repository: project.repository, since };
  const latestRun = {
    repository: project.repository,
    workflowId: 4210,
    workflowName: project.slug === 'status_hub' ? 'Collect status' : 'CI',
    status: 'completed',
    conclusion: profile.conclusion,
    branch: 'main',
    event: project.slug === 'status_hub' ? 'schedule' : 'push',
    runStartedAt: at,
  };

  const rows = [
    metric(projectId, 'github', 'github_actions_recent_run_count', profile.runs - dayOffset, 'healthy', shared, at),
    metric(projectId, 'github', 'github_actions_recent_failure_count', profile.failures, failed ? 'failed' : 'healthy', shared, at),
    metric(
      projectId,
      'github',
      'github_actions_recent_duration_seconds',
      // Varies by day: a constant would draw the runtime trend as a flat line.
      Math.round(profile.seconds * (1 - dayOffset * 0.02) * (0.82 + jitter(dayOffset, profile.runs) * 0.3)),
      'healthy',
      shared,
      at,
    ),
    metric(projectId, 'github', 'github_actions_latest_run_status', 1, failed ? 'failed' : 'healthy', latestRun, at),
    metric(projectId, 'github', 'github_actions_scheduled_run_count', profile.scheduled, 'healthy', shared, at),
    metric(projectId, 'github', 'github_actions_scheduled_failure_count', profile.scheduledFailures, 'healthy', shared, at),
  ];

  // status_hub is the GitHub-Pages-style project: its deploy status comes from a workflow.
  if (project.slug === 'status_hub') {
    rows.push(
      metric(
        projectId,
        'github',
        'github_actions_deploy_status',
        1,
        'healthy',
        { ...latestRun, deployWorkflow: 'deploy-site.yml', workflowName: 'Deploy site' },
        at,
      ),
    );
  }

  return rows;
}

/** Account-level OpenAI usage: project_id null, one set of rows per collection day. */
function openAiMetricRows(now, dayOffset) {
  const at = collectedAt(now, dayOffset);
  // Falls off towards the past with a wobble on top, so the token trend has a shape to read.
  const decay = (1 - dayOffset * 0.035) * (0.93 + jitter(dayOffset, 3) * 0.14);
  const rows = [];

  for (const usage of OPENAI_USAGE) {
    const shared = { apiKeyLabel: usage.apiKeyLabel, model: usage.model, period: 'current_month' };

    rows.push(
      metric(null, 'openai', 'openai_input_tokens', Math.round(usage.inputTokens * decay), 'healthy', shared, at),
      metric(null, 'openai', 'openai_output_tokens', Math.round(usage.outputTokens * decay), 'healthy', shared, at),
      metric(null, 'openai', 'openai_cached_input_tokens', Math.round(usage.cachedInputTokens * decay), 'healthy', shared, at),
      metric(null, 'openai', 'openai_requests', Math.round(usage.requests * decay), 'healthy', shared, at),
    );
  }

  return [
    ...rows,
    metric(null, 'openai', 'openai_spend_usd', Number((4.87 * decay).toFixed(2)), 'healthy', { period: 'current_month' }, at),
    metric(null, 'openai', 'openai_last_month_tokens', 3_921_050, 'healthy', { period: 'last_month' }, at),
    metric(null, 'openai', 'openai_last_month_spend_usd', 14.32, 'healthy', { period: 'last_month' }, at),
  ];
}

function cloudflareMetricRows(now, dayOffset) {
  const at = collectedAt(now, dayOffset);
  const rows = [];

  for (const domain of DOMAINS) {
    const active = domain.zoneStatus === 'active';
    const records = domain.records;
    const shared = { domain: domain.domain };

    rows.push(
      // A zone that never finished activating reports 'unknown', not 'warning': the collector has
      // no verdict on it. That is the third domain-card state, next to healthy and expiring-soon.
      metric(null, 'cloudflare', 'cloudflare_zone_active', active ? 1 : 0, active ? 'healthy' : 'unknown', shared, at),
      metric(null, 'cloudflare', 'cloudflare_dns_record_count', records.length, 'healthy', shared, at),
      metric(
        null,
        'cloudflare',
        'cloudflare_proxied_record_count',
        records.filter((record) => record.proxied).length,
        'healthy',
        shared,
        at,
      ),
      metric(
        null,
        'cloudflare',
        'cloudflare_mx_record_count',
        records.filter((record) => record.type === 'MX').length,
        'healthy',
        shared,
        at,
      ),
      metric(
        null,
        'cloudflare',
        'cloudflare_apex_record_present',
        records.some((record) => record.name === domain.domain) ? 1 : 0,
        'healthy',
        shared,
        at,
      ),
      metric(
        null,
        'cloudflare',
        'cloudflare_www_record_present',
        records.some((record) => record.name.startsWith('www.')) ? 1 : 0,
        'healthy',
        shared,
        at,
      ),
    );

    if (domain.registrar) {
      rows.push(
        metric(
          null,
          'cloudflare',
          'cloudflare_registrar_on_cloudflare',
          domain.registrar === 'Cloudflare' ? 1 : 0,
          'healthy',
          { ...shared, registrar: domain.registrar },
          at,
        ),
      );
    }

    if (domain.expirationDays !== null) {
      const expiresAt = new Date(now.getTime() + domain.expirationDays * 86_400_000).toISOString();

      rows.push(
        metric(
          null,
          'cloudflare',
          'cloudflare_domain_expiration_days',
          domain.expirationDays,
          domain.expirationDays < 30 ? 'warning' : 'healthy',
          { ...shared, expiresAt, autoRenew: domain.autoRenew, locked: domain.locked },
          at,
        ),
      );
    }
  }

  return rows;
}

function resourceRows(project, projectId, now) {
  const seenAt = collectedAt(now, 0);
  const slug = project.slug.replace(/_/g, '-');

  if (project.slug === 'draft_site') {
    return [];
  }

  const rows = [];

  if (project.slug !== 'status_hub') {
    rows.push(
      {
        project_id: projectId,
        provider: 'amplify',
        resource_type: 'app',
        external_id: `demo-amplify-${slug}`,
        display_name: slug,
        metadata: { defaultDomain: `${slug}.amplifyapp.com`, hasRepository: true },
        last_seen_at: seenAt,
      },
      {
        project_id: projectId,
        provider: 'amplify',
        resource_type: 'branch',
        external_id: `demo-amplify-${slug}-main`,
        display_name: 'main',
        metadata: { stage: 'PRODUCTION', enableAutoBuild: true },
        last_seen_at: seenAt,
      },
    );
  }

  rows.push({
    project_id: projectId,
    provider: 'supabase',
    resource_type: 'project',
    external_id: `demo-supabase-${slug}`,
    display_name: `${slug}-db`,
    metadata: { region: 'ap-southeast-2', plan: 'free' },
    // legacy_api's database is in the inventory but has never reported: Unknown, never synced.
    last_seen_at: project.slug === 'legacy_api' ? null : seenAt,
  });

  if (project.repository) {
    rows.push({
      project_id: projectId,
      provider: 'github',
      resource_type: 'repository',
      external_id: `demo-github-${slug}`,
      display_name: project.repository,
      metadata: { aggregateOnly: true },
      last_seen_at: seenAt,
    });
  }

  return rows;
}

function domainResourceRows(now) {
  const seenAt = collectedAt(now, 0);

  return DOMAINS.flatMap((domain, domainIndex) => [
    {
      project_id: null,
      provider: 'cloudflare',
      resource_type: 'zone',
      external_id: `demo-zone-${domain.domain}`,
      display_name: domain.domain,
      metadata: { status: domain.zoneStatus, plan: 'free' },
      last_seen_at: seenAt,
    },
    ...domain.records.map((record, index) => ({
      project_id: null,
      provider: 'cloudflare',
      resource_type: 'dns_record',
      external_id: `demo-dns-${domainIndex}-${index}`,
      display_name: record.name,
      metadata: { domain: domain.domain, type: record.type, name: record.name, proxied: record.proxied },
      last_seen_at: seenAt,
    })),
  ]);
}

/**
 * Cumulative month-to-date rows: `amount_usd` is the running total for the period, so the series
 * climbs and the latest row per key is the current MTD figure. Also emits last month's closing
 * totals, which is what the "vs last month" comparison reads.
 */
function costRows(now) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const dayOfMonth = now.getUTCDate();
  const days = Math.min(COST_SERIES_DAYS, dayOfMonth);
  const rows = [];
  // Uneven daily amounts rather than a smooth curve: the Costs tab charts the rise between
  // collections, and a smooth curve would flatten into a straight line there.
  const weights = Array.from({ length: days }, (_, index) => 0.55 + jitter(index, 11) * 0.95);
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  let progress = 0;

  for (let step = 0; step < days; step += 1) {
    const dayOffset = days - 1 - step;
    const periodEnd = dayKey(now, dayOffset);
    const at = collectedAt(now, dayOffset);

    progress += weights[step] / weightTotal;

    for (const cost of COSTS) {
      rows.push({
        project_id: null,
        provider: cost.provider,
        service_name: cost.serviceName,
        period_start: monthStart,
        period_end: periodEnd,
        amount_usd: Number((cost.amountUsd * progress).toFixed(4)),
        metadata: { seed: DEMO_SEED_TAG },
        collected_at: at,
      });
    }
  }

  // Last month closed higher than this month's run rate, so the comparison has something to say.
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

  for (const cost of COSTS) {
    rows.push({
      project_id: null,
      provider: cost.provider,
      service_name: cost.serviceName,
      period_start: lastMonthStart,
      period_end: lastMonthEnd,
      amount_usd: Number((cost.amountUsd * 3.28).toFixed(4)),
      metadata: { seed: DEMO_SEED_TAG },
      collected_at: new Date(`${lastMonthEnd}T23:40:00.000Z`).toISOString(),
    });
  }

  return rows;
}

/**
 * One run per adapter per collection day. Only the newest run per adapter reaches the Collectors
 * tab, and an error is hidden once a newer successful run exists for the same adapter — so the
 * failures below are deliberately the newest run of their adapter.
 */
function collectorRunRows(now) {
  const rows = [];

  const run = (provider, adapterKey, dayOffset, overrides = {}) => {
    const startedAt = collectedAt(now, dayOffset);
    const durationMs = overrides.durationMs ?? 4_000;

    return {
      provider,
      started_at: startedAt,
      finished_at: overrides.finishedAt === null ? null : new Date(new Date(startedAt).getTime() + durationMs).toISOString(),
      status: overrides.status ?? 'success',
      summary: overrides.summary ?? null,
      error_message: overrides.errorMessage ?? null,
      metadata: { adapterKey, seed: DEMO_SEED_TAG, ...(overrides.errors ? { errors: overrides.errors } : {}) },
    };
  };

  for (let dayOffset = COLLECTION_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    const today = dayOffset === 0;

    rows.push(
      run('amplify', 'amplify', dayOffset, { summary: 'Amplify apps and branches collected for 5 projects.', durationMs: 8_421 }),
      run('supabase', 'supabase-health', dayOffset, {
        summary: today ? 'Health collected for 3 of 4 databases.' : 'Health collected for 4 databases.',
        durationMs: 3_106,
        // Newest supabase run fails, scoped to one project — that project shows the error, others do
        // not. No error_message alongside it on purpose: the read path falls back to error_message
        // for every project when the scoped list has nothing for that project, which would leak it.
        ...(today
          ? {
              status: 'failed',
              errors: [{ projectSlug: 'legacy_api', message: 'Supabase REST probe failed: 401 Unauthorized (service key rotated?).' }],
            }
          : {}),
      }),
      run('cloudflare', 'cloudflare', dayOffset, { summary: 'Zone status and DNS records collected for 3 domains.', durationMs: 1_874 }),
      run('github', 'github', dayOffset, { summary: 'Workflow runs and runtime collected for 4 repositories.', durationMs: 4_230 }),
      run('resend', 'resend', dayOffset, { summary: 'Email quota and send stats collected.', durationMs: 962 }),
      run('http', 'http', dayOffset, {
        summary: 'Probed 5 public URLs.',
        durationMs: 5_308,
        ...(today
          ? {
              status: 'partial_success',
              errors: [
                { projectSlug: 'recipe_box', message: 'Responded in 1,984 ms, above the 1,500 ms warning threshold.' },
                { projectSlug: 'legacy_api', message: 'Connection timed out after 10,000 ms.' },
              ],
            }
          : {}),
      }),
      run('aws', 'aws-cost', dayOffset, {
        summary: today ? null : 'Cost Explorer totals collected for 6 services.',
        durationMs: 6_120,
        // Newest AWS run never finished: null duration, and an account-level error with no project
        // scope — the one error that is meant to appear on every project.
        ...(today ? { status: 'failed', finishedAt: null, errorMessage: 'Cost Explorer request timed out after 60s.' } : {}),
      }),
      run('openai', 'openai', dayOffset, { summary: 'Usage and cost roll-ups collected for 3 API keys.', durationMs: 2_492 }),
    );
  }

  // An adapter that is configured but had nothing to do — the "skipped" state.
  rows.push(
    run('supabase', 'supabase-aggregate-draft', 0, {
      status: 'skipped',
      summary: 'No aggregate RPC configured for Draft Site.',
      durationMs: 12,
    }),
    // Two days ago this adapter failed, but it has succeeded since — the error must stay hidden.
    run('cloudflare', 'cloudflare', 2, {
      status: 'failed',
      errorMessage: 'Cloudflare API returned 429 Too Many Requests.',
      durationMs: 1_020,
    }),
  );

  return rows;
}

// --- Supabase REST plumbing --------------------------------------------------

function assertLocal(apiUrl) {
  const { hostname } = new URL(apiUrl);

  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(hostname)) {
    throw new Error(`Refusing to seed demo data into a non-local Supabase (${hostname}). This script is local-development only.`);
  }
}

/**
 * Deletes go through the local database container, not PostgREST: migration 004 grants
 * service_role select/insert/update only, and a collector never deletes. Widening those grants to
 * suit a dev script would weaken the production role, so the cleanup uses psql inside the container
 * the CLI already started. The container name follows `supabase_db_<project_id>` from config.toml.
 */
function runLocalSql(sql) {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];

  if (!projectId) {
    throw new Error('Could not read project_id from supabase/config.toml, so the previous demo rows cannot be cleared.');
  }

  const result = spawnSync(
    'docker',
    ['exec', '-i', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql],
    { encoding: 'utf8', windowsHide: true },
  );

  if (result.error || result.status !== 0) {
    throw new Error(`Clearing the previous demo rows failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

function restClient(apiUrl, serviceKey) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  return async function request(path, { method = 'GET', body, prefer } = {}) {
    const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${method} ${path} failed (HTTP ${response.status}): ${await response.text()}`);
    }

    const text = await response.text();

    return text ? JSON.parse(text) : null;
  };
}

async function insertAll(request, table, rows, providerIds) {
  const resolved = rows.map(({ provider, ...row }) => (provider === undefined ? row : { ...row, provider_id: providerIds.get(provider) }));

  for (let start = 0; start < resolved.length; start += 200) {
    await request(table, { method: 'POST', body: resolved.slice(start, start + 200), prefer: 'return=minimal' });
  }

  return resolved.length;
}

// --- Entry point -------------------------------------------------------------

export async function seedDemoData({ apiUrl, serviceKey }, now = new Date()) {
  assertLocal(apiUrl);

  const request = restClient(apiUrl, serviceKey);
  const providerIds = new Map((await request('providers?select=key,id')).map((row) => [row.key, row.id]));

  for (const project of PROJECTS) {
    await request('projects?on_conflict=slug', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [{ slug: project.slug, name: project.name, public_url: project.publicUrl, sort_order: project.sortOrder, is_active: true }],
    });
  }

  const demoSlugs = PROJECTS.map((project) => project.slug).join(',');
  const slugList = PROJECTS.map((project) => `'${project.slug}'`).join(', ');
  const projectIds = new Map((await request(`projects?select=slug,id&slug=in.(${demoSlugs})`)).map((row) => [row.slug, row.id]));

  // Your own local rows (supabase/seed.local.sql) would otherwise sit alongside the demo cast as
  // empty "never synced" cards. The read path filters on is_active, so parking them keeps the
  // dashboard to the intended fixture; `npm run db:reset` brings them back.
  const parked = await request(`projects?slug=not.in.(${demoSlugs})&is_active=eq.true`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { is_active: false },
  });

  // Clear the previous seed only. Rows written by a real collector run, or by hand, survive.
  runLocalSql(
    [
      `delete from public.health_checks where project_id in (select id from public.projects where slug in (${slugList}));`,
      `delete from public.metric_snapshots where metadata->>'seed' = '${DEMO_SEED_TAG}';`,
      `delete from public.cost_snapshots where metadata->>'seed' = '${DEMO_SEED_TAG}';`,
      `delete from public.collector_runs where metadata->>'seed' = '${DEMO_SEED_TAG}';`,
      `delete from public.resources where external_id like 'demo-%';`,
    ].join(' '),
  );

  const healthChecks = PROJECTS.flatMap((project) => (project.history ? healthCheckRows(project, projectIds.get(project.slug), now) : []));
  const resources = [
    ...PROJECTS.flatMap((project) => resourceRows(project, projectIds.get(project.slug), now)),
    ...domainResourceRows(now),
  ];
  const metrics = [];

  // Usage metrics run further back than the rest so the Usage tab charts have a trend to draw;
  // everything else only needs enough days to exercise dedup-to-latest.
  for (let dayOffset = USAGE_TREND_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    if (dayOffset === USAGE_GAP_DAY) {
      continue;
    }

    if (dayOffset < COLLECTION_DAYS) {
      metrics.push(
        ...PROJECTS.flatMap((project) => projectMetricRows(project, projectIds.get(project.slug), now, dayOffset)),
        ...cloudflareMetricRows(now, dayOffset),
      );
    } else {
      metrics.push(
        ...PROJECTS.flatMap((project) =>
          project.repository ? githubMetricRows(project, projectIds.get(project.slug), collectedAt(now, dayOffset), dayOffset) : [],
        ),
      );
    }

    metrics.push(...openAiMetricRows(now, dayOffset));
  }

  // Acme Site's database went quiet four days ago: last known healthy, but stale.
  metrics.push(
    metric(
      projectIds.get('acme_site'),
      'supabase',
      'supabase_rest_available',
      1,
      'healthy',
      { projectRef: 'acme-site-db' },
      collectedAt(now, 4),
    ),
  );

  const counts = {
    projects: PROJECTS.length,
    ...(parked?.length ? { 'projects hidden': parked.length } : {}),
    resources: await insertAll(request, 'resources', resources, providerIds),
    health_checks: await insertAll(request, 'health_checks', healthChecks, providerIds),
    metric_snapshots: await insertAll(request, 'metric_snapshots', metrics, providerIds),
    cost_snapshots: await insertAll(request, 'cost_snapshots', costRows(now), providerIds),
    collector_runs: await insertAll(request, 'collector_runs', collectorRunRows(now), providerIds),
  };

  return counts;
}
