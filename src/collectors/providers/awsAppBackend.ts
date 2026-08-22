import type { ProjectSlug, StatusLevel } from '../../types';
import type { CollectorAdapterResult, CollectorMetric, CollectorResource, ProviderAdapter } from '../types';
import { getErrorMessage } from '../errorMessage';
import { deriveResultStatus } from './resultStatus';

/**
 * Status for an app whose auth/data backend runs on AWS primitives (Cognito + DynamoDB)
 * rather than a managed platform like Supabase. Every call here is a `Describe*` that
 * returns aggregate table/pool metadata only — no user records and no item contents ever
 * leave the watched account, the same boundary the Supabase aggregate adapter keeps.
 */

const adapterKey = 'aws_app_backend';

export interface AwsAppBackendTarget {
  projectSlug: ProjectSlug;
  region: string;
  cognitoUserPoolId?: string;
  dynamoDbTables: string[];
}

export interface CognitoUserPoolSummary {
  id: string;
  name: string;
  status?: string;
  estimatedNumberOfUsers?: number;
  mfaConfiguration?: string;
  lastModifiedDate?: string;
}

export interface DynamoDbTableSummary {
  tableName: string;
  tableStatus: string;
  itemCount?: number;
  tableSizeBytes?: number;
  billingMode?: string;
  deletionProtectionEnabled?: boolean;
}

export interface AwsAppBackendClient {
  describeUserPool: (input: { region: string; userPoolId: string }) => Promise<CognitoUserPoolSummary>;
  describeTable: (input: { region: string; tableName: string }) => Promise<DynamoDbTableSummary>;
}

export interface AwsAppBackendOptions {
  client: AwsAppBackendClient;
}

function tableStatusLevel(table: DynamoDbTableSummary): StatusLevel {
  const status = table.tableStatus.toUpperCase();

  if (status === 'ACTIVE') {
    return 'healthy';
  }

  // CREATING/UPDATING are transient states a scheduled run can legitimately catch mid-change;
  // anything else (DELETING, INACCESSIBLE_ENCRYPTION_CREDENTIALS, ARCHIVED) is a real fault.
  return status === 'CREATING' || status === 'UPDATING' ? 'warning' : 'failed';
}

async function collectUserPool(
  target: AwsAppBackendTarget,
  userPoolId: string,
  options: AwsAppBackendOptions,
  collectedAt: string,
  resources: CollectorResource[],
  metrics: CollectorMetric[],
): Promise<void> {
  const pool = await options.client.describeUserPool({ region: target.region, userPoolId });

  resources.push({
    projectSlug: target.projectSlug,
    provider: 'aws',
    resourceType: 'cognito_user_pool',
    externalId: pool.id,
    displayName: pool.name,
    metadata: {
      region: target.region,
      status: pool.status,
      mfaConfiguration: pool.mfaConfiguration,
      lastModifiedDate: pool.lastModifiedDate,
    },
  });

  metrics.push(
    {
      projectSlug: target.projectSlug,
      provider: 'aws',
      metricKey: 'aws_cognito_user_pool_available',
      metricValue: 1,
      status: 'healthy',
      metadata: {
        userPoolId: pool.id,
        userPoolName: pool.name,
        region: target.region,
        aggregateOnly: true,
      },
      collectedAt,
    },
    {
      projectSlug: target.projectSlug,
      provider: 'aws',
      metricKey: 'aws_cognito_user_pool_users',
      metricValue: pool.estimatedNumberOfUsers,
      status: 'healthy',
      metadata: {
        userPoolId: pool.id,
        region: target.region,
        // Cognito reports this as an estimate that trails sign-ups by minutes, so it is a
        // trend line rather than an exact count.
        estimated: true,
        aggregateOnly: true,
      },
      collectedAt,
    },
  );
}

