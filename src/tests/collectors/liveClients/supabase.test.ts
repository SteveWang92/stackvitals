import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveSupabaseCollectorRunClient } from '../../../collectors/liveClients/supabase';

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
});
