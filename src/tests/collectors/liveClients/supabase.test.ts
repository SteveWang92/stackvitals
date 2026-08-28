import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveSupabaseCollectorRunClient,
  createLiveSupabaseConfiguredInventoryClient,
} from '../../../collectors/liveClients/supabase';

function successfulLookupResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify([{ id: 'provider-id' }]),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createLiveSupabaseCollectorRunClient', () => {
  it('uses an opaque Supabase secret key only as the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulLookupResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createLiveSupabaseCollectorRunClient('https://example.supabase.co', 'sb_secret_test-key');
    await client.getProviderId('aws');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/providers?select=id&key=eq.aws',
      expect.objectContaining({
        headers: {
          apikey: 'sb_secret_test-key',
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('retries the named opaque-key clock-skew response once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future' }),
      } as Response)
      .mockResolvedValueOnce(successfulLookupResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createLiveSupabaseCollectorRunClient('https://example.supabase.co', 'sb_secret_test-key');

    await expect(client.getProviderId('aws')).resolves.toBe('provider-id');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deactivates omitted projects and removes providers omitted from configured projects', async () => {
    const emptyResponse = { ok: true, status: 204, text: async () => '' } as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            { id: 'shared-bill-id', slug: 'shared_bill', is_active: true },
            { id: 'retired-id', slug: 'retired', is_active: true },
          ]),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            { id: 'http-id', key: 'http' },
            { id: 'resend-id', key: 'resend' },
            { id: 'supabase-id', key: 'supabase' },
          ]),
      } as Response)
      .mockResolvedValue(emptyResponse);
    vi.stubGlobal('fetch', fetchMock);

    const client = createLiveSupabaseConfiguredInventoryClient('https://example.supabase.co', 'sb_secret_test-key');
    await client.sync([{ slug: 'shared_bill', name: 'Shared Bill', publicUrl: 'https://share.example', providers: ['http'] }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/metric_snapshots?project_id=eq.shared-bill-id&provider_id=in.(resend-id,supabase-id)',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/resources?project_id=eq.shared-bill-id&provider_id=in.(resend-id,supabase-id)',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/projects?id=eq.retired-id',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/metric_snapshots?project_id=eq.retired-id',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/cost_snapshots?project_id=eq.retired-id',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/resources?project_id=eq.retired-id',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/health_checks?project_id=eq.retired-id',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
