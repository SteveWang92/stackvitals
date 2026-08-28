import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveCloudflareClient } from '../../../collectors/liveClients/cloudflare';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createLiveCloudflareClient', () => {
  it('normalizes the registrar API current_registrar field', async () => {
    const response = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) }) as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: 'zone-id', name: 'example.org', status: 'active', original_registrar: null }]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(
        response({
          domain: 'example.org',
          current_registrar: 'Cloudflare, Inc.',
          expires_at: '2027-01-01T00:00:00Z',
          auto_renew: true,
          locked: true,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const inventory = await createLiveCloudflareClient('token', 'account-id').getDomainInventory('example.org');

    expect(inventory.registrarDomain?.registrar).toBe('Cloudflare, Inc.');
  });
});
