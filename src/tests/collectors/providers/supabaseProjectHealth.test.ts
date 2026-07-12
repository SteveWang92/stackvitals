import { describe, expect, it, vi } from 'vitest';
import { collectSupabaseProjectHealth, type SupabaseProjectHealthClient } from '../../../collectors/providers/supabaseProjectHealth';

function createClient(ok: boolean, detail = 'REST API returned 200'): SupabaseProjectHealthClient {
  return {
    checkRestHealth: vi.fn().mockResolvedValue({ ok, detail }),
  };
}

describe('collectSupabaseProjectHealth', () => {
  it('records Supabase project resources and healthy REST metrics', async () => {
    const client = createClient(true);

    const result = await collectSupabaseProjectHealth(
      [
        {
          projectSlug: 'status_hub',
          projectRef: 'hub-project-ref',
          projectUrl: 'https://hub.supabase.co',
        },
      ],
      { client },
    );

    expect(client.checkRestHealth).toHaveBeenCalledWith('https://hub.supabase.co');
    expect(result).toMatchObject({
      provider: 'supabase',
      status: 'success',
      summary: '1/1 Supabase project health targets collected.',
      resources: [
        {
          projectSlug: 'status_hub',
          provider: 'supabase',
          resourceType: 'project',
          externalId: 'hub-project-ref',
          displayName: 'hub-project-ref',
        },
      ],
      metrics: [
        {
          projectSlug: 'status_hub',
          provider: 'supabase',
          metricKey: 'supabase_rest_available',
          metricValue: 1,
          status: 'healthy',
        },
      ],
      errors: [],
    });
  });

  it('surfaces failed Supabase REST health checks', async () => {
    const result = await collectSupabaseProjectHealth(
      [
        {
          projectSlug: 'status_hub',
          projectRef: 'hub-project-ref',
          projectUrl: 'https://hub.supabase.co',
        },
      ],
      { client: createClient(false, 'REST API returned 401') },
    );

    expect(result).toMatchObject({
      status: 'failed',
      summary: '0/1 Supabase project health targets collected.',
      errors: [
        {
          projectSlug: 'status_hub',
          message: 'REST API returned 401',
          retryable: true,
        },
      ],
    });
  });
});
