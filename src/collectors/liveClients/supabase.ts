import type { SupabaseAggregateClient } from '../providers/supabaseAggregate';
import type { SupabaseProjectHealthClient } from '../providers/supabaseProjectHealth';
import type { SnapshotPruneClient } from '../stores/pruneSnapshots';
import type {
  CostSnapshotInsert,
  CollectorRunsInsert,
  HealthCheckInsert,
  MetricSnapshotInsert,
  ResourceUpsert,
  SupabaseCollectorRunClient,
} from '../stores/supabaseCollectorRunRecorder';

function headers(authKey: string, apiKey = authKey): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${authKey}`,
    'Content-Type': 'application/json',
  };
}

async function requestJson<T>(url: string, init: RequestInit, errorPrefix: string): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

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

export function createLiveSupabaseSnapshotPruneClient(url: string, authKey: string, apiKey?: string): SnapshotPruneClient {
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
            ...headers(authKey, apiKey),
            Prefer: 'return=representation',
          },
        },
        `${table} prune failed`,
      );

      return deleted?.length ?? 0;
    },
  };
}

export function createLiveSupabaseCollectorRunClient(url: string, authKey: string, apiKey?: string): SupabaseCollectorRunClient {
  async function insertRows<T>(table: string, rows: T[], errorPrefix: string): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await requestJson<unknown>(
      `${url}/rest/v1/${table}`,
      {
        method: 'POST',
        headers: {
          ...headers(authKey, apiKey),
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
        headers: headers(authKey, apiKey),
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
        `${url}/rest/v1/resources?on_conflict=provider_id,resource_type,external_id`,
        {
          method: 'POST',
          headers: {
            ...headers(authKey, apiKey),
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
