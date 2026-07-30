/**
 * One command to get a working local backend: start Docker, boot the local Supabase
 * stack, create the dashboard login user + allowlist row, and write the local
 * connection values to `.env.local` so the frontend and collectors point at the local
 * stack instead of production. See docs/SELF_HOSTING.md section 0.
 *
 * Usage:
 *   npm run db:up          start everything and provision the login user
 *   npm run db:down        stop the local stack (Docker Desktop keeps running)
 *   npm run db:reset       wipe the local database, re-apply migrations + seeds, re-provision
 *   npm run db:up:demo     as db:up, plus fictional demo rows to develop against
 *   npm run db:reset:demo  as db:reset, plus those demo rows
 *   npm run db:demo        (re)seed the demo rows into an already-running stack
 *
 * The Supabase CLI is not vendored into this repo. The script uses, in order:
 * `node_modules/.bin/supabase` (if you ran `npm i -D supabase`), a `supabase` already on
 * PATH (Homebrew/scoop/winget install), or `npx --yes supabase@latest` as a last resort.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDemoData } from './demo-seed.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const isWindows = process.platform === 'win32';
const command = process.argv[2] ?? 'up';
const withDemoData = process.argv.slice(3).includes('--demo');

const ENV_LOCAL_PATH = join(repoRoot, '.env.local');
const DOCKER_WAIT_MS = 180_000;
const DOCKER_POLL_MS = 3_000;

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function capture(file, args, options = {}) {
  return spawnSync(file, args, { encoding: 'utf8', windowsHide: true, ...options });
}

function quoteForShell(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

// --- Supabase CLI resolution -------------------------------------------------

function resolveSupabaseCli() {
  const localBin = join(repoRoot, 'node_modules', '.bin', isWindows ? 'supabase.cmd' : 'supabase');

  if (existsSync(localBin)) {
    // A `.cmd` shim cannot be spawned directly on Windows; it needs a shell.
    return { file: localBin, prefix: [], shell: isWindows, label: 'node_modules/.bin/supabase' };
  }

  for (const shell of isWindows ? [false, true] : [false]) {
    const probe = capture('supabase', ['--version'], { shell });

    if (!probe.error && probe.status === 0) {
      return { file: 'supabase', prefix: [], shell, label: `supabase on PATH (${probe.stdout.trim()})` };
    }
  }

  return { file: 'npx', prefix: ['--yes', 'supabase@latest'], shell: isWindows, label: 'npx supabase@latest' };
}

function supabaseArgs(cli, args) {
  return [...cli.prefix, ...args];
}

function runSupabase(cli, args) {
  const file = cli.shell ? quoteForShell(cli.file) : cli.file;
  const result = spawnSync(file, supabaseArgs(cli, args), {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: cli.shell,
    windowsHide: true,
  });

  return result.status ?? 1;
}

function captureSupabase(cli, args) {
  const file = cli.shell ? quoteForShell(cli.file) : cli.file;

  return capture(file, supabaseArgs(cli, args), { cwd: repoRoot, shell: cli.shell });
}

// --- Docker ------------------------------------------------------------------

function dockerIsRunning() {
  const probe = capture('docker', ['info', '--format', '{{.ServerVersion}}']);

  return !probe.error && probe.status === 0;
}

function startDockerDesktop() {
  // Docker Desktop 4.37+ ships this CLI plugin on both Windows and macOS.
  const start = capture('docker', ['desktop', 'start']);

  if (!start.error && start.status === 0) {
    return true;
  }

  if (process.platform === 'darwin') {
    const open = capture('open', ['-a', 'Docker']);
    return !open.error && open.status === 0;
  }

  return false;
}

async function ensureDocker() {
  if (dockerIsRunning()) {
    log('✓ Docker is running');
    return;
  }

  if (process.platform === 'linux') {
    fail('Docker is not running. Start the daemon (e.g. `sudo systemctl start docker`) and re-run this command.');
  }

  log('… Docker is not running — starting Docker Desktop');

  if (!startDockerDesktop()) {
    fail('Could not start Docker Desktop automatically. Start it manually, wait for it to report "running", then re-run this command.');
  }

  const deadline = Date.now() + DOCKER_WAIT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DOCKER_POLL_MS));

    if (dockerIsRunning()) {
      log('✓ Docker is running');
      return;
    }
  }

  fail('Docker Desktop did not become ready in time. Check its window, then re-run this command.');
}

// --- Local stack -------------------------------------------------------------

function parseStatus(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function pick(status, ...keys) {
  for (const key of keys) {
    const match = Object.entries(status).find(([name]) => name.toLowerCase() === key.toLowerCase());

    if (match && match[1]) {
      return String(match[1]);
    }
  }

  return null;
}

function readStackStatus(cli) {
  const result = captureSupabase(cli, ['status', '-o', 'json']);
  const status = result.stdout ? parseStatus(result.stdout) : null;

  if (!status) {
    return null;
  }

  const apiUrl = pick(status, 'API_URL');
  // Newer CLI versions also print the sb_publishable_/sb_secret_ pair; either works.
  const anonKey = pick(status, 'ANON_KEY', 'PUBLISHABLE_KEY');
  const serviceKey = pick(status, 'SERVICE_ROLE_KEY', 'SECRET_KEY');

  if (!apiUrl || !anonKey || !serviceKey) {
    return null;
  }

  return { apiUrl, anonKey, serviceKey, studioUrl: pick(status, 'STUDIO_URL') };
}

function ensureStack(cli) {
  const running = readStackStatus(cli);

  if (running) {
    log(`✓ Supabase local stack already running (${running.apiUrl})`);
    return running;
  }

  log('… Starting the Supabase local stack (first run pulls Docker images, this can take a few minutes)');

  if (runSupabase(cli, ['start']) !== 0) {
    fail('`supabase start` failed. Fix the error above, then re-run this command.');
  }

  const started = readStackStatus(cli);

  if (!started) {
    fail('The stack started but `supabase status -o json` did not report an API URL and keys. Run it manually to see why.');
  }

  log(`✓ Supabase local stack running (${started.apiUrl})`);

  return started;
}

// --- Env files ---------------------------------------------------------------

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }

  return values;
}

const ENV_LOCAL_HEADER = [
  '# Generated by `npm run db:up` (scripts/local-supabase.mjs). Git-ignored.',
  '# These values point the frontend and collectors at the LOCAL Supabase stack and',
  '# override the same keys in `.env`. Delete this file to go back to whatever `.env`',
  '# points at. Everything in here is local-only and worthless outside this machine.',
];

function writeEnvLocal(updates) {
  const existing = existsSync(ENV_LOCAL_PATH) ? readFileSync(ENV_LOCAL_PATH, 'utf8').split(/\r?\n/) : [...ENV_LOCAL_HEADER, ''];
  const pending = new Map(Object.entries(updates));

  const lines = existing.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);

    if (!match || !pending.has(match[1])) {
      return line;
    }

    const key = match[1];
    const value = pending.get(key);
    pending.delete(key);

    return `${key}=${value}`;
  });

  for (const [key, value] of pending) {
    lines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_LOCAL_PATH, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

/** `.env.local` wins over `.env`, matching how Vite's loadEnv resolves them. */
function readEnvFiles() {
  return { ...parseEnvFile(join(repoRoot, '.env')), ...parseEnvFile(ENV_LOCAL_PATH), ...process.env };
}

