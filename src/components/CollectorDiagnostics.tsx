import { ClipboardList } from 'lucide-react';
import { formatDuration } from '../lib/format';
import { collectorRunStatusLevel, formatRelativeSync } from '../lib/status';
import type { CollectorRunSummary, ProjectStatus } from '../types';
import { EmptyState } from './EmptyState';
import { StatusPill } from './StatusPill';

export function CollectorDiagnostics({ collectorRuns, projects }: { collectorRuns: CollectorRunSummary[]; projects: ProjectStatus[] }) {
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
