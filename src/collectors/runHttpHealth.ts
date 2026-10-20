import { loadEnv } from 'vite';
import { configPathFromArgs, readCollectorConfig } from './config';
import { collectHttpHealth, httpHealthTargets } from './providers/httpHealth';

// `collect:http`: the HTTP health adapter alone, printed as JSON and never written anywhere.
const env = { ...loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), ''), ...process.env };
const { config } = await readCollectorConfig(await configPathFromArgs(process.argv), env);
const result = await collectHttpHealth(httpHealthTargets(config), {
  fetch,
  bypassHeaderName: env.HTTP_HEALTH_CHECK_HEADER_NAME,
  bypassHeaderValue: env.HTTP_HEALTH_CHECK_HEADER_VALUE,
});

console.log(JSON.stringify(result, null, 2));
