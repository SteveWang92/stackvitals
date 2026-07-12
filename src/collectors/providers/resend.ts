import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

export interface ResendTarget {
  projectSlug: ProjectSlug;
  domain: string;
  verificationCategory: string;
}

export interface ResendDomainStatus {
  domain: string;
  status: 'verified' | 'pending' | 'failed' | 'unknown';
  region?: string;
}

export interface ResendDeliveryCounts {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
}

export interface ResendClient {
  getDomainStatus: (domain: string) => Promise<ResendDomainStatus>;
  getVerificationEmailCounts: (input: { domain: string; category: string }) => Promise<ResendDeliveryCounts>;
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

function deliveryStatusLevel(counts: ResendDeliveryCounts): StatusLevel {
  if (counts.failed > 0 || counts.bounced > 0 || counts.complained > 0) {
    return 'warning';
  }

  return 'healthy';
}

function deliveryMetrics(target: ResendTarget, counts: ResendDeliveryCounts, collectedAt: string): CollectorMetric[] {
  const status = deliveryStatusLevel(counts);
  const metadata = {
    domain: target.domain,
    category: target.verificationCategory,
    aggregateOnly: true,
  };

  return [
    {
      projectSlug: target.projectSlug,
      provider: 'resend',
      metricKey: 'resend_verification_email_sent_count',
      metricValue: counts.sent,
      status,
      metadata,
      collectedAt,
    },
    {
      projectSlug: target.projectSlug,
      provider: 'resend',
      metricKey: 'resend_verification_email_delivered_count',
      metricValue: counts.delivered,
      status,
      metadata,
      collectedAt,
    },
    {
      projectSlug: target.projectSlug,
      provider: 'resend',
      metricKey: 'resend_verification_email_bounced_count',
      metricValue: counts.bounced,
      status,
      metadata,
      collectedAt,
    },
    {
      projectSlug: target.projectSlug,
      provider: 'resend',
      metricKey: 'resend_verification_email_failed_count',
      metricValue: counts.failed,
      status,
      metadata,
      collectedAt,
    },
  ];
}

export async function collectResendVerificationEmailHealth(
  targets: ResendTarget[],
  options: ResendOptions,
): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();

      try {
        const [domain, counts] = await Promise.all([
          options.client.getDomainStatus(target.domain),
          options.client.getVerificationEmailCounts({
            domain: target.domain,
            category: target.verificationCategory,
          }),
        ]);
        const domainLevel = domainStatusLevel(domain.status);

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

        metrics.push(
          {
            projectSlug: target.projectSlug,
            provider: 'resend',
            metricKey: 'resend_domain_verified',
            metricValue: domain.status === 'verified' ? 1 : 0,
            status: domainLevel,
            metadata: {
              domain: domain.domain,
              region: domain.region,
            },
            collectedAt,
          },
          ...deliveryMetrics(target, counts, collectedAt),
        );
      } catch (error) {
        const message = getErrorMessage(error, 'Resend collection failed');

        metrics.push({
          projectSlug: target.projectSlug,
          provider: 'resend',
          metricKey: 'resend_verification_email_health_available',
          metricValue: 0,
          status: 'failed',
          metadata: {
            domain: target.domain,
            category: target.verificationCategory,
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
        ? 'No Resend verification email targets configured.'
        : `${targets.length - failedTargets}/${targets.length} Resend verification email targets collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createResendVerificationEmailAdapter(targets: ResendTarget[], options: ResendOptions): ProviderAdapter {
  return {
    provider: 'resend',
    collect: () => collectResendVerificationEmailHealth(targets, options),
  };
}
