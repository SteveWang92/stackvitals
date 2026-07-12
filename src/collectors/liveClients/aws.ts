import { AmplifyClient as AwsAmplifyClient, GetAppCommand, GetBranchCommand } from '@aws-sdk/client-amplify';
import { CostExplorerClient as AwsCostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import type { AmplifyClient } from '../providers/amplify';
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
