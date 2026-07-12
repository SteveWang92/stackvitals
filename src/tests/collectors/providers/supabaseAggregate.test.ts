import { describe, expect, it, vi } from 'vitest';
import { collectSupabaseAggregateStatus, type SupabaseAggregateClient } from '../../../collectors/providers/supabaseAggregate';

function createClient(data: Awaited<ReturnType<SupabaseAggregateClient['rpc']>>['data']): SupabaseAggregateClient {
  return {
    rpc: vi.fn().mockResolvedValue({
      data,
      error: null,
    }),
  };
}

describe('collectSupabaseAggregateStatus', () => {
  it('collects count-only aggregate metrics and project resources', async () => {
    const client = createClient([
      {
        metric_key: 'todo_app_groups_count',
        metric_value: 12,
        status: 'healthy',
        resource_type: 'database',
        resource_name: 'todo_app',
        metadata: {
          source: 'count_only_rpc',
        },
      },
      {
        metric_key: 'todo_app_expenses_count',
        metric_value: 43,
      },
    ]);

    const result = await collectSupabaseAggregateStatus(
      [{ projectSlug: 'todo_app', projectRef: 'project-ref', rpcName: 'collect_todo_app_status' }],
      { client },
    );

    expect(client.rpc).toHaveBeenCalledWith('collect_todo_app_status', { project_ref: 'project-ref' });
    expect(result.status).toBe('success');
    expect(result.summary).toBe('1/1 Supabase aggregate targets collected.');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'supabase',
        metricKey: 'todo_app_groups_count',
        metricValue: 12,
        status: 'healthy',
        metadata: {
          source: 'count_only_rpc',
          projectRef: 'project-ref',
          rpcName: 'collect_todo_app_status',
        },
        collectedAt: expect.any(String),
      },
      {
        projectSlug: 'todo_app',
        provider: 'supabase',
        metricKey: 'todo_app_expenses_count',
        metricValue: 43,
        status: 'healthy',
        metadata: {
          projectRef: 'project-ref',
          rpcName: 'collect_todo_app_status',
        },
        collectedAt: expect.any(String),
      },
    ]);
    expect(result.resources).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'supabase',
        resourceType: 'project',
        externalId: 'project-ref',
        displayName: 'project-ref',
        metadata: {
          rpcName: 'collect_todo_app_status',
          aggregateRows: 2,
        },
      },
      {
        projectSlug: 'todo_app',
        provider: 'supabase',
        resourceType: 'database',
        externalId: 'project-ref:database:todo_app',
        displayName: 'todo_app',
        metadata: {
          projectRef: 'project-ref',
          rpcName: 'collect_todo_app_status',
        },
      },
    ]);
    expect(result.errors).toHaveLength(0);
  });

  it('turns empty aggregate results into a warning metric', async () => {
    const result = await collectSupabaseAggregateStatus(
      [{ projectSlug: 'todo_app', projectRef: 'project-ref', rpcName: 'collect_todo_app_status' }],
      { client: createClient([]) },
    );

    expect(result.status).toBe('partial_success');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'supabase',
        metricKey: 'supabase_aggregate_rows',
        metricValue: 0,
        status: 'warning',
        metadata: {
          projectRef: 'project-ref',
          rpcName: 'collect_todo_app_status',
        },
        collectedAt: expect.any(String),
      },
    ]);
  });

  it('isolates RPC failures without throwing', async () => {
    const client: SupabaseAggregateClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'permission denied for function' },
      }),
    };

    const result = await collectSupabaseAggregateStatus(
      [{ projectSlug: 'todo_app', projectRef: 'project-ref', rpcName: 'collect_todo_app_status' }],
      { client },
    );

    expect(result.status).toBe('failed');
    expect(result.metrics).toEqual([
      {
        projectSlug: 'todo_app',
        provider: 'supabase',
        metricKey: 'supabase_aggregate_available',
        metricValue: 0,
        status: 'failed',
        metadata: {
          projectRef: 'project-ref',
          rpcName: 'collect_todo_app_status',
        },
        collectedAt: expect.any(String),
      },
    ]);
    expect(result.errors).toEqual([
      {
        projectSlug: 'todo_app',
        message: 'permission denied for function',
        retryable: true,
      },
    ]);
  });

  it('skips cleanly when there are no configured targets', async () => {
    const result = await collectSupabaseAggregateStatus([], { client: createClient([]) });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No Supabase aggregate targets configured.');
  });
});
