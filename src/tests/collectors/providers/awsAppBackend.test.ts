import { describe, expect, it, vi } from 'vitest';
import { collectAwsAppBackendStatus, type AwsAppBackendClient } from '../../../collectors/providers/awsAppBackend';

function createClient(overrides: Partial<AwsAppBackendClient> = {}): AwsAppBackendClient {
  return {
    describeUserPool: vi.fn().mockResolvedValue({
      id: 'ap-southeast-2_Pool',
      name: 'todo-app-prod',
      status: 'Enabled',
      estimatedNumberOfUsers: 12,
      mfaConfiguration: 'OFF',
      lastModifiedDate: '2026-08-01T00:00:00.000Z',
    }),
    describeTable: vi.fn().mockResolvedValue({
      tableName: 'todo-app-prod-data',
      tableStatus: 'ACTIVE',
      itemCount: 340,
      tableSizeBytes: 65_536,
      billingMode: 'PAY_PER_REQUEST',
      deletionProtectionEnabled: true,
    }),
    ...overrides,
  };
}

const target = {
  projectSlug: 'todo_app' as const,
  region: 'ap-southeast-2',
  cognitoUserPoolId: 'ap-southeast-2_Pool',
  dynamoDbTables: ['todo-app-prod-data'],
};

describe('collectAwsAppBackendStatus', () => {
  it('collects user pool and table resources for a configured backend', async () => {
    const client = createClient();

    const result = await collectAwsAppBackendStatus([target], { client });

    expect(result.status).toBe('success');
    expect(result.provider).toBe('aws');
    expect(result.adapterKey).toBe('aws_app_backend');
    expect(result.summary).toBe('1/1 AWS app backends collected.');
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceType: 'cognito_user_pool', externalId: 'ap-southeast-2_Pool', displayName: 'todo-app-prod' }),
        expect.objectContaining({ resourceType: 'dynamodb_table', externalId: 'todo-app-prod-data' }),
      ]),
    );
    expect(client.describeUserPool).toHaveBeenCalledWith({ region: 'ap-southeast-2', userPoolId: 'ap-southeast-2_Pool' });
    expect(client.describeTable).toHaveBeenCalledWith({ region: 'ap-southeast-2', tableName: 'todo-app-prod-data' });
  });

  it('reports aggregate counts as metrics', async () => {
    const result = await collectAwsAppBackendStatus([target], { client: createClient() });
    const values = Object.fromEntries(result.metrics.map((metric) => [metric.metricKey, metric.metricValue]));

    expect(values).toEqual({
      aws_cognito_user_pool_available: 1,
      aws_cognito_user_pool_users: 12,
      aws_dynamodb_table_active: 1,
      aws_dynamodb_table_items: 340,
      aws_dynamodb_table_size_bytes: 65_536,
    });
    expect(result.metrics.every((metric) => metric.projectSlug === 'todo_app')).toBe(true);
    // Every reading is a count, a size, or an availability flag — never a record — so the
    // whole adapter is safe to store in the hub's own database.
    expect(result.metrics.every((metric) => metric.metadata?.aggregateOnly)).toBe(true);
  });

  it('tags a table that is not ACTIVE by how recoverable the state is', async () => {
    const updating = await collectAwsAppBackendStatus([target], {
      client: createClient({ describeTable: vi.fn().mockResolvedValue({ tableName: 'todo-app-prod-data', tableStatus: 'UPDATING' }) }),
    });
    const deleting = await collectAwsAppBackendStatus([target], {
      client: createClient({ describeTable: vi.fn().mockResolvedValue({ tableName: 'todo-app-prod-data', tableStatus: 'DELETING' }) }),
    });

    expect(updating.metrics.find((metric) => metric.metricKey === 'aws_dynamodb_table_active')?.status).toBe('warning');
    expect(deleting.metrics.find((metric) => metric.metricKey === 'aws_dynamodb_table_active')?.status).toBe('failed');
    expect(updating.status).toBe('partial_success');
  });

  it('keeps collecting the other subjects when one describe call fails', async () => {
    const client = createClient({ describeTable: vi.fn().mockRejectedValue(new Error('ResourceNotFoundException')) });

    const result = await collectAwsAppBackendStatus([target], { client });

    expect(result.status).toBe('partial_success');
    expect(result.errors).toEqual([
      {
        projectSlug: 'todo_app',
        message: 'DynamoDB table todo-app-prod-data: ResourceNotFoundException',
        retryable: true,
      },
    ]);
    expect(result.metrics.find((metric) => metric.metricKey === 'aws_cognito_user_pool_users')?.metricValue).toBe(12);
    expect(result.metrics.find((metric) => metric.metricKey === 'aws_app_backend_subject_available')?.status).toBe('failed');
  });

  it('skips the user pool when a project only configures tables', async () => {
    const client = createClient();

    const result = await collectAwsAppBackendStatus([{ ...target, cognitoUserPoolId: undefined }], { client });

    expect(client.describeUserPool).not.toHaveBeenCalled();
    expect(result.metrics.every((metric) => !metric.metricKey.startsWith('aws_cognito_'))).toBe(true);
  });

  it('skips cleanly when nothing is configured', async () => {
    const result = await collectAwsAppBackendStatus([], { client: createClient() });

    expect(result.status).toBe('skipped');
    expect(result.summary).toBe('No AWS app backends configured.');
  });
});
