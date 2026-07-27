import { Clock3, ExternalLink } from 'lucide-react';
import { STALE_AFTER_HOURS, formatRelativeSync, isStaleSync } from '../lib/status';
import type { ProjectStatus } from '../types';
import { StatusPill } from './StatusPill';

function isThisSite(publicUrl: string): boolean {
  try {
    return new URL(publicUrl).host === window.location.host;
  } catch {
    return false;
  }
}

export function ProjectCard({ project, selected, onSelect }: { project: ProjectStatus; selected: boolean; onSelect: () => void }) {
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
          {project.lastSync ? `Data is older than ${STALE_AFTER_HOURS} hours` : 'Waiting for first collector sync'}
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
