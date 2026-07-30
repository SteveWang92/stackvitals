import { KeyRound } from 'lucide-react';
import { formatRelativeSync } from '../lib/status';
import type { ProjectStatus } from '../types';
import { EmptyState } from './EmptyState';
import { StaleBadge } from './StaleBadge';

export function ProviderSettings({ projects }: { projects: ProjectStatus[] }) {
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
                <td>
                  <div className="table-sync-cell">
                    {formatRelativeSync(provider.lastSync)}
                    <StaleBadge freshness={provider.freshness} lastSync={provider.lastSync} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