/**
 * Resolved separately from the password, and never bundled with it into one object. The email is
 * printed to the terminal on success; the password never is. Keeping the two on separate paths is
 * what lets a reader — and CodeQL's clear-text-logging analysis — see that at a glance.
 */
function resolveLoginEmail() {
  const env = readEnvFiles();
  const email = env.LOCAL_DEV_EMAIL || (env.VITE_DASHBOARD_ALLOWED_EMAIL ?? '').split(',')[0].trim();

  if (!email) {
    fail(
      'No login email to provision. Set VITE_DASHBOARD_ALLOWED_EMAIL (or LOCAL_DEV_EMAIL) in `.env` — see `.env.example` — then re-run this command.',
    );
  }

  return email;
}

/** Never logged — it only reaches the auth API and the git-ignored `.env.local`. */
function resolveLoginPassword() {
  const existingPassword = readEnvFiles().LOCAL_DEV_PASSWORD;

  return {
    password: existingPassword || randomBytes(15).toString('base64url'),
    generatedPassword: !existingPassword,
  };
}

// --- Provisioning ------------------------------------------------------------

async function createLoginUser({ apiUrl, serviceKey }, { email, password }) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (response.ok) {
    return 'created';
  }

  const body = await response.text();

  if (response.status === 422 || /already been registered|email_exists/i.test(body)) {
    return 'exists';
  }

  fail(`Creating the local login user failed (HTTP ${response.status}): ${body}`);
}

