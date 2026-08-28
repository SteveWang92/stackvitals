import { access, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

function getArgValue(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

const configArg = getArgValue('--config');
async function defaultConfigUrl() {
  const cwdUrl = `file:///${process.cwd().replaceAll('\\', '/')}/`;
  const localConfig = new URL('projects.config.json', cwdUrl);

  try {
    await access(localConfig);
    return localConfig;
  } catch {
    return new URL('../projects.example.json', import.meta.url);
  }
}

const configPath = configArg ? new URL(configArg, `file:///${process.cwd().replaceAll('\\', '/')}/`) : await defaultConfigUrl();
const config = JSON.parse(await readFile(configPath, 'utf8'));
const targets = config.projects
  .filter((project) => project.resources?.healthCheckUrl || project.publicUrl)
  .map((project) => ({
    projectSlug: project.slug,
    url: project.resources?.healthCheckUrl ?? project.publicUrl,
    followRedirects: project.resources?.healthCheckFollowRedirects !== false,
  }));

async function checkTarget(target) {
  const startedAt = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: target.followRedirects ? 'follow' : 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StackVitals/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const status = response.status >= 200 && response.status < 400 ? 'healthy' : response.status < 500 ? 'warning' : 'failed';

    return {
      projectSlug: target.projectSlug,
      url: target.url,
      status,
      httpStatus: response.status,
      responseTimeMs: Math.round(performance.now() - startedAt),
      checkedAt,
    };
  } catch (error) {
    return {
      projectSlug: target.projectSlug,
      url: target.url,
      status: 'failed',
      httpStatus: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      checkedAt,
      errorMessage: error instanceof Error ? error.message : 'Health check failed',
    };
  }
}

const healthChecks = await Promise.all(targets.map(checkTarget));
const failedChecks = healthChecks.filter((check) => check.status === 'failed');
const healthyChecks = healthChecks.filter((check) => check.status === 'healthy');
const warningChecks = healthChecks.filter((check) => check.status === 'warning');
const run = {
  provider: 'http',
  status:
    healthChecks.length === 0
      ? 'skipped'
      : failedChecks.length === healthChecks.length
        ? 'failed'
        : failedChecks.length > 0 || warningChecks.length > 0
          ? 'partial_success'
          : 'success',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  summary:
    healthChecks.length === 0
      ? 'No HTTP health targets configured.'
      : `${healthyChecks.length}/${healthChecks.length} HTTP health checks passed.`,
  healthChecks,
  errors: failedChecks.map((check) => ({
    projectSlug: check.projectSlug,
    message: check.errorMessage ?? `HTTP health check failed with status ${check.httpStatus ?? 'unknown'}.`,
    retryable: true,
  })),
};

console.log(JSON.stringify(run, null, 2));
