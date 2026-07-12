import { describe, expect, it, vi } from 'vitest';
import {
  collectResendVerificationEmailHealth,
  type ResendClient,
  type ResendDeliveryCounts,
  type ResendDomainStatus,
} from '../../../collectors/providers/resend';

function createClient(
  options: {
    domain?: ResendDomainStatus;
    counts?: ResendDeliveryCounts;
    error?: string;
  } = {},
): ResendClient {
  if (options.error) {
    return {
      getDomainStatus: vi.fn().mockRejectedValue(new Error(options.error)),
      getVerificationEmailCounts: vi.fn().mockRejectedValue(new Error(options.error)),
    };
  }

  return {
    getDomainStatus: vi.fn().mockResolvedValue(
      options.domain ?? {
        domain: 'mail.example.test',
        status: 'verified',
        region: 'us-east-1',
      },
    ),
    getVerificationEmailCounts: vi.fn().mockResolvedValue(
      options.counts ?? {
        sent: 10,
        delivered: 10,
        bounced: 0,
        complained: 0,
        failed: 0,
      },
    ),
  };
}

describe('collectResendVerificationEmailHealth', () => {
  it('collects aggregate-only Resend domain and delivery metrics', async () => {
    const client = createClient();

    const result = await collectResendVerificationEmailHealth(
      [{ projectSlug: 'todo_app', domain: 'mail.example.test', verificationCategory: 'verification_email' }],
      { client },
    );

    expect(client.getDomainStatus).toHaveBeenCalledWith('mail.example.test');
    expect(client.getVerificationEmailCounts).toHaveBeenCalledWith({
      domain: 'mail.example.test',
      category: 'verification_email',
    });
    expect(result.status).toBe('success');
    expect(result.resources).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'resend',
        resourceType: 'email_domain',
        externalId: 'mail.example.test',
        displayName: 'mail.example.test',
        metadata: {
          status: 'verified',
          region: 'us-east-1',
        },
      },
    ]);
    expect(result.metrics.map((metric) => metric.metricKey)).toEqual([
      'resend_domain_verified',
      'resend_verification_email_sent_count',
      'resend_verification_email_delivered_count',
      'resend_verification_email_bounced_count',
      'resend_verification_email_failed_count',
    ]);
    expect(result.metrics.every((metric) => JSON.stringify(metric).includes('@') === false)).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('marks delivery problems as warning without storing raw event payloads', async () => {
    const result = await collectResendVerificationEmailHealth(
      [{ projectSlug: 'todo_app', domain: 'mail.example.test', verificationCategory: 'verification_email' }],
      {
        client: createClient({
          counts: {
            sent: 12,
            delivered: 10,
            bounced: 1,
            complained: 0,
            failed: 1,
          },
        }),
      },
    );

    expect(result.status).toBe('partial_success');
    expect(result.metrics.filter((metric) => metric.metricKey !== 'resend_domain_verified')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'resend_verification_email_bounced_count',
          metricValue: 1,
          status: 'warning',
          metadata: {
            domain: 'mail.example.test',
            category: 'verification_email',
            aggregateOnly: true,
          },
        }),
        expect.objectContaining({
          metricKey: 'resend_verification_email_failed_count',
          metricValue: 1,
          status: 'warning',
          metadata: {
            domain: 'mail.example.test',
            category: 'verification_email',
            aggregateOnly: true,
          },
        }),
      ]),
    );
  });

  it('marks unverified domains as warning signals', async () => {
    const result = await collectResendVerificationEmailHealth(
      [{ projectSlug: 'todo_app', domain: 'mail.example.test', verificationCategory: 'verification_email' }],
      {
        client: createClient({
          domain: {
            domain: 'mail.example.test',
            status: 'pending',
          },
        }),
      },
    );

    expect(result.status).toBe('partial_success');
    expect(result.metrics[0]).toMatchObject({
      metricKey: 'resend_domain_verified',
      metricValue: 0,
      status: 'warning',
    });
  });

  it('isolates Resend API failures without throwing', async () => {
    const result = await collectResendVerificationEmailHealth(
      [{ projectSlug: 'todo_app', domain: 'mail.example.test', verificationCategory: 'verification_email' }],
      { client: createClient({ error: 'invalid api key' }) },
    );

    expect(result.status).toBe('failed');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'resend',
        metricKey: 'resend_verification_email_health_available',
        metricValue: 0,
        status: 'failed',
        metadata: {
          domain: 'mail.example.test',
          category: 'verification_email',
        },
        collectedAt: expect.any(String),
      },
    ]);
    expect(result.errors).toEqual([
      {
        projectSlug: 'todo_app',
        message: 'invalid api key',
        retryable: true,
      },
    ]);
  });

  it('skips cleanly when there are no configured targets', async () => {
    const result = await collectResendVerificationEmailHealth([], { client: createClient() });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No Resend verification email targets configured.');
  });
});