async function addToAllowlist({ apiUrl, serviceKey }, email) {
  const response = await fetch(`${apiUrl}/rest/v1/dashboard_users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify([{ email, note: 'local dev' }]),
  });

  if (!response.ok) {
    fail(`Adding ${email} to public.dashboard_users failed (HTTP ${response.status}): ${await response.text()}`);
  }
}

async function provision(stack) {
  const email = resolveLoginEmail();
  const { password, generatedPassword } = resolveLoginPassword();
  const outcome = await createLoginUser(stack, { email, password });

  log(outcome === 'created' ? `✓ Created local login user ${email}` : `✓ Local login user ${email} already exists`);

  await addToAllowlist(stack, email);
  log('✓ Allow-listed that email in public.dashboard_users');

  const updates = {
    VITE_SUPABASE_URL: stack.apiUrl,
    VITE_SUPABASE_ANON_KEY: stack.anonKey,
    HUB_SUPABASE_JWT_SERVICE_ROLE_KEY: stack.serviceKey,
    VITE_DASHBOARD_ALLOWED_EMAIL: email,
  };

  // Only persist a password this script generated; a password you set in `.env` stays there.
  if (generatedPassword && outcome === 'created') {
    updates.LOCAL_DEV_PASSWORD = password;
  }

  writeEnvLocal(updates);
  log('✓ Wrote local URL, keys and login email to .env.local (git-ignored)');

  log('');
  log(`  Sign in as   ${email}`);
  log(
    generatedPassword
      ? '  Password     LOCAL_DEV_PASSWORD in .env.local (set your own there or in .env to pin it)'
      : '  Password     LOCAL_DEV_PASSWORD from your env file',
  );

  if (outcome === 'exists' && generatedPassword) {
    log('               (user predates this password — `npm run db:reset` re-creates it)');
  }

  if (stack.studioUrl) {
    log(`  Studio       ${stack.studioUrl}`);
  }

  log('');
  log('  Next: npm run dev');
}

async function seedDemo(stack) {
  const counts = await seedDemoData(stack);
  const summary = Object.entries(counts)
    .map(([table, count]) => `${count} ${table}`)
    .join(', ');

  log(`✓ Seeded demo data: ${summary}`);
}

// --- Commands ----------------------------------------------------------------

async function up(cli) {
  await ensureDocker();

  const stack = ensureStack(cli);

  if (withDemoData) {
    await seedDemo(stack);
  }

  await provision(stack);
}

async function reset(cli) {
  await ensureDocker();

  const stack = ensureStack(cli);

  log('… Resetting the local database (re-applies migrations and seeds)');

  if (runSupabase(cli, ['db', 'reset']) !== 0) {
    fail('`supabase db reset` failed. Fix the error above, then re-run this command.');
  }

  if (withDemoData) {
    await seedDemo(stack);
  }

  await provision(stack);
}

async function demo(cli) {
  await ensureDocker();
  await seedDemo(ensureStack(cli));
  log('  Reload the dashboard to see it.');
}

function down(cli) {
  if (!dockerIsRunning()) {
    log('✓ Docker is not running — nothing to stop');
    return;
  }

  if (runSupabase(cli, ['stop']) !== 0) {
    fail('`supabase stop` failed. Fix the error above, then re-run this command.');
  }

  log('✓ Supabase local stack stopped (.env.local still points at it — delete that file to use `.env` again)');
}

const cli = resolveSupabaseCli();

log(`  Supabase CLI: ${cli.label}`);

switch (command) {
  case 'up':
    await up(cli);
    break;
  case 'down':
    down(cli);
    break;
  case 'reset':
    await reset(cli);
    break;
  case 'demo':
    await demo(cli);
    break;
  default:
    fail(`Unknown command "${command}". Use one of: up, down, reset, demo.`);
}
