import {
  Activity,
  AlertTriangle,
  Bot,
  Clock3,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  Cloud,
  Database,
  DollarSign,
  ExternalLink,
  Globe,
  LayoutDashboard,
  KeyRound,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Server,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrencyUsd, formatRelativeSync, getOverallStatus, isStaleSync } from './lib/status';
import { isAllowedDashboardEmail, isSupabaseAuthConfigured, supabase } from './lib/supabase';
import { demoDashboardData } from './data/demoDashboardData';
import { fetchDashboardData } from './services/dashboardData';
import type {
  CollectorRunSummary,
  DomainSummary,
  GitHubActionsUsageSummary,
  OpenAiUsageSummary,
  ProjectSlug,
  ProjectStatus,
  ProviderKey,
  StatusLevel,
  UnallocatedCostSnapshot,
} from './types';
import { SiGithub } from 'react-icons/si';

const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const statusLabel: Record<StatusLevel, string> = {
  healthy: 'Healthy',
  warning: 'Needs attention',
  failed: 'Failed',
  unknown: 'Unknown',
};

const providerIcon: Record<ProviderKey, typeof Cloud | typeof SiGithub> = {
  aws: Cloud,
  amplify: Server,
  supabase: Database,
  resend: Server,
  cloudflare: Cloud,
  openai: Server,
  github: SiGithub,
  http: Activity,
};

interface CostRow {
  provider: ProviderKey;
  label: string;
  amountUsd: number | null;
}

type DashboardTab = 'detail' | 'collectors' | 'domains' | 'usage' | 'costs';

const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: 'detail', label: 'App Detail' },
  { id: 'collectors', label: 'Collectors' },
  { id: 'domains', label: 'Domains' },
  { id: 'usage', label: 'Usage' },
  { id: 'costs', label: 'Costs' },
];

function displayCostLabel(label: string | undefined): string {
  const normalized = label?.trim();

  if (!normalized || normalized.toLowerCase() === 'unknown' || normalized.toLowerCase() === 'unallocated') {
    return 'Cost line';
  }

  return normalized;
}