async function collectTable(
  target: AwsAppBackendTarget,
  tableName: string,
  options: AwsAppBackendOptions,
  collectedAt: string,
  resources: CollectorResource[],
  metrics: CollectorMetric[],
): Promise<void> {
  const table = await options.client.describeTable({ region: target.region, tableName });
  const level = tableStatusLevel(table);

  resources.push({
    projectSlug: target.projectSlug,
    provider: 'aws',
    resourceType: 'dynamodb_table',
    // DynamoDB table names are unique only within an account and region, while resources
    // are upserted against a provider-wide external-id key. Qualify the name so two watched
    // regions can legitimately contain the same table name without colliding.
    externalId: `${target.region}:${table.tableName}`,
    displayName: table.tableName,
    metadata: {
      region: target.region,
      tableStatus: table.tableStatus,
      billingMode: table.billingMode,
      deletionProtectionEnabled: table.deletionProtectionEnabled,
    },
  });

  metrics.push(
    {
      projectSlug: target.projectSlug,
      provider: 'aws',
      metricKey: 'aws_dynamodb_table_active',
      metricValue: level === 'healthy' ? 1 : 0,
      status: level,
      metadata: {
        tableName: table.tableName,
        tableStatus: table.tableStatus,
        region: target.region,
        aggregateOnly: true,
      },
      collectedAt,
    },
    {
      projectSlug: target.projectSlug,
      provider: 'aws',
      metricKey: 'aws_dynamodb_table_items',
      metricValue: table.itemCount,
      status: 'healthy',
      metadata: {
        tableName: table.tableName,
        region: target.region,
        // DynamoDB refreshes ItemCount/TableSizeBytes roughly every six hours, so a daily
        // collection reads a recent snapshot, not a live count.
        estimated: true,
        aggregateOnly: true,
      },
      collectedAt,
    },
    {
      projectSlug: target.projectSlug,
      provider: 'aws',
      metricKey: 'aws_dynamodb_table_size_bytes',
      metricValue: table.tableSizeBytes,
      status: 'healthy',
      metadata: {
        tableName: table.tableName,
        region: target.region,
        estimated: true,
        aggregateOnly: true,
      },
      collectedAt,
    },
  );
}

export async function collectAwsAppBackendStatus(
  targets: AwsAppBackendTarget[],
  options: AwsAppBackendOptions,
): Promise<CollectorAdapterResult> {
  const startedAt = new Date().toISOString();
  const resources: CollectorResource[] = [];
  const metrics: CollectorMetric[] = [];
  const errors: CollectorAdapterResult['errors'] = [];

  await Promise.all(
    targets.map(async (target) => {
      const collectedAt = new Date().toISOString();
      // Each subject is collected independently so one missing table does not hide the
      // user-pool reading for the same project.
      const subjects: Array<{ label: string; run: () => Promise<void> }> = [];

      if (target.cognitoUserPoolId) {
        const userPoolId = target.cognitoUserPoolId;

        subjects.push({
          label: `Cognito user pool ${userPoolId}`,
          run: () => collectUserPool(target, userPoolId, options, collectedAt, resources, metrics),
        });
      }

      for (const tableName of target.dynamoDbTables) {
        subjects.push({
          label: `DynamoDB table ${tableName}`,
          run: () => collectTable(target, tableName, options, collectedAt, resources, metrics),
        });
      }

      await Promise.all(
        subjects.map(async (subject) => {
          try {
            await subject.run();
          } catch (error) {
            const message = getErrorMessage(error, `${subject.label} collection failed`);

            metrics.push({
              projectSlug: target.projectSlug,
              provider: 'aws',
              metricKey: 'aws_app_backend_subject_available',
              metricValue: 0,
              status: 'failed',
              metadata: {
                subject: subject.label,
                region: target.region,
                aggregateOnly: true,
              },
              collectedAt,
            });
            errors.push({
              projectSlug: target.projectSlug,
              message: `${subject.label}: ${message}`,
              retryable: true,
            });
          }
        }),
      );
    }),
  );

  const status = deriveResultStatus(metrics, errors);

  return {
    provider: 'aws',
    adapterKey,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      targets.length === 0
        ? 'No AWS app backends configured.'
        : `${targets.length - new Set(errors.map((error) => error.projectSlug)).size}/${targets.length} AWS app backends collected.`,
    resources,
    metrics,
    costs: [],
    healthChecks: [],
    errors,
  };
}

export function createAwsAppBackendAdapter(targets: AwsAppBackendTarget[], options: AwsAppBackendOptions): ProviderAdapter {
  return {
    provider: 'aws',
    adapterKey,
    collect: () => collectAwsAppBackendStatus(targets, options),
  };
}
