import type { SupabaseAggregateClient } from '../providers/supabaseAggregate';
import type { SupabaseProjectHealthClient } from '../providers/supabaseProjectHealth';
import type { SnapshotPruneClient } from '../stores/pruneSnapshots';
import type { ConfiguredProjectInventory } from '../config';
import type { ProviderKey } from '../../types';
import type {
  CostSnapshotInsert,
  CollectorRunsInsert,
  HealthCheckInsert,
  MetricSnapshotInsert,
  ResourceUpsert,
  SupabaseCollectorRunClient,
} from '../stores/supabaseCollectorRunRecorder';

function headers(authKey: string, apiKey = authKey): Record<string, string> {
  const isJwt = authKey.split('.').length === 3;
  const result: Record<string, string> = {
    apikey: isJwt ? apiKey : authKey,
    'Content-Type': 'application/json',
  };

  if (isJwt) {
    result.Authorization = `Bearer ${authKey}`;
  }

  return result;
}

function secretKeyHeaders(secretKey: string): Record<string, string> {
  return {
    apikey: secretKey,
    'Content-Type': 'application/json',
  };
}

async function requestJson<T>(url: string, init: RequestInit, errorPrefix: string): Promise<T> {
  let response = await fetch(url, init);
  let text = await response.text();

  // Supabase's opaque secret-key gateway occasionally generated an internal JWT just ahead
  // of the Data API clock. The next request in the same collector run succeeded, so replay
  // this one named transient once instead of losing an otherwise complete daily snapshot.
  if (response.status === 401 && text.includes('PGRST303') && text.includes('JWT issued at future')) {
    response = await fetch(url, init);
    text = await response.text();
  }

  if (!response.ok) {
    const detail = text.trim() ? ` ${text.slice(0, 500)}` : '';
    throw new Error(`${errorPrefix}: ${response.status}.${detail}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!text.trim()) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

interface ProjectInventoryRow {
  id: string;
  slug: string;
  is_active: boolean;
}

interface ProviderInventoryRow {
  id: string;
  key: string;
}

export function createLiveSupabaseConfiguredInventoryClient(url: string, secretKey: string) {
  const apiHeaders = secretKeyHeaders(secretKey);

  async function deleteRows(table: string, filters: string): Promise<void> {
    await requestJson<unknown>(
      `${url}/rest/v1/${table}?${filters}`,
      { method: 'DELETE', headers: { ...apiHeaders, Prefer: 'return=minimal' } },
      `${table} configured-inventory cleanup failed`,
    );
  }

  return {
    sync: async (configuredProjects: ConfiguredProjectInventory[]): Promise<void> => {
      const now = new Date().toISOString();

      if (configuredProjects.length > 0) {
        await requestJson<unknown>(
          `${url}/rest/v1/projects?on_conflict=slug`,
          {
            method: 'POST',
            headers: { ...apiHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(
              configuredProjects.map((project) => ({
                slug: project.slug,
                name: project.name,
                public_url: project.publicUrl,
                is_active: true,
                updated_at: now,
              })),
            ),
          },
          'projects configured-inventory sync failed',
        );
      }

      const [projects, providers] = await Promise.all([
        requestJson<ProjectInventoryRow[]>(
          `${url}/rest/v1/projects?select=id,slug,is_active`,
          { method: 'GET', headers: apiHeaders },
          'projects configured-inventory lookup failed',
        ),
        requestJson<ProviderInventoryRow[]>(
          `${url}/rest/v1/providers?select=id,key`,
          { method: 'GET', headers: apiHeaders },
          'providers configured-inventory lookup failed',
        ),
      ]);
      const configuredBySlug = new Map(configuredProjects.map((project) => [project.slug, new Set(project.providers)]));

      for (const project of projects) {
        const configuredProviders = configuredBySlug.get(project.slug);

        if (!configuredProviders) {
          if (project.is_active) {
            await requestJson<unknown>(
              `${url}/rest/v1/projects?id=eq.${encodeURIComponent(project.id)}`,
              {
                method: 'PATCH',
                headers: { ...apiHeaders, Prefer: 'return=minimal' },
                body: JSON.stringify({ is_active: false, updated_at: now }),
              },
              `project ${project.slug} deactivation failed`,
            );
          }

          await deleteRows('metric_snapshots', `project_id=eq.${encodeURIComponent(project.id)}`);
          await deleteRows('cost_snapshots', `project_id=eq.${encodeURIComponent(project.id)}`);
          await deleteRows('resources', `project_id=eq.${encodeURIComponent(project.id)}`);
          await deleteRows('health_checks', `project_id=eq.${encodeURIComponent(project.id)}`);
          continue;
        }

        const removedProviderIds = providers
          .filter((provider) => !configuredProviders.has(provider.key as ProviderKey))
          .map((provider) => provider.id);

        if (removedProviderIds.length > 0) {
          const filters = `project_id=eq.${encodeURIComponent(project.id)}&provider_id=in.(${removedProviderIds.join(',')})`;
          await deleteRows('metric_snapshots', filters);
          await deleteRows('resources', filters);
        }

        if (!configuredProviders.has('http')) {
          await deleteRows('health_checks', `project_id=eq.${encodeURIComponent(project.id)}`);
        }
      }
    },
  };
}

export function createLiveSupabaseAggregateClient(url: string, authKey: string, apiKey?: string): SupabaseAggregateClient {
  return {
    rpc: async (rpcName, params) => {
      try {
        const data = await requestJson<unknown[]>(
          `${url}/rest/v1/rpc/${rpcName}`,
          {
            method: 'POST',
            headers: headers(authKey, apiKey),
            body: JSON.stringify(params),
          },
          `Supabase RPC ${rpcName} failed`,
        );

        return {
          data: data as never,
          error: null,
        };
      } catch (error) {
        return {
          data: null,
          error: {
            message: error instanceof Error ? error.message : 'Supabase RPC failed',
          },
        };
      }
    },
  };
}

export function createLiveSupabaseProjectHealthClient(authKey: string, apiKey?: string): SupabaseProjectHealthClient {
  return {
    checkRestHealth: async (projectUrl) => {
      // Probe the PostgREST root, not a specific table. The root only validates that the
      // REST service is reachable and the API key is accepted; it needs no table-level
      // grants, so it works whether the hub uses RLS-restricted tables (hosted) or a
      // from-scratch local stack where anon has no table privileges.
      const response = await fetch(`${projectUrl}/rest/v1/`, {
        method: 'GET',
        headers: headers(authKey, apiKey),
      });
      const body = await response.text();

      return {
        ok: response.ok,
        detail: response.ok ? `REST API returned ${response.status}` : `REST API returned ${response.status}: ${body.slice(0, 500)}`,
      };
    },
  };
}

export function createLiveSupabaseSnapshotPruneClient(url: string, secretKey: string): SnapshotPruneClient {
  return {
    deleteRowsOlderThan: async (table, timestampColumn, cutoff) => {
      // `return=representation` with `select=id` is what makes the deleted count available:
      // PostgREST documents the count=exact / Content-Range pair for GET, not for DELETE, and
      // one uuid per pruned row is a cheap enough response for a once-a-day job.
      const deleted = await requestJson<Array<{ id: string }>>(
        `${url}/rest/v1/${table}?select=id&${timestampColumn}=lt.${encodeURIComponent(cutoff)}`,
        {
          method: 'DELETE',
          headers: {
            ...secretKeyHeaders(secretKey),
            Prefer: 'return=representation',
          },
        },
        `${table} prune failed`,
      );

      return deleted?.length ?? 0;
    },
  };
}

export function createLiveSupabaseCollectorRunClient(url: string, secretKey: string): SupabaseCollectorRunClient {
  async function insertRows<T>(table: string, rows: T[], errorPrefix: string): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await requestJson<unknown>(
      `${url}/rest/v1/${table}`,
      {
        method: 'POST',
        headers: {
          ...secretKeyHeaders(secretKey),
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(rows),
      },
      errorPrefix,
    );
  }

  async function lookupId(table: 'providers' | 'projects', column: 'key' | 'slug', value: string): Promise<string> {
    const data = await requestJson<Array<{ id: string }>>(
      `${url}/rest/v1/${table}?select=id&${column}=eq.${encodeURIComponent(value)}`,
      {
        method: 'GET',
        headers: secretKeyHeaders(secretKey),
      },
      `${table} lookup failed for ${value}`,
    );
    const id = data[0]?.id;

    if (!id) {
      throw new Error(`${table} lookup returned no row for ${value}. Run supabase/seed.sql before collecting.`);
    }

    return id;
  }

  return {
    getProviderId: (providerKey: string) => lookupId('providers', 'key', providerKey),
    getProjectId: (projectSlug: string) => lookupId('projects', 'slug', projectSlug),
    upsertResources: async (rows: ResourceUpsert[]) => {
      if (rows.length === 0) {
        return;
      }

      await requestJson<unknown>(
        `${url}/rest/v1/resources?on_conflict=project_id,provider_id,resource_type,external_id`,
        {
          method: 'POST',
          headers: {
            ...secretKeyHeaders(secretKey),
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(rows),
        },
        'resources upsert failed',
      );
    },
    insertMetricSnapshots: (rows: MetricSnapshotInsert[]) => insertRows('metric_snapshots', rows, 'metric_snapshots insert failed'),
    insertCostSnapshots: (rows: CostSnapshotInsert[]) => insertRows('cost_snapshots', rows, 'cost_snapshots insert failed'),
    insertHealthChecks: (rows: HealthCheckInsert[]) => insertRows('health_checks', rows, 'health_checks insert failed'),
    insertCollectorRun: (row: CollectorRunsInsert) => insertRows('collector_runs', [row], 'collector_runs insert failed'),
  };
}