function collectorRunStatusLevel(status: CollectorRunSummary['status']): StatusLevel {
  if (status === 'success') {
    return 'healthy';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'partial_success') {
    return 'warning';
  }

  return 'unknown';
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'In progress or not recorded';
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMinutes(value: number | null): string {
  if (value === null) {
    return 'Unknown';
  }

  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)} min`;
}

function StatusPill({ status }: { status: StatusLevel }) {
  const Icon = status === 'healthy' ? CheckCircle2 : status === 'unknown' ? CircleHelp : AlertTriangle;

  return (
    <span className={`status-pill status-${status}`}>
      <Icon aria-hidden="true" size={15} />
      {statusLabel[status]}
    </span>
  );
}

function EmptyState({ message, title = 'No data yet' }: { message: string; title?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function isThisSite(publicUrl: string): boolean {
  try {
    return new URL(publicUrl).host === window.location.host;
  } catch {
    return false;
  }
}

function ProjectCard({ project, selected, onSelect }: { project: ProjectStatus; selected: boolean; onSelect: () => void }) {
  const stale = isStaleSync(project.lastSync);
  const selfHosted = isThisSite(project.publicUrl);
  const displayUrl = selfHosted ? 'This site' : project.publicUrl.replace('https://', '');

  return (
    <article className={`project-card ${selected ? 'project-card-selected' : ''}`}>
      <div className="project-card-header">
        <h2>{project.name}</h2>
        {project.publicUrl && !selfHosted ? (
          <a href={project.publicUrl} target="_blank" rel="noreferrer">
            {displayUrl}
            <ExternalLink aria-hidden="true" size={13} />
          </a>
        ) : project.publicUrl ? (
          <p className="project-url-missing">{displayUrl}</p>
        ) : (
          <p className="project-url-missing">No public URL recorded.</p>
        )}
      </div>

      {stale && (
        <div className="state-banner state-banner-warning">
          <Clock3 aria-hidden="true" size={15} />
          {project.lastSync ? 'Data is older than 24 hours' : 'Waiting for first collector sync'}
        </div>
      )}

      <div className="project-card-bottom">
        <dl className="project-metrics">
          <div>
            <dt>Deploy</dt>
            <dd>
              <StatusPill status={project.deployStatus} />
            </dd>
          </div>
          <div>
            <dt>Uptime</dt>
            <dd>
              <StatusPill status={project.uptimeStatus} />
            </dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{formatRelativeSync(project.lastSync)}</dd>
          </div>
        </dl>

        <button className="detail-button" type="button" onClick={onSelect} aria-pressed={selected}>
          View detail
        </button>
      </div>
    </article>
  );
}

function AppDetail({ project }: { project: ProjectStatus }) {
  const partialFailure = project.providers.some((provider) => provider.status === 'warning' || provider.status === 'failed');

  return (
    <section className="detail-panel" aria-label="App detail">
      <div className="section-heading">
        <Server aria-hidden="true" size={18} />
        <h2>{project.name} Detail</h2>
      </div>

      {partialFailure && (
        <div className="state-banner state-banner-warning">
          <AlertTriangle aria-hidden="true" size={15} />
          One or more providers need attention. Other providers can continue syncing.
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-section">
          <h3>Providers</h3>
          {project.providers.length === 0 ? (
            <EmptyState message="Run a collector or check provider credentials to populate provider status." />
          ) : (
            <div className="provider-list provider-list-detail">
              {project.providers.map((provider) => {
                const Icon = providerIcon[provider.provider] ?? CircleHelp;

                return (
                  <div className="provider-row" key={`${project.slug}-${provider.provider}-${provider.label}`}>
                    <div className="provider-icon">
                      <Icon aria-hidden="true" size={17} />
                    </div>
                    <div>
                      <strong>{provider.label}</strong>
                      <span>{provider.detail}</span>
                    </div>
                    <StatusPill status={provider.status} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="detail-section">
          <h3>Resources</h3>
          {project.resources.length === 0 ? (
            <EmptyState message="Collectors have not written resource inventory for this app." />
          ) : (
            <div className="compact-list">
              {project.resources.map((resource) => (
                <div className="compact-row" key={resource.id}>
                  <div>
                    <strong>{resource.name}</strong>
                    <span>
                      {resource.provider.toUpperCase()} - {resource.type} - {resource.detail}
                    </span>
                  </div>
                  <StatusPill status={resource.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="detail-section">
          <h3>Recent Snapshots</h3>
          {project.recentSnapshots.length === 0 ? (
            <EmptyState message="Metric snapshots will appear after a successful collector run." />
          ) : (
            <div className="compact-list">
              {project.recentSnapshots.map((snapshot) => (
                <div className="compact-row" key={`${snapshot.provider}-${snapshot.label}`}>
                  <div>
                    <strong>{snapshot.label}</strong>
                    <span>
                      {snapshot.provider.toUpperCase()} - {snapshot.value} - {formatRelativeSync(snapshot.collectedAt)}
                    </span>
                  </div>
                  <StatusPill status={snapshot.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="detail-section">
          <h3>Collector Errors</h3>
          {project.collectorErrors.length === 0 ? (
            <EmptyState message="No collector failures have been written for this app." title="No errors recorded" />
          ) : (
            <div className="compact-list">
              {project.collectorErrors.map((error) => (
                <div className="compact-row" key={`${error.provider}-${error.message}`}>
                  <div>
                    <strong>{error.provider.toUpperCase()}</strong>
                    <span>
                      {error.message} - {formatRelativeSync(error.occurredAt)}
                    </span>
                  </div>
                  <StatusPill status="warning" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ProviderSettings({ projects }: { projects: ProjectStatus[] }) {
  const providerRows = projects.flatMap((project) =>
    project.providers.map((provider, index) => ({
      project,
      provider,
      index,
    })),
  );

  return (
    <section className="settings-panel" aria-label="Provider settings">
      <div className="section-heading">
        <KeyRound aria-hidden="true" size={18} />
        <h2>Provider Settings</h2>
      </div>
      {providerRows.length === 0 ? (
        <div className="panel-empty">
          <EmptyState message="No provider rows are available. Check the database seed, RLS access, or collector setup." />
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Provider</th>
              <th>Last sync</th>
            </tr>
          </thead>
          <tbody>
            {providerRows.map(({ project, provider, index }) => (
              <tr key={`${project.slug}-${provider.provider}-${provider.label}`}>
                {index === 0 && (
                  <td className="project-name-cell" rowSpan={project.providers.length}>
                    {project.name}
                  </td>
                )}
                <td>{provider.label}</td>
                <td>{formatRelativeSync(provider.lastSync)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatDomainExpiry(domain: DomainSummary): string {
  if (!domain.expiresAt) {
    return 'Unknown';
  }

  const date = new Intl.DateTimeFormat('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(domain.expiresAt));

  return domain.expirationDays === null ? date : `${date} (${domain.expirationDays}d)`;
}

function formatDnsBreakdown(domain: DomainSummary): string {
  if (domain.dnsRecordCount === null) {
    return 'No DNS data yet';
  }

  const parts = [`${domain.dnsRecordCount} total`];

  if (domain.proxiedRecordCount !== null) {
    parts.push(`${domain.proxiedRecordCount} proxied`);
  }

  if (domain.mxRecordCount !== null) {
    parts.push(`${domain.mxRecordCount} MX`);
  }

  if (domain.apexRecordPresent === false) {
    parts.push('apex missing');
  }

  if (domain.wwwRecordPresent === false) {
    parts.push('www missing');
  }

  return parts.join(', ');
}

function DomainBlock({ domain }: { domain: DomainSummary }) {
  return (
    <div className="domain-block">
      <div className="domain-summary-heading">
        <h3>{domain.domain}</h3>
        <StatusPill status={domain.status} />
      </div>
      <dl className="domain-summary-grid">
        <div>
          <dt>Registrar</dt>
          <dd>{domain.registrar ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatDomainExpiry(domain)}</dd>
        </div>
        <div>
          <dt>Auto-renew</dt>
          <dd>{domain.autoRenew === null ? 'Unknown' : domain.autoRenew ? 'On' : 'Off'}</dd>
        </div>
        <div>
          <dt>Locked</dt>
          <dd>{domain.locked === null ? 'Unknown' : domain.locked ? 'Locked' : 'Unlocked'}</dd>
        </div>
        <div>
          <dt>Zone status</dt>
          <dd>{domain.zoneStatus}</dd>
        </div>
        <div>
          <dt>DNS records</dt>
          <dd>{formatDnsBreakdown(domain)}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>{formatRelativeSync(domain.lastSync)}</dd>
        </div>
      </dl>
      {domain.dnsRecords.length === 0 ? (
        <div className="panel-empty">
          <EmptyState message="No DNS records collected for this domain yet." />
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Proxied</th>
            </tr>
          </thead>
          <tbody>
            {domain.dnsRecords.map((record, index) => (
              <tr key={`${record.type}-${record.name}-${index}`}>
                <td>{record.type}</td>
                <td>{record.name}</td>
                <td>{record.proxied === null ? 'Unknown' : record.proxied ? 'Proxied' : 'DNS only'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DomainsPanel({ domains }: { domains: DomainSummary[] }) {
  return (
    <section className="settings-panel" aria-label="Domains">
      <div className="section-heading">
        <Globe aria-hidden="true" size={18} />
        <h2>Domains</h2>
      </div>
      {domains.length === 0 ? (
        <div className="panel-empty">
          <EmptyState message="No Cloudflare domains are configured, or the domain collector has not run yet." />
        </div>
      ) : (
        domains.map((domain) => <DomainBlock key={domain.domain} domain={domain} />)
      )}
    </section>
  );
}

function CollectorDiagnostics({ collectorRuns, projects }: { collectorRuns: CollectorRunSummary[]; projects: ProjectStatus[] }) {
  const projectNameBySlug = new Map(projects.map((project) => [project.slug, project.name]));
  const latestRun = collectorRuns[0] ?? null;
  const failingRuns = collectorRuns.filter((run) => run.status === 'failed' || run.status === 'partial_success').length;
  const syncedRuns = collectorRuns.filter((run) => run.status === 'success').length;
  const projectsWithErrors = new Set(collectorRuns.flatMap((run) => run.affectedProjects)).size;

  return (
    <section className="diagnostics-panel" aria-label="Collector diagnostics">
      <div className="section-heading">
        <ClipboardList aria-hidden="true" size={18} />
        <h2>Collector Diagnostics</h2>
      </div>

      <div className="diagnostics-summary">
        <div>
          <span>Latest run</span>
          <strong>{latestRun ? formatRelativeSync(latestRun.startedAt) : 'Never run'}</strong>
        </div>
        <div>
          <span>Providers synced</span>
          <strong>
            {syncedRuns}/{collectorRuns.length}
          </strong>
        </div>
        <div>
          <span>Runs needing attention</span>
          <strong>{failingRuns}</strong>
        </div>
        <div>
          <span>Projects with errors</span>
          <strong>{projectsWithErrors}</strong>
        </div>
      </div>

      {collectorRuns.length === 0 ? (
        <div className="panel-empty">
          <EmptyState
            title="No collector runs recorded"
            message="After the first collector execution, this panel will show provider-level run status, duration, errors, and latest sync time."
          />
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Latest run</th>
              <th>Last synced</th>
              <th>Duration</th>
              <th>Projects</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {collectorRuns.map((run) => {
              const affectedProjectNames = run.affectedProjects
                .map((slug) => projectNameBySlug.get(slug) ?? slug.replace(/_/g, ' '))
                .join(', ');
              const message = run.errorMessage ?? run.summary ?? 'No run summary recorded.';

              return (
                <tr key={`${run.provider}-${run.startedAt}`}>
                  <td>{run.providerLabel}</td>
                  <td>
                    <div className="table-status-cell">
                      <StatusPill status={collectorRunStatusLevel(run.status)} />
                    </div>
                  </td>
                  <td>{formatRelativeSync(run.lastSyncedAt)}</td>
                  <td>{formatDuration(run.durationMs)}</td>
                  <td>{affectedProjectNames || 'No project-scoped errors'}</td>
                  <td className="run-message">{message}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function OpenAiUsagePanel({ usage }: { usage: OpenAiUsageSummary }) {
  return (
    <section className="openai-panel" aria-label="OpenAI usage">
      <div className="section-heading">
        <Bot aria-hidden="true" size={18} />
        <h2>OpenAI Usage</h2>
      </div>

      <div className="openai-summary">
        <div>
          <span>Total tokens</span>
          <strong>{formatCount(usage.totalTokens)}</strong>
        </div>
        <div>
          <span>Cached input</span>
          <strong>{formatCount(usage.cachedInputTokens)}</strong>
        </div>
        <div>
          <span>Requests</span>
          <strong>{formatCount(usage.requests)}</strong>
        </div>
        <div>
          <span>Spend</span>
          <strong>{formatCurrencyUsd(usage.spendUsd)}</strong>
        </div>
        <div>
          <span>Last month usage</span>
          <strong>{usage.lastMonthTokens === null ? 'Unknown' : formatCount(usage.lastMonthTokens)}</strong>
        </div>
        <div>
          <span>Last month cost</span>
          <strong>{formatCurrencyUsd(usage.lastMonthSpendUsd)}</strong>
        </div>
      </div>

      {usage.rows.length === 0 ? (
        <div className="panel-empty">
          <EmptyState
            message="No OpenAI usage rows are available. Configure the admin key and run the status collector."
            title="No OpenAI usage"
          />
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>API key</th>
              <th>Model</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cached</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map((row) => (
              <tr key={`${row.apiKeyLabel}-${row.model}`}>
                <td>{row.apiKeyLabel}</td>
                <td>{row.model}</td>
                <td>{formatCount(row.inputTokens)}</td>
                <td>{formatCount(row.outputTokens)}</td>
                <td>{formatCount(row.cachedInputTokens)}</td>
                <td>{formatCount(row.requests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function GitHubActionsUsagePanel({ usage }: { usage: GitHubActionsUsageSummary }) {
  if (usage.rows.length === 0) {
    return null;
  }

  return (
    <section className="github-panel" aria-label="GitHub Actions usage">
      <div className="section-heading">
        <SiGithub aria-hidden="true" size={18} />
        <h2>GitHub Actions Usage</h2>
      </div>

      <div className="github-summary">
        <div>
          <span>Runtime minutes</span>
          <strong>{formatMinutes(usage.runtimeMinutes)}</strong>
        </div>
        <div>
          <span>Recent failures</span>
          <strong>{formatCount(usage.recentFailures)}</strong>
        </div>
        <div>
          <span>Recent runs</span>
          <strong>{formatCount(usage.recentRuns)}</strong>
        </div>
        <div>
          <span>Last sync</span>
          <strong>{formatRelativeSync(usage.lastSync)}</strong>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Repository</th>
            <th>Status</th>
            <th>Latest run</th>
            <th>Runs</th>
            <th>Scheduled</th>
            <th>Runtime</th>
          </tr>
        </thead>
        <tbody>
          {usage.rows.map((row) => (
            <tr key={`${row.projectSlug}-${row.repository}`}>
              <td>{row.projectName}</td>
              <td>{row.repository}</td>
              <td>
                <div className="table-status-cell">
                  <StatusPill status={row.status} />
                </div>
              </td>
              <td>{row.latestRun}</td>
              <td>
                {row.recentRuns === null
                  ? 'Unknown'
                  : `${formatCount(row.recentRuns - (row.recentFailures ?? 0))}/${formatCount(row.recentRuns)}`}
              </td>
              <td>
                {row.scheduledRuns === null
                  ? 'Unknown'
                  : `${formatCount(row.scheduledRuns - (row.scheduledFailures ?? 0))}/${formatCount(row.scheduledRuns)}`}
              </td>
              <td>{formatMinutes(row.runtimeMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CostSummary({
  costRows,
  monthToDateCost,
  lastMonthCostUsd,
}: {
  costRows: CostRow[];
  monthToDateCost: number;
  lastMonthCostUsd: number | null;
}) {
  const largestCost = costRows[0] ?? null;

  return (
    <div className="cost-summary">
      <div>
        <span>MTD cost</span>
        <strong>{formatCurrencyUsd(monthToDateCost)}</strong>
      </div>
      <div>
        <span>Cost lines</span>
        <strong>{costRows.length}</strong>
      </div>
      <div>
        <span>Last month cost</span>
        <strong>{formatCurrencyUsd(lastMonthCostUsd)}</strong>
      </div>
      <div className="cost-summary-wide">
        <span>Largest line</span>
        <strong>{largestCost ? `${largestCost.label} - ${formatCurrencyUsd(largestCost.amountUsd)}` : 'No cost rows'}</strong>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const client = supabase;

    if (!client || !isSupabaseAuthConfigured) {
      setLoading(false);
      return;
    }

    void client.auth.getSession().then(({ data }) => {
      const currentSession = data.session;

      if (currentSession && !isAllowedDashboardEmail(currentSession.user.email)) {
        void client.auth.signOut();
        setAuthMessage('This account is not allowed to view the dashboard.');
        setSession(null);
      } else {
        setSession(currentSession);
      }

      setLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession && !isAllowedDashboardEmail(nextSession.user.email)) {
        void client.auth.signOut();
        setAuthMessage('This account is not allowed to view the dashboard.');
        setSession(null);
        return;
      }

      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const client = supabase;

    if (!client) {
      setAuthMessage('Supabase auth is not configured.');
      return;
    }

    setSubmitting(true);
    setAuthMessage('');

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthMessage(error.message);
    } else if (!isAllowedDashboardEmail(data.user.email)) {
      await client.auth.signOut();
      setAuthMessage('This account is not allowed to view the dashboard.');
    } else {
      setSession(data.session);
    }

    setSubmitting(false);
  }

  if (loading) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <RefreshCw aria-hidden="true" size={22} />
          <h1>StackVitals</h1>
          <p>Checking private dashboard session.</p>
        </div>
      </main>
    );
  }

  if (!supabase || !isSupabaseAuthConfigured) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <LockKeyhole aria-hidden="true" size={26} />
          <h1>StackVitals</h1>
          <p>Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_DASHBOARD_ALLOWED_EMAIL` before deployment.</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={handleSignIn}>
          <LockKeyhole aria-hidden="true" size={26} />
          <h1>StackVitals</h1>
          <p className="brand-subtitle">Stack Status Hub</p>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {authMessage && <p className="auth-message">{authMessage}</p>}
          <button className="refresh-button" disabled={submitting} type="submit">
            <LockKeyhole aria-hidden="true" size={16} />
            {submitting ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </main>
    );
  }

  const client = supabase;

  if (!client) {
    return null;
  }

  return (
    <>
      <div className="session-bar">
        <span>{session.user.email}</span>
        <button className="table-action-button" type="button" onClick={() => void client.auth.signOut()}>
          <LogOut aria-hidden="true" size={14} />
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}

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
  const costRows: CostRow[] = [
    ...projects.flatMap((project) =>
      project.costs.map((cost) => ({
        provider: cost.provider,
        label: displayCostLabel(cost.serviceName),
        amountUsd: cost.monthToDateUsd,
      })),
    ),
    ...unallocatedCosts.map((cost) => ({
      provider: cost.provider,
      label: displayCostLabel(cost.serviceName),
      amountUsd: cost.monthToDateUsd,
    })),
  ]
    .filter((row) => (row.amountUsd ?? 0) > 0)
    .sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0));
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

      <section className="summary-grid" aria-label="Summary">
        <div className="summary-panel">
          <span>Tracked apps</span>
          <strong>{projects.length}</strong>
        </div>
        <div className="summary-panel">
          <span>Healthy apps</span>
          <strong>{healthyProjects}</strong>
        </div>
        <div className="summary-panel">
          <span>Needs attention</span>
          <strong>{providersNeedingAttention}</strong>
        </div>
        <div className="summary-panel">
          <span>MTD cost</span>
          <strong>{formatCurrencyUsd(monthToDateCost)}</strong>
        </div>
      </section>

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
          <section className="cost-panel" aria-label="Cost breakdown">
            <div className="section-heading">
              <DollarSign aria-hidden="true" size={18} />
              <h2>Cost Snapshot</h2>
            </div>
            {costRows.length === 0 ? (
              <div className="panel-empty">
                <EmptyState
                  message="No cost rows are available. Run the cost collector or check provider credentials."
                  title="No cost rows"
                />
              </div>
            ) : (
              <>
                <CostSummary costRows={costRows} monthToDateCost={monthToDateCost} lastMonthCostUsd={lastMonthCostUsd} />
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Cost line</th>
                      <th>Month to date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costRows.map((cost, index) => (
                      <tr key={`${cost.provider}-${cost.label}-${index}`}>
                        <td>{cost.provider.toUpperCase()}</td>
                        <td>{cost.label}</td>
                        <td>{formatCurrencyUsd(cost.amountUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
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
