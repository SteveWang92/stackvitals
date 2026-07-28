import { describe, expect, it } from 'vitest';
import { buildAttentionItems, countStaleProviders } from '../../lib/attention';
import type { Freshness, ProjectStatus, ProviderStatus, StatusLevel } from '../../types';

function provider(label: string, status: StatusLevel, freshness: Freshness = 'fresh'): ProviderStatus {
  return { provider: 'http', label, status, detail: `${label} detail`, lastSync: '2026-06-29T10:00:00.000Z', freshness };
}

function project(name: string, providers: ProviderStatus[]): ProjectStatus {
  return {
    slug: name.toLowerCase().replace(/ /g, '_'),
    name,
    publicUrl: 'https://example.com',
    deployStatus: 'healthy',
    uptimeStatus: 'healthy',
    lastSync: '2026-06-29T10:00:00.000Z',
    providers,
    resources: [],
    recentSnapshots: [],
    collectorErrors: [],
    history: { windowDays: 30, latency: [], uptime: [] },
  };
}

describe('buildAttentionItems', () => {
  const projects = [
    project('Acme Site', [provider('Amplify', 'healthy'), provider('Resend', 'warning')]),
    project('Todo App', [provider('Supabase', 'failed'), provider('HTTP Health', 'unknown')]),
  ];

  it('lists only providers that are warning or failed', () => {
    expect(buildAttentionItems(projects).map((item) => item.label)).toEqual(['Supabase', 'Resend']);
  });

  it('sorts failures ahead of warnings', () => {
    expect(buildAttentionItems(projects)[0].status).toBe('failed');
  });

  it('names the project and carries the failing detail', () => {
    const item = buildAttentionItems(projects)[0];

    expect(item.projectName).toBe('Todo App');
    expect(item.projectSlug).toBe('todo_app');
    expect(item.detail).toBe('Supabase detail');
  });

  it('matches the count the summary tile previously computed inline', () => {
    const legacyCount = projects
      .flatMap((entry) => entry.providers)
      .filter((entry) => entry.status === 'warning' || entry.status === 'failed').length;

    expect(buildAttentionItems(projects)).toHaveLength(legacyCount);
  });

  it('returns nothing when every provider is healthy', () => {
    expect(buildAttentionItems([project('Acme Site', [provider('Amplify', 'healthy')])])).toEqual([]);
  });
});

describe('countStaleProviders', () => {
  it('counts stale and never-synced providers, not failures', () => {
    const projects = [
      project('Acme Site', [provider('Amplify', 'healthy', 'stale'), provider('Resend', 'failed', 'fresh')]),
      project('Todo App', [provider('Supabase', 'healthy', 'never')]),
    ];

    expect(countStaleProviders(projects)).toBe(2);
  });
});
