import { SiGithub } from 'react-icons/si';
import { formatCount, formatMinutes } from '../lib/format';
import { formatRelativeSync } from '../lib/status';
import { trendSummary } from '../lib/trend';
import type { GitHubActionsUsageSummary } from '../types';
import { StatusPill } from './StatusPill';
import { TrendChart } from './TrendChart';

export function GitHubActionsUsagePanel({ usage }: { usage: GitHubActionsUsageSummary }) {
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

      {/* Same caveat as the OpenAI trend: each point is that day's reported window total. */}
      <TrendChart
        title="Runtime minutes by collection day"
        points={usage.runtimeSeries}
        label="Workflow runtime minutes reported on each collection day"
        valueLabel={trendSummary(usage.runtimeSeries, formatMinutes)}
      />

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
