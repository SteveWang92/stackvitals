import { describe, expect, it } from 'vitest';
import { latestProviderStatuses } from '../../../services/dashboard/projects';
import type { MetricSnapshotRow } from '../../../services/dashboard/rows';
import type { StatusLevel } from '../../../types';

function metric(metricKey: string, status: StatusLevel, metadata: Record<string, unknown>): MetricSnapshotRow {
  return {
    project_id: 'todo-app',
    metric_key: metricKey,
    metric_value: status === 'failed' ? 0 : 1,
    status,
    metadata,
    collected_at: '2026-08-22T10:00:00.000Z',
    providers: { key: 'aws', name: 'AWS' },
  };
}

describe('latestProviderStatuses', () => {
  it('reports the worst current subject status when AWS metrics share a timestamp', () => {
    const statuses = latestProviderStatuses(
      'todo-app',
      [
        metric('aws_cognito_user_pool_available', 'healthy', { userPoolId: 'pool-1' }),
        metric('aws_cognito_user_pool_users', 'healthy', { userPoolId: 'pool-1' }),
        metric('aws_dynamodb_table_active', 'failed', { tableName: 'todos' }),
        metric('aws_dynamodb_table_items', 'healthy', { tableName: 'todos' }),
        metric('aws_dynamodb_table_active', 'healthy', { tableName: 'users' }),
      ],
      [],
      [],
    );

    expect(statuses).toEqual([
      expect.objectContaining({
        provider: 'aws',
        status: 'failed',
        detail: 'Aws Dynamodb Table Active: 0',
      }),
    ]);
  });
});
