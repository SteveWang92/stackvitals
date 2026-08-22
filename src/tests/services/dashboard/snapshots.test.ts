import { describe, expect, it } from 'vitest';
import { latestSnapshotRows } from '../../../services/dashboard/snapshots';
import type { MetricSnapshotRow } from '../../../services/dashboard/rows';

function metric(metricKey: string, metricValue: number, metadata: Record<string, unknown>): MetricSnapshotRow {
  return {
    project_id: 'todo-app',
    metric_key: metricKey,
    metric_value: metricValue,
    status: 'healthy',
    metadata,
    collected_at: '2026-08-22T10:00:00.000Z',
    providers: { key: 'aws', name: 'AWS' },
  };
}

describe('latestSnapshotRows', () => {
  it('keeps every metric emitted for one AWS backend resource', () => {
    const rows = latestSnapshotRows([
      metric('aws_cognito_user_pool_available', 1, { userPoolId: 'pool-1' }),
      metric('aws_cognito_user_pool_users', 12, { userPoolId: 'pool-1' }),
      metric('aws_dynamodb_table_active', 1, { tableName: 'todos' }),
      metric('aws_dynamodb_table_items', 340, { tableName: 'todos' }),
      metric('aws_dynamodb_table_size_bytes', 65_536, { tableName: 'todos' }),
    ]);

    expect(rows.map((row) => row.metric_key).sort()).toEqual([
      'aws_cognito_user_pool_available',
      'aws_cognito_user_pool_users',
      'aws_dynamodb_table_active',
      'aws_dynamodb_table_items',
      'aws_dynamodb_table_size_bytes',
    ]);
  });
});
