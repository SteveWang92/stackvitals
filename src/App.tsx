import { AlertTriangle, LayoutDashboard, RefreshCw, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOverallStatus } from './lib/status';
import { buildCostRows } from './lib/costRows';
import { supabase } from './lib/supabase';
import { demoDashboardData } from './data/demoDashboardData';
import { fetchDashboardData } from './services/dashboardData';
import type {
  CollectorRunSummary,
  CostPoint,
  DomainSummary,
  GitHubActionsUsageSummary,
  OpenAiUsageSummary,
  ProjectSlug,
  ProjectStatus,
  UnallocatedCostSnapshot,
} from './types';
import { AppDetail } from './components/AppDetail';
import { AuthGate } from './components/AuthGate';
import { CollectorDiagnostics } from './components/CollectorDiagnostics';
import { CostPanel } from './components/CostPanel';
import { DomainsPanel } from './components/DomainsPanel';
import { EmptyState } from './components/EmptyState';
import { GitHubActionsUsagePanel } from './components/GitHubActionsUsagePanel';
import { OpenAiUsagePanel } from './components/OpenAiUsagePanel';
import { ProjectCard } from './components/ProjectCard';
import { ProviderSettings } from './components/ProviderSettings';
import { SummaryTiles } from './components/SummaryTiles';

const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

type DashboardTab = 'detail' | 'collectors' | 'domains' | 'usage' | 'costs';

const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: 'detail', label: 'App Detail' },
  { id: 'collectors', label: 'Collectors' },
  { id: 'domains', label: 'Domains' },
  { id: 'usage', label: 'Usage' },
  { id: 'costs', label: 'Costs' },
];

