import { AlertTriangle, Server } from 'lucide-react';
import { formatLatencyScale, formatLatencySummary } from '../lib/format';
import { formatRelativeSync } from '../lib/status';
import type { ProjectStatus } from '../types';
import { EmptyState } from './EmptyState';
import { Sparkline } from './Sparkline';
import { StaleBadge } from './StaleBadge';
import { StatusPill } from './StatusPill';
import { UptimeStrip } from './UptimeStrip';
import { providerIcon } from './providerIcon';

export function AppDetail({ project }: { project: ProjectStatus }) {
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
        <div className="detail-section detail-section-wide">
          <h3>History</h3>
          <div className="history-panel">
            <div>
              <h4>Median response time</h4>
              <Sparkline
                points={project.history.latency.map((point) => point.p50Ms)}
                label={`Median response time, last ${project.history.windowDays} days`}
                valueLabel={formatLatencySummary(project.history.latency)}
                formatValue={formatLatencyScale}
                width={320}
                height={56}
              />
            </div>
            <div>
              <h4>Uptime</h4>
              <UptimeStrip days={project.history.uptime} label={`Uptime, last ${project.history.windowDays} days`} />
            </div>
          </div>
        </div>

        <div className="detail-section">
          <h3>Providers</h3>
          {project.providers.length === 0 ? (
            <EmptyState message="Run a collector or check provider credentials to populate provider status." />
          ) : (
            <div className="provider-list provider-list-detail">
              {project.providers.map((provider) => {
                const Icon = providerIcon[provider.provider];

                return (
                  <div className="provider-row" key={`${project.slug}-${provider.provider}-${provider.label}`}>
                    <div className="provider-icon">
                      <Icon aria-hidden="true" size={17} />
                    </div>
                    <div>
                      <strong>{provider.label}</strong>
                      <span>{provider.detail}</span>
                    </div>
                    <StaleBadge freshness={provider.freshness} lastSync={provider.lastSync} />
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
