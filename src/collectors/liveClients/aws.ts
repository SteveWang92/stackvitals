import { AmplifyClient as AwsAmplifyClient, GetAppCommand, GetBranchCommand } from '@aws-sdk/client-amplify';
import { CognitoIdentityProviderClient as AwsCognitoClient, DescribeUserPoolCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CostExplorerClient as AwsCostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DescribeTableCommand, DynamoDBClient as AwsDynamoDbClient } from '@aws-sdk/client-dynamodb';
import type { AmplifyClient } from '../providers/amplify';
import type { AwsAppBackendClient } from '../providers/awsAppBackend';
import type { CostExplorerClient } from '../providers/awsCostExplorer';

export function createLiveAmplifyClient(region: string): AmplifyClient {
  const client = new AwsAmplifyClient({ region });

  return {
    getApp: async (input) => {
      const result = await client.send(new GetAppCommand(input));

      if (!result.app?.appId || !result.app.name) {
        throw new Error(`Amplify app ${input.appId} was not returned by AWS.`);
      }

      return {
        app: {
          appId: result.app.appId,
          name: result.app.name,
          defaultDomain: result.app.defaultDomain,
          repository: result.app.repository,
          updateTime: result.app.updateTime?.toISOString(),
        },
      };
    },
    getBranch: async (input) => {
      const result = await client.send(new GetBranchCommand(input));

      if (!result.branch?.branchName) {
        throw new Error(`Amplify branch ${input.branchName} was not returned by AWS.`);
      }

      return {
        branch: {
          branchName: result.branch.branchName,
          displayName: result.branch.displayName,
          stage: result.branch.stage,
          enableAutoBuild: result.branch.enableAutoBuild,
          updateTime: result.branch.updateTime?.toISOString(),
        },
      };
    },
  };
}

export function createLiveCostExplorerClient(region: string): CostExplorerClient {
  const client = new AwsCostExplorerClient({ region });

  return {
    getCostAndUsage: async (input) => {
      const result = await client.send(new GetCostAndUsageCommand(input));

      return {
        ResultsByTime: result.ResultsByTime?.map((timePeriod) => ({
          TimePeriod: {
            Start: timePeriod.TimePeriod?.Start,
            End: timePeriod.TimePeriod?.End,
          },
          Groups: timePeriod.Groups?.map((group) => ({
            Keys: group.Keys ?? [],
            Metrics: {
              UnblendedCost: {
                Amount: group.Metrics?.UnblendedCost?.Amount,
                Unit: group.Metrics?.UnblendedCost?.Unit,
              },
            },
          })),
        })),
      };
    },
  };
}

/**
 * Cognito and DynamoDB clients are created per region and cached, because a watched app's
 * backend can live in a different region from the one the Amplify/Cost Explorer clients use.
 */
function regionalClientCache<T>(create: (region: string) => T): (region: string) => T {
  const clients = new Map<string, T>();

  return (region) => {
    const existing = clients.get(region);

    if (existing) {
      return existing;
    }

    const client = create(region);
    clients.set(region, client);

    return client;
  };
}

export function createLiveAwsAppBackendClient(): AwsAppBackendClient {
  const cognitoClient = regionalClientCache((region) => new AwsCognitoClient({ region }));
  const dynamoClient = regionalClientCache((region) => new AwsDynamoDbClient({ region }));

  return {
    describeUserPool: async ({ region, userPoolId }) => {
      const result = await cognitoClient(region).send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));
      const pool = result.UserPool;

      if (!pool?.Id || !pool.Name) {
        throw new Error(`Cognito user pool ${userPoolId} was not returned by AWS.`);
      }

      return {
        id: pool.Id,
        name: pool.Name,
        status: pool.Status,
        estimatedNumberOfUsers: pool.EstimatedNumberOfUsers,
        mfaConfiguration: pool.MfaConfiguration,
        lastModifiedDate: pool.LastModifiedDate?.toISOString(),
      };
    },
    describeTable: async ({ region, tableName }) => {
      const result = await dynamoClient(region).send(new DescribeTableCommand({ TableName: tableName }));
      const table = result.Table;

      if (!table?.TableName || !table.TableStatus) {
        throw new Error(`DynamoDB table ${tableName} was not returned by AWS.`);
      }

      return {
        tableName: table.TableName,
        tableStatus: table.TableStatus,
        itemCount: table.ItemCount,
        tableSizeBytes: table.TableSizeBytes,
        billingMode: table.BillingModeSummary?.BillingMode,
        deletionProtectionEnabled: table.DeletionProtectionEnabled,
      };
    },
  };
}
