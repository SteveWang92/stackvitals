import { describe, expect, it } from 'vitest';
import { isAwsCostExplorerEnabled, resolveEnvPlaceholders, type CollectorConfig } from '../../collectors/config';

describe('resolveEnvPlaceholders', () => {
  it('resolves placeholders in nested string values and leaves other types untouched', () => {
    const config = {
      projects: [
        {
          slug: 'todo_app',
          name: 'Todo App',
          resources: {
            supabaseUrl: '${MY_APP_SUPABASE_URL}',
            supabaseServiceRoleKey: '${MY_APP_SUPABASE_SERVICE_ROLE_KEY}',
            githubActionsEnabled: false,
          },
        },
      ],
      githubActions: { runLimit: 50 },
    };

    const resolved = resolveEnvPlaceholders(config, {
      MY_APP_SUPABASE_URL: 'https://example.supabase.co',
      MY_APP_SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    expect(resolved.projects[0].resources.supabaseUrl).toBe('https://example.supabase.co');
    expect(resolved.projects[0].resources.supabaseServiceRoleKey).toBe('service-role-key');
    expect(resolved.projects[0].resources.githubActionsEnabled).toBe(false);
    expect(resolved.githubActions.runLimit).toBe(50);
  });

  it('resolves placeholders embedded inside longer strings', () => {
    const resolved = resolveEnvPlaceholders({ url: 'https://${APP_HOST}/rest/v1' }, { APP_HOST: 'example.com' });

    expect(resolved.url).toBe('https://example.com/rest/v1');
  });

  it('treats $$ as an escaped literal dollar sign', () => {
    const resolved = resolveEnvPlaceholders({ note: 'costs $$5, key $${NOT_A_VAR}' }, {});

    expect(resolved.note).toBe('costs $5, key ${NOT_A_VAR}');
  });

  it('resolves empty-string variables instead of failing', () => {
    const resolved = resolveEnvPlaceholders({ supabaseUrl: '${MY_APP_SUPABASE_URL}' }, { MY_APP_SUPABASE_URL: '' });

    expect(resolved.supabaseUrl).toBe('');
  });

  it('fails fast naming the missing variable and the config path', () => {
    const config = {
      projects: [{ slug: 'todo_app', resources: { supabaseUrl: '${MISSING_VAR}' } }],
    };

    expect(() => resolveEnvPlaceholders(config, {}, 'projects.config.json')).toThrowError(
      'Missing environment variable "MISSING_VAR" referenced by ${MISSING_VAR} at projects.config.json.projects[0].resources.supabaseUrl.',
    );
  });
});

describe('isAwsCostExplorerEnabled', () => {
  const config = { projects: [] } satisfies CollectorConfig;

  it('preserves Cost Explorer collection for existing configs', () => {
    expect(isAwsCostExplorerEnabled(config)).toBe(true);
  });

  it('allows least-privilege AWS backends to disable Cost Explorer', () => {
    expect(isAwsCostExplorerEnabled({ ...config, aws: { costExplorerEnabled: false } })).toBe(false);
  });
});
