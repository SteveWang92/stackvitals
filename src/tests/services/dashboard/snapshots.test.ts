import { describe, expect, it } from 'vitest';
import { latestMetricRowsBySubject, latestSnapshotRows } from '../../../services/dashboard/snapshots';
import type { MetricSnapshotRow } from '../../../services/dashboard/rows';
import type { StatusLevel } from '../../../types';

function metric(
  metricKey: string,
  metricValue: number,
  metadata: Record<string, unknown>,
  collectedAt = '2026-08-22T10:00:00.000Z',
  status: StatusLevel = 'healthy',
): MetricSnapshotRow {
  return {
    project_id: 'todo-app',
    metric_key: metricKey,
    metric_value: metricValue,
    status,
    metadata,
    collected_at: collectedAt,
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

describe('latestMetricRowsBySubject', () => {
  it('keeps every metric a subject emitted in its newest collection', () => {
    const rows = latestMetricRowsBySubject([
      metric('aws_dynamodb_table_active', 0, { tableName: 'todos' }, '2026-08-21T10:00:00.000Z'),
      metric('aws_dynamodb_table_active', 1, { tableName: 'todos' }),
      metric('aws_dynamodb_table_items', 340, { tableName: 'todos' }),
    ]);

    expect(rows.map((row) => [row.metric_key, row.metric_value])).toEqual([
      ['aws_dynamodb_table_active', 1],
      ['aws_dynamodb_table_items', 340],
    ]);
  });

  it('drops a subject the collector stopped reporting a staleness window ago', () => {
    const rows = latestMetricRowsBySubject([
      metric('aws_dynamodb_table_active', 1, { tableName: 'todos' }),
      // Removed from the config three days ago while its last reading was a failure.
      metric('aws_dynamodb_table_active', 0, { tableName: 'retired' }, '2026-08-19T10:00:00.000Z', 'failed'),
    ]);

    expect(rows.map((row) => row.metadata?.tableName)).toEqual(['todos']);
  });

  it('keeps a subject that is merely one late run behind', () => {
    const rows = latestMetricRowsBySubject([
      metric('aws_dynamodb_table_active', 1, { tableName: 'todos' }),
      metric('aws_dynamodb_table_active', 0, { tableName: 'orders' }, '2026-08-21T09:00:00.000Z', 'failed'),
    ]);

    expect(rows.map((row) => row.metadata?.tableName).sort()).toEqual(['orders', 'todos']);
  });
});
