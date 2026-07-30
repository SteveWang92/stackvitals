import { describe, expect, it, vi } from 'vitest';
import { collectResendDomainHealth, type ResendClient, type ResendDomainStatus } from '../../../collectors/providers/resend';

function createClient(options: { domain?: ResendDomainStatus; error?: string } = {}): ResendClient {
  if (options.error) {
    return {
      getDomainStatus: vi.fn().mockRejectedValue(new Error(options.error)),
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
  };
}

describe('collectResendDomainHealth', () => {
  it('collects sending-domain status without touching message data', async () => {
    const client = createClient();

    const result = await collectResendDomainHealth([{ projectSlug: 'todo_app', domain: 'mail.example.test' }], { client });

    expect(client.getDomainStatus).toHaveBeenCalledWith('mail.example.test');
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
    expect(result.metrics.map((metric) => metric.metricKey)).toEqual(['resend_domain_verified']);
    expect(result.metrics.every((metric) => JSON.stringify(metric).includes('@') === false)).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('marks unverified domains as warning signals', async () => {
    const result = await collectResendDomainHealth([{ projectSlug: 'todo_app', domain: 'mail.example.test' }], {
      client: createClient({
        domain: {
          domain: 'mail.example.test',
          status: 'pending',
        },
      }),
    });

    expect(result.status).toBe('partial_success');
    expect(result.metrics[0]).toMatchObject({
      metricKey: 'resend_domain_verified',
      metricValue: 0,
      status: 'warning',
    });
  });

  it('marks a failed domain as failed', async () => {
    const result = await collectResendDomainHealth([{ projectSlug: 'todo_app', domain: 'mail.example.test' }], {
      client: createClient({
        domain: {
          domain: 'mail.example.test',
          status: 'failed',
        },
      }),
    });

    expect(result.metrics[0]).toMatchObject({
      metricKey: 'resend_domain_verified',
      status: 'failed',
    });
  });

  it('isolates Resend API failures without throwing', async () => {
    const result = await collectResendDomainHealth([{ projectSlug: 'todo_app', domain: 'mail.example.test' }], {
      client: createClient({ error: 'invalid api key' }),
    });

    expect(result.status).toBe('failed');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'resend',
        metricKey: 'resend_domain_status_available',
        metricValue: 0,
        status: 'failed',
        metadata: {
          domain: 'mail.example.test',
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
    const result = await collectResendDomainHealth([], { client: createClient() });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No Resend domains configured.');
  });
});