function Dashboard() {
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [unallocatedCosts, setUnallocatedCosts] = useState<UnallocatedCostSnapshot[]>([]);
  const [collectorRuns, setCollectorRuns] = useState<CollectorRunSummary[]>([]);
  const [openAiUsage, setOpenAiUsage] = useState<OpenAiUsageSummary>({
    totalTokens: 0,
    cachedInputTokens: 0,
    requests: 0,
    spendUsd: null,
    lastMonthTokens: null,
    lastMonthSpendUsd: null,
    lastSync: null,
    rows: [],
  });
  const [githubActionsUsage, setGitHubActionsUsage] = useState<GitHubActionsUsageSummary>({
    runtimeMinutes: 0,
    recentRuns: 0,
    recentFailures: 0,
    lastSync: null,
    rows: [],
  });
  const [lastMonthCostUsd, setLastMonthCostUsd] = useState<number | null>(null);
  const [mtdCostSeries, setMtdCostSeries] = useState<CostPoint[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<ProjectSlug | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>('detail');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState('');
  const selectedProject = useMemo(
    () => projects.find((project) => project.slug === selectedSlug) ?? projects[0] ?? null,
    [projects, selectedSlug],
  );
  const healthyProjects = projects.filter((project) => getOverallStatus([project.deployStatus, project.uptimeStatus]) === 'healthy').length;
  const providersNeedingAttention = projects
    .flatMap((project) => project.providers)
    .filter((provider) => provider.status === 'warning' || provider.status === 'failed').length;
  const costRows = buildCostRows(projects, unallocatedCosts);
  const monthToDateCost = costRows.reduce((total, row) => total + (row.amountUsd ?? 0), 0);

  const loadDashboardData = useCallback(async () => {
    const client = supabase;

    if (!client && !isDemoMode) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    setDataError('');

    try {
      const liveData = isDemoMode || !client ? demoDashboardData : await fetchDashboardData(client);
      const liveProjects = liveData.projects;

      setProjects(liveProjects);
      setDomains(liveData.domains);
      setUnallocatedCosts(liveData.unallocatedCosts);
      setCollectorRuns(liveData.collectorRuns);
      setOpenAiUsage(liveData.openAiUsage);
      setGitHubActionsUsage(liveData.githubActionsUsage);
      setLastMonthCostUsd(liveData.lastMonthCostUsd);
      setMtdCostSeries(liveData.mtdCostSeries);
      setSelectedSlug((current) => liveProjects.find((project) => project.slug === current)?.slug ?? liveProjects[0]?.slug ?? null);
    } catch (error: unknown) {
      setDataError(error instanceof Error ? error.message : 'Dashboard data failed to load.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-heading">
          <div className="app-icon" aria-hidden="true">
            <LayoutDashboard size={24} />
          </div>
          <div>
            <h1>StackVitals{isDemoMode && <span className="demo-badge">Demo</span>}</h1>
            <p className="brand-subtitle">Stack Status Hub</p>
            <p>Uptime, deploys, cost, and usage for your web projects.</p>
          </div>
        </div>
        <button
          className="refresh-button"
          type="button"
          disabled={refreshing}
          onClick={() =>
            void (async () => {
              setRefreshing(true);
              await loadDashboardData();
              setRefreshing(false);
            })()
          }
        >
          <RefreshCw aria-hidden="true" size={16} />
          {refreshing ? 'Refreshing' : 'Refresh now'}
        </button>
      </header>

      {refreshing && (
        <div className="state-banner state-banner-loading">
          <RefreshCw aria-hidden="true" size={15} />
          Refreshing dashboard data from Supabase.
        </div>
      )}

      {loadingData && (
        <div className="state-banner state-banner-loading">
          <RefreshCw aria-hidden="true" size={15} />
          Loading latest collector data.
        </div>
      )}

      {dataError && (
        <div className="state-banner state-banner-warning">
          <AlertTriangle aria-hidden="true" size={15} />
          Live data unavailable: {dataError}
        </div>
      )}

      {!loadingData && !dataError && projects.length === 0 && (
        <section className="empty-dashboard" aria-label="No dashboard data">
          <EmptyState
            title="No dashboard rows available"
            message="The database is reachable, but it returned no active projects. Seed the hub database or run the collectors before using this view."
          />
        </section>
      )}

      <SummaryTiles
        trackedApps={projects.length}
        healthyProjects={healthyProjects}
        providersNeedingAttention={providersNeedingAttention}
        monthToDateCost={monthToDateCost}
      />

      <section className="project-grid" aria-label="Projects">
        {projects.length === 0 ? (
          <div className="project-grid-empty">
            <EmptyState message="No project cards can be shown until active project rows exist in Supabase." />
          </div>
        ) : (
          projects.map((project) => (
            <ProjectCard
              key={project.slug}
              project={project}
              selected={project.slug === selectedProject?.slug}
              onSelect={() => setSelectedSlug(project.slug)}
            />
          ))
        )}
      </section>

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        {dashboardTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="dashboard-tab"
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="dashboard-tab-panel">
        {activeTab === 'detail' &&
          (selectedProject ? (
            <AppDetail project={selectedProject} />
          ) : (
            <section className="detail-panel" aria-label="App detail">
              <div className="section-heading">
                <Server aria-hidden="true" size={18} />
                <h2>App Detail</h2>
              </div>
              <div className="panel-empty">
                <EmptyState message="Select a project after database rows are available." />
              </div>
            </section>
          ))}

        {activeTab === 'collectors' && (
          <>
            <CollectorDiagnostics collectorRuns={collectorRuns} projects={projects} />
            <ProviderSettings projects={projects} />
          </>
        )}

        {activeTab === 'domains' && <DomainsPanel domains={domains} />}

        {activeTab === 'usage' && (
          <>
            <OpenAiUsagePanel usage={openAiUsage} />
            <GitHubActionsUsagePanel usage={githubActionsUsage} />
          </>
        )}

        {activeTab === 'costs' && (
          <CostPanel
            costRows={costRows}
            monthToDateCost={monthToDateCost}
            lastMonthCostUsd={lastMonthCostUsd}
            mtdCostSeries={mtdCostSeries}
          />
        )}
      </div>
    </main>
  );
}

export function App() {
  if (isDemoMode) {
    return <Dashboard />;
  }

  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}
