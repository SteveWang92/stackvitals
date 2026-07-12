import { describe, expect, it, vi } from 'vitest';
import { collectHttpHealth } from '../../../collectors/providers/httpHealth';

function response(status: number): Response {
  return new Response('', { status });
}

describe('collectHttpHealth', () => {
  it('marks 2xx responses as successful health checks', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200));

    const result = await collectHttpHealth([{ projectSlug: 'acme_site', url: 'https://example.test' }], { fetch: fetchMock });

    expect(result.status).toBe('success');
    expect(result.healthChecks[0]).toMatchObject({
      projectSlug: 'acme_site',
      url: 'https://example.test',
      status: 'healthy',
      httpStatus: 200,
    });
    expect(result.errors).toHaveLength(0);
  });

  it('marks 4xx responses as partial warning signals', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(404));

    const result = await collectHttpHealth([{ projectSlug: 'todo_app', url: 'https://example.test/missing' }], { fetch: fetchMock });

    expect(result.status).toBe('partial_success');
    expect(result.healthChecks[0]).toMatchObject({
      status: 'warning',
      httpStatus: 404,
    });
  });

  it('isolates failed requests into errors without throwing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('DNS failed'));

    const result = await collectHttpHealth([{ projectSlug: 'recipe_box', url: 'https://offline.example' }], { fetch: fetchMock });

    expect(result.status).toBe('failed');
    expect(result.healthChecks[0]).toMatchObject({
      status: 'failed',
      httpStatus: null,
      errorMessage: 'DNS failed',
    });
    expect(result.errors).toEqual([
      {
        projectSlug: 'recipe_box',
        message: 'DNS failed',
        retryable: true,
      },
    ]);
  });

  it('returns partial success when only some targets fail', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(200)).mockRejectedValueOnce(new Error('connection refused'));

    const result = await collectHttpHealth(
      [
        { projectSlug: 'acme_site', url: 'https://healthy.example' },
        { projectSlug: 'todo_app', url: 'https://failed.example' },
      ],
      { fetch: fetchMock },
    );

    expect(result.status).toBe('partial_success');
    expect(result.healthChecks.map((check) => check.status)).toEqual(['healthy', 'failed']);
  });

  it('skips cleanly when there are no configured targets', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const result = await collectHttpHealth([], { fetch: fetchMock });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No HTTP health targets configured.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a browser-like User-Agent and an optional WAF bypass header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200));

    await collectHttpHealth([{ projectSlug: 'acme_site', url: 'https://example.test' }], {
      fetch: fetchMock,
      bypassHeaderName: 'X-Health-Check-Token',
      bypassHeaderValue: 'secret-value',
    });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;

    expect(requestInit.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
      'X-Health-Check-Token': 'secret-value',
    });
  });
});
