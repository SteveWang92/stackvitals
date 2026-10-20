import { configPathFromArgs, loadLocalEnv, readRawCollectorConfig, resolveEnvPlaceholders } from './config';
import { collectHttpHealth, httpHealthTargets } from './providers/httpHealth';

// `collect:http`: the HTTP health adapter alone, printed as JSON and never written anywhere.
// Only the HTTP targets' placeholders are resolved, so unrelated adapters' secrets need not be set.
loadLocalEnv();

const configPath = await configPathFromArgs(process.argv);
const targets = resolveEnvPlaceholders(httpHealthTargets(await readRawCollectorConfig(configPath)), process.env, configPath);
const result = await collectHttpHealth(targets, {
  fetch,
  bypassHeaderName: process.env.HTTP_HEALTH_CHECK_HEADER_NAME,
  bypassHeaderValue: process.env.HTTP_HEALTH_CHECK_HEADER_VALUE,
});

console.log(JSON.stringify(result, null, 2));
