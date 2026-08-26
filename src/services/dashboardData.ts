import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CollectorRunSummary,
  CostPoint,
  CostSnapshot,
  DomainSummary,
  GitHubActionsUsageSummary,
  OpenAiUsageSummary,
  ProjectStatus,
} from '../types';
import { collectorRunSummaries } from './dashboard/collectorRuns';
import { buildMtdCostSeries, costTotal, currentMonthBounds, isPeriodRow, lastMonthBounds, latestCostRows } from './dashboard/costs';
import { buildDomainSummaries } from './dashboard/domains';
import { HISTORY_WINDOW_DAYS, historySince } from './dashboard/history';
import { projectFromRows } from './dashboard/projects';
import { providerKey } from './dashboard/rows';
import type {
  CollectorRunRow,
  CostSnapshotRow,
  HealthCheckHistoryRow,
  HealthCheckRow,
  MetricSnapshotRow,
  ProjectRow,
  ResourceRow,
} from './dashboard/rows';
import { githubActionsUsageSummary, openAiUsageSummary } from './dashboard/usage';

// The aggregation itself lives in ./dashboard/*, split by the shape it produces. This module is
// the read boundary: it owns the Supabase queries and assembles their results into DashboardData.
export { HISTORY_WINDOW_DAYS, buildProjectHistory, historySince, utcDayKey, utcDayRange } from './dashboard/history';
export { buildMtdCostSeries } from './dashboard/costs';

export interface DashboardData {
  projects: ProjectStatus[];
  domains: DomainSummary[];
  costs: CostSnapshot[];
  collectorRuns: CollectorRunSummary[];
  openAiUsage: OpenAiUsageSummary;
  githubActionsUsage: GitHubActionsUsageSummary;
  lastMonthCostUsd: number | null;
  mtdCostSeries: CostPoint[];
}

async function selectRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function fetchDashboardData(client: SupabaseClient): Promise<DashboardData> {
  // Snapshots are append-only, so each select reads only the newest N rows and the
  // dedup-to-latest happens client-side. The limits assume a handful of projects on a
  // daily collector cadence; with many more projects/domains (or a much faster cadence)
  // older-but-still-current keys could fall outside the window and disappear from the
  // dashboard — raise the limits if the fleet grows.
  const [projects, resources, metrics, costs, healthChecks, healthCheckHistory, collectorRuns] = await Promise.all([
    selectRows<ProjectRow>(
      client
        .from('projects')
        .select('id, slug, name, public_url')
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name'),
    ),
    selectRows<ResourceRow>(
      client
        .from('resources')
        .select('id, project_id, resource_type, display_name, metadata, last_seen_at, providers(key, name)')
        .order('last_seen_at', { ascending: false }),
    ),
    selectRows<MetricSnapshotRow>(
      client
        .from('metric_snapshots')
        .select('project_id, metric_key, metric_value, status, metadata, collected_at, providers(key, name)')
        .order('collected_at', { ascending: false })
        .limit(1000),
    ),
    selectRows<CostSnapshotRow>(
      client
        .from('cost_snapshots')
        .select('project_id, service_name, period_start, period_end, amount_usd, metadata, collected_at, providers(key, name)')
        .order('collected_at', { ascending: false })
        // Wide enough for a month of daily collection, which the daily-spend chart needs: at 100
        // rows a fleet with a dozen cost lines only kept about a week and the rest of the month
        // flattened into a single averaged step.
        .limit(400),
    ),
    selectRows<HealthCheckRow>(
      client
        .from('health_checks')
        .select('project_id, url, status, http_status, response_time_ms, error_message, checked_at')
        .order('checked_at', { ascending: false })
        .limit(100),
    ),
    // Separate from the query above on purpose. That one stays unbounded-in-time so
    // uptimeStatus still reflects the newest check even when it predates the window; this one
    // is a narrow 4-column projection bounded to the window, and feeds only the trend charts.
    selectRows<HealthCheckHistoryRow>(
      client
        .from('health_checks')
        .select('project_id, status, response_time_ms, checked_at')
        .gte('checked_at', historySince(HISTORY_WINDOW_DAYS))
        // Newest first so that hitting the row limit drops the oldest days off the left of the
        // chart rather than the most recent ones off the right. The day grouping below does not
        // care about order.
        .order('checked_at', { ascending: false })
        .limit(2000),
    ),
    selectRows<CollectorRunRow>(
      client
        .from('collector_runs')
        .select('started_at, finished_at, status, summary, error_message, metadata, providers(key, name)')
        .order('started_at', { ascending: false })
        .limit(200),
    ),
  ]);

  const currentPeriod = currentMonthBounds();
  const lastMonthPeriod = lastMonthBounds();
  const latestCosts = latestCostRows(costs.filter((cost) => isPeriodRow(cost, currentPeriod)));
  const latestLastMonthCosts = latestCostRows(costs.filter((cost) => isPeriodRow(cost, lastMonthPeriod)));
  const lastMonthCostUsd = costTotal(latestLastMonthCosts);
  const rows = {
    projects,
    resources,
    metrics,
    costs: latestCosts,
    healthChecks,
    healthCheckHistory,
    collectorRuns,
  };

  // Every cost row, whatever its project_id. Nothing writes that column today, and a row that
  // somehow carries one must still appear in the total rather than being filtered out of sight.
  const costSnapshots = latestCosts.map((cost) => ({
    provider: providerKey(cost),
    serviceName: cost.service_name,
    monthToDateUsd: cost.amount_usd,
  }));

  return {
    projects: projects.map((project) =>
      projectFromRows(project, {
        ...rows,
      }),
    ),
    domains: buildDomainSummaries(resources, metrics),
    costs: costSnapshots.sort((a, b) => b.monthToDateUsd - a.monthToDateUsd),
    collectorRuns: collectorRunSummaries(collectorRuns),
    openAiUsage: openAiUsageSummary(metrics, costs),
    githubActionsUsage: githubActionsUsageSummary(metrics, projects),
    lastMonthCostUsd,
    mtdCostSeries: buildMtdCostSeries(costs),
  };
}
