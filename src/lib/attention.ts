import type { Freshness, ProjectSlug, ProjectStatus, ProviderKey, StatusLevel } from '../types';

export interface AttentionItem {
  projectSlug: ProjectSlug;
  projectName: string;
  provider: ProviderKey;
  label: string;
  status: StatusLevel;
  detail: string;
  lastSync: string | null;
  freshness: Freshness;
}

/**
 * Flattens every provider that is warning or failed into a named list. The summary tile has
 * always been able to count these; the count alone never said which check was unhappy.
 * Failures sort ahead of warnings so the worst item is the first one read.
 */
export function buildAttentionItems(projects: ProjectStatus[]): AttentionItem[] {
  return projects
    .flatMap((project) =>
      project.providers
        .filter((provider) => provider.status === 'warning' || provider.status === 'failed')
        .map<AttentionItem>((provider) => ({
          projectSlug: project.slug,
          projectName: project.name,
          provider: provider.provider,
          label: provider.label,
          status: provider.status,
          detail: provider.detail,
          lastSync: provider.lastSync,
          freshness: provider.freshness,
        })),
    )
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'failed' ? -1 : 1));
}

/**
 * Counted separately from the attention list on purpose: a provider that has gone quiet is not
 * the same as one reporting a problem, and merging them makes "3 things broken" and "3 things
 * silent" indistinguishable.
 */
export function countStaleProviders(projects: ProjectStatus[]): number {
  return projects.flatMap((project) => project.providers).filter((provider) => provider.freshness !== 'fresh').length;
}
