import { Globe } from 'lucide-react';
import { formatDnsBreakdown, formatDomainExpiry } from '../lib/format';
import { formatRelativeSync } from '../lib/status';
import type { DomainSummary } from '../types';
import { EmptyState } from './EmptyState';
import { StatusPill } from './StatusPill';

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

export function DomainsPanel({ domains }: { domains: DomainSummary[] }) {
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
