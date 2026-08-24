import type { CollectorErrorSummary, CollectorRunSummary, ProjectSlug } from '../../types';
import { providerKey, providerLabel, type CollectorRunRow } from './rows';

function runDurationMs(run: CollectorRunRow): number | null {
  if (!run.finished_at) {
    return null;
  }

  const startedAt = new Date(run.started_at).getTime();
  const finishedAt = new Date(run.finished_at).getTime();

  return finishedAt - startedAt;
}

function affectedProjects(run: CollectorRunRow): ProjectSlug[] {
  const slugs = new Set<ProjectSlug>();

  for (const error of run.metadata?.errors ?? []) {
    if (typeof error.projectSlug === 'string' && error.projectSlug.trim()) {
      slugs.add(error.projectSlug);
    }
  }

  return Array.from(slugs).sort();
}

// Several adapters can share one provider key (e.g. supabase project health + one
// aggregate adapter per watched app), so runs are grouped per adapter, not per provider.
function runAdapterKey(run: CollectorRunRow): string {
  return `${providerKey(run) ?? 'http'}:${run.metadata?.adapterKey ?? ''}`;
}

export function collectorRunSummaries(collectorRuns: CollectorRunRow[]): CollectorRunSummary[] {
  const latestByAdapter = new Map<string, CollectorRunRow>();

  for (const run of collectorRuns) {
    const key = runAdapterKey(run);
    const existing = latestByAdapter.get(key);

    if (!existing || new Date(run.started_at).getTime() > new Date(existing.started_at).getTime()) {
      latestByAdapter.set(key, run);
    }
  }

  return Array.from(latestByAdapter.values())
    .map<CollectorRunSummary>((run) => {
      const provider = providerKey(run) ?? 'http';

      return {
        provider,
        providerLabel: providerLabel(provider),
        status: run.status,
        summary: run.summary,
        errorMessage: run.error_message,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        lastSyncedAt: run.finished_at ?? run.started_at,
        durationMs: runDurationMs(run),
        affectedProjects: affectedProjects(run),
      };
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/**
 * Errors scoped to one project, suppressed once a newer successful run exists for the same
 * adapter — otherwise a transient failure would stay on the dashboard after it recovered.
 */
export function collectorErrors(projectSlug: ProjectSlug, collectorRuns: CollectorRunRow[]): CollectorErrorSummary[] {
  const latestSuccessByAdapter = new Map<string, number>();

  for (const run of collectorRuns) {
    if (!providerKey(run) || run.status !== 'success') {
      continue;
    }

    const key = runAdapterKey(run);
    const finishedAt = new Date(run.finished_at ?? run.started_at).getTime();
    const existing = latestSuccessByAdapter.get(key) ?? 0;

    if (finishedAt > existing) {
      latestSuccessByAdapter.set(key, finishedAt);
    }
  }

  return collectorRuns.flatMap((run) => {
    const provider = providerKey(run);
    const occurredAt = run.finished_at ?? run.started_at;
    const newerSuccessAt = provider ? latestSuccessByAdapter.get(runAdapterKey(run)) : undefined;

    if (newerSuccessAt && newerSuccessAt > new Date(occurredAt).getTime()) {
      return [];
    }

    const metadataErrors = run.metadata?.errors ?? [];
    const scopedErrors = metadataErrors
      .filter((error) => !error.projectSlug || error.projectSlug === projectSlug)
      .map((error) => ({
        provider: provider ?? 'http',
        message: error.message,
        occurredAt,
      }));

    if (scopedErrors.length > 0) {
      return scopedErrors;
    }

    if (!run.error_message || run.status === 'success' || run.status === 'skipped') {
      return [];
    }

    return [
      {
        provider: provider ?? 'http',
        message: run.error_message,
        occurredAt,
      },
    ];
  });
}
