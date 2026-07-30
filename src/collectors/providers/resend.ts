import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

/**
 * Sending-domain verification status only.
 *
 * Aggregate delivery counts are not collectable within this project's boundaries. Resend
 * exposes no analytics or statistics endpoint; `GET /emails` returns raw per-message rows
 * (recipient addresses, subjects) with no date or tag filter, so counting deliveries would
 * mean paging the account's whole send history and reading exactly the recipient data this
 * tool promises never to touch. The only aggregate path Resend documents is streaming
 * webhook events into your own database, which needs an always-on receiver. Both options
 * are ruled out by the project's non-goals, so the counts are not collected at all rather
 * than reported as zero.
 */

export interface ResendTarget {
  projectSlug: ProjectSlug;
  domain: string;
}

export interface ResendDomainStatus {
  domain: string;
  status: 'verified' | 'pending' | 'failed' | 'unknown';
  region?: string;
}

export interface ResendClient {
  getDomainStatus: (domain: string) => Promise<ResendDomainStatus>;
}

export interface ResendOptions {
  client: ResendClient;
}

function domainStatusLevel(status: ResendDomainStatus['status']): StatusLevel {
  if (status === 'verified') {
    return 'healthy';
  }

  if (status === 'pending' || status === 'unknown') {
    return 'warning';
  }

  return 'failed';
}

export async function collectResendDomainHealth(targets: ResendTarget[], options: ResendOptions): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      try {
        const domain = await options.client.getDomainStatus(target.domain);

        resources.push({
          projectSlug: target.projectSlug,
          provider: 'resend',
          resourceType: 'email_domain',
          externalId: domain.domain,
          displayName: domain.domain,
          metadata: {
            status: domain.status,
            region: domain.region,
          },
        });

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'resend',
          metricKey: 'resend_domain_verified',
          metricValue: domain.status === 'verified' ? 1 : 0,
          status: domainStatusLevel(domain.status),
          metadata: {
            domain: domain.domain,
            region: domain.region,
          },
          collectedAt,
        });
      } catch (error) {
        const message = getErrorMessage(error, 'Resend collection failed');

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'resend',
          metricKey: 'resend_domain_status_available',
          metricValue: 0,
          status: 'failed',
          metadata: {
            domain: target.domain,
          },
          collectedAt,
        });
        errors.push({
          projectSlug: target.projectSlug,
          message,
          retryable: true,
        });
      }
    }),
  );

  const failedTargets = errors.length;

  return {
    provider: 'resend',
    status: deriveResultStatus(metrics, errors),
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No Resend domains configured.'
        : `${targets.length - failedTargets}/${targets.length} Resend domains collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createResendDomainHealthAdapter(targets: ResendTarget[], options: ResendOptions): ProviderAdapter {
  return {
    provider: 'resend',
    collect: () => collectResendDomainHealth(targets, options),
  };
}
