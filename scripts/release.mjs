// Two-phase release automation for StackVitals.
//
// Phase 1 — prep:  parse changelog, push dev, create release PR
//   node scripts/release.mjs prep [--version X.Y.Z] [--dry-run]
//
// Phase 2 — ship:  bump version, finalize changelog, squash-merge PR,
//                   tag, GitHub release, reset dev
//   node scripts/release.mjs ship [--version X.Y.Z] [--dry-run]
//
// Both phases are non-interactive — no TTY prompts. Safe for AI and CI use.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVersion, compareVersions, incrementVersion, suggestLevel } from './release-version.mjs';

const projectRoot = process.cwd();
const gitSafeDirectory = projectRoot.replaceAll('\\', '/');
const args = process.argv.slice(2);
const subcommand = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const versionFlag = (() => {
  const idx = args.indexOf('--version');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();

const APP_NAME = 'StackVitals';
const DEPLOY_BRANCH = 'main';
const INTEGRATION_BRANCH = 'dev';
const REPO = 'SteveWang92/stackvitals';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const run = (command, runArgs, options = {}) => {
  const result = spawnSync(command, runArgs, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: options.shell ?? false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(options.inherit ? `${command} failed with exit code ${result.status}.` : result.stderr?.trim() || `${command} failed.`);
  }
  return result.stdout?.trim() ?? '';
};

const git = (gitArgs) => run('git', ['-c', `safe.directory=${gitSafeDirectory}`, ...gitArgs]);

const gh = (ghArgs) => run('gh', ghArgs);

const latestTag = () => {
  const tags = git(['tag', '--list', 'v[0-9]*', '--sort=-version:refname']).split(/\r?\n/).filter(Boolean);
  const tag = tags.find((t) => parseVersion(t.slice(1)));
  return tag ? { tag, version: tag.slice(1) } : null;
};

const commitsSince = (tag) => {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const output = git(['log', range, '--format=%s%x1f%b%x1e']);
  return output
    .split('\x1e')
    .map((entry) => {
      const [subject = '', body = ''] = entry.trim().split('\x1f');
      return { subject: subject.trim(), body: body.trim() };
    })
    .filter((c) => c.subject);
};

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

// ---------------------------------------------------------------------------
// Changelog helpers
// ---------------------------------------------------------------------------

const CHANGELOG_PATH = join(projectRoot, 'CHANGELOG.md');

const readChangelog = () => readFile(CHANGELOG_PATH, 'utf8');

const parseUnreleased = (content) => {
  const heading = '## [Unreleased]';
  const start = content.indexOf(heading);
  if (start < 0) throw new Error('No [Unreleased] section in CHANGELOG.md.');
  const afterHeading = content.indexOf('\n', start) + 1;
  const nextSection = content.indexOf('\n## [', afterHeading);
  const body = nextSection >= 0 ? content.slice(afterHeading, nextSection) : content.slice(afterHeading);
  return body.trim();
};

const finalizeChangelog = async (version, prevTag) => {
  let content = await readChangelog();
  const tag = `v${version}`;
  const dateStr = today();

  const heading = '## [Unreleased]';
  const headingPos = content.indexOf(heading);
  if (headingPos < 0) throw new Error('No [Unreleased] section in CHANGELOG.md.');
  const afterHeading = headingPos + heading.length;
  const nextSection = content.indexOf('\n## [', afterHeading);

  const unreleasedBody = nextSection >= 0 ? content.slice(afterHeading, nextSection) : content.slice(afterHeading);

  const before = content.slice(0, headingPos);
  const after = nextSection >= 0 ? content.slice(nextSection) : '';

  content = `${before}## [Unreleased]\n\n## [${version}] - ${dateStr}${unreleasedBody}\n${after}`;

  if (prevTag) {
    content = content.replace(
      `[Unreleased]: https://github.com/${REPO}/compare/${prevTag}...HEAD`,
      `[Unreleased]: https://github.com/${REPO}/compare/${tag}...HEAD\n[${version}]: https://github.com/${REPO}/compare/${prevTag}...${tag}`,
    );
  } else {
    const linksStart = content.lastIndexOf('\n[');
    const insertPos = linksStart >= 0 ? linksStart + 1 : content.length;
    const links = `[Unreleased]: https://github.com/${REPO}/compare/${tag}...HEAD\n[${version}]: https://github.com/${REPO}/releases/tag/${tag}\n`;
    content = content.slice(0, insertPos) + links + content.slice(insertPos);
  }

  await writeFile(CHANGELOG_PATH, content, 'utf8');
};

// ---------------------------------------------------------------------------
// Version bump
// ---------------------------------------------------------------------------

const bumpPackageVersion = async (version) => {
  const pkgPath = join(projectRoot, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.version = version;
  await writeJson(pkgPath, pkg);

  const lockPath = join(projectRoot, 'package-lock.json');
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    if ('version' in lock) lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    await writeJson(lockPath, lock);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
};

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const prep = async () => {
  const branch = git(['branch', '--show-current']);
  if (branch !== INTEGRATION_BRANCH) {
    throw new Error(`Must be on ${INTEGRATION_BRANCH}, currently on ${branch || 'detached HEAD'}.`);
  }
  if (git(['status', '--porcelain'])) {
    throw new Error('Working tree is not clean. Commit or stash changes first.');
  }

  git(['fetch', 'origin']);
  git(['merge', '--ff-only', `origin/${INTEGRATION_BRANCH}`]);

  const changelog = await readChangelog();
  const unreleased = parseUnreleased(changelog);
  if (!unreleased) {
    throw new Error('[Unreleased] section in CHANGELOG.md is empty. Add changelog entries before releasing.');
  }

  const latest = latestTag();
  const commits = commitsSince(latest?.tag);
  const level = suggestLevel(commits);
  const currentPkgVersion = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version;
  const suggested = incrementVersion(latest?.version ?? currentPkgVersion, level);
  const version = versionFlag ?? suggested;

  if (!parseVersion(version)) {
    throw new Error(`Invalid version "${version}". Use major.minor.patch.`);
  }
  if (latest && compareVersions(version, latest.version) <= 0) {
    throw new Error(`Version ${version} must be newer than ${latest.tag}.`);
  }
  if (git(['tag', '--list', `v${version}`])) {
    throw new Error(`Tag v${version} already exists.`);
  }

  console.log(`App:          ${APP_NAME}`);
  console.log(`Latest tag:   ${latest?.tag ?? 'none'}`);
  console.log(`Commits:      ${commits.length}`);
  console.log(`Suggested:    ${level} -> ${suggested}`);
  console.log(`Version:      ${version}`);
  console.log('');
  console.log('Unreleased changelog:');
  console.log(unreleased);
  console.log('');

  if (dryRun) {
    console.log('Dry run complete. No PR created.');
    return;
  }

  git(['push', 'origin', INTEGRATION_BRANCH]);

  const existingPR = JSON.parse(
    gh([
      'pr',
      'list',
      '--repo',
      REPO,
      '--head',
      INTEGRATION_BRANCH,
      '--base',
      DEPLOY_BRANCH,
      '--state',
      'open',
      '--json',
      'number,title',
      '--limit',
      '1',
    ]),
  );
  if (existingPR.length > 0) {
    throw new Error(
      `Open PR already exists: #${existingPR[0].number} "${existingPR[0].title}". ` + 'Close it or run "ship" to complete the release.',
    );
  }

  // The PR title becomes the squash subject verbatim, so it must be a Conventional
  // Commit line. GitHub appends " (#N)" to it — passing --subject at merge time would
  // not, which is why ship never overrides it.
  const title = `chore(release): v${version}`;
  const body = `## Changelog\n\n${unreleased}`;
  const prUrl = gh([
    'pr',
    'create',
    '--repo',
    REPO,
    '--base',
    DEPLOY_BRANCH,
    '--head',
    INTEGRATION_BRANCH,
    '--title',
    title,
    '--body',
    body,
  ]);

  console.log(`PR created: ${prUrl}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the PR and fix any issues');
  console.log(`  2. Run: node scripts/release.mjs ship --version ${version}`);
};

const ship = async () => {
  const branch = git(['branch', '--show-current']);
  if (branch !== INTEGRATION_BRANCH) {
    throw new Error(`Must be on ${INTEGRATION_BRANCH}, currently on ${branch || 'detached HEAD'}.`);
  }
  if (git(['status', '--porcelain'])) {
    throw new Error('Working tree is not clean. Commit or stash changes first.');
  }

  git(['fetch', 'origin']);
  git(['merge', '--ff-only', `origin/${INTEGRATION_BRANCH}`]);

  const prListJson = gh([
    'pr',
    'list',
    '--repo',
    REPO,
    '--head',
    INTEGRATION_BRANCH,
    '--base',
    DEPLOY_BRANCH,
    '--state',
    'open',
    '--json',
    'number,title',
    '--limit',
    '1',
  ]);
  const prs = JSON.parse(prListJson);
  if (prs.length === 0) {
    throw new Error('No open release PR found. Run "prep" first.');
  }
  const pr = prs[0];
  console.log(`Found PR: #${pr.number} "${pr.title}"`);

  let version = versionFlag;
  if (!version) {
    const match = pr.title.match(/v(\d+\.\d+\.\d+)/);
    if (match) version = match[1];
  }
  if (!version) {
    throw new Error('Could not determine version from PR title. Pass --version X.Y.Z.');
  }
  if (!parseVersion(version)) {
    throw new Error(`Invalid version "${version}".`);
  }

  const latest = latestTag();
  const releaseTag = `v${version}`;
  if (git(['tag', '--list', releaseTag])) {
    throw new Error(`Tag ${releaseTag} already exists.`);
  }

  console.log(`Version:    ${version}`);
  console.log(`Tag:        ${releaseTag}`);
  console.log(`Merging:    PR #${pr.number}`);
  console.log('');

  if (dryRun) {
    console.log('Dry run complete. No changes made.');
    return;
  }

  // 1. Bump version + finalize changelog
  await bumpPackageVersion(version);
  await finalizeChangelog(version, latest?.tag);
  git(['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
  git(['commit', '-m', `chore(release): ${releaseTag}`]);
  console.log(`Committed chore(release): ${releaseTag}`);

  // 2. Push dev (includes the release commit)
  git(['push', 'origin', INTEGRATION_BRANCH]);
  console.log('Pushed dev.');

  // 3. Squash merge the PR — no --subject, so GitHub uses the PR title and appends
  //    " (#N)". Only the auto-generated body is stripped.
  console.log(`Squash-merging PR #${pr.number}...`);
  gh(['pr', 'merge', String(pr.number), '--repo', REPO, '--squash', '--body', '']);
  console.log('PR merged.');

  // 4. Sync main from remote
  git(['checkout', DEPLOY_BRANCH]);
  git(['pull', 'origin', DEPLOY_BRANCH]);
  console.log(`Synced ${DEPLOY_BRANCH}.`);

  // 5. Create annotated tag and push
  git(['tag', '-a', releaseTag, '-m', `${APP_NAME} ${version}`]);
  git(['push', 'origin', releaseTag]);
  console.log(`Tag ${releaseTag} pushed.`);

  // 6. Create GitHub release with changelog section as notes
  const changelog = await readChangelog();
  const versionHeading = `## [${version}]`;
  const vStart = changelog.indexOf(versionHeading);
  let releaseNotes = '';
  if (vStart >= 0) {
    const afterLine = changelog.indexOf('\n', vStart) + 1;
    const nextHeading = changelog.indexOf('\n## [', afterLine);
    releaseNotes = nextHeading >= 0 ? changelog.slice(afterLine, nextHeading).trim() : changelog.slice(afterLine).trim();
    const linksStart = releaseNotes.indexOf('\n[Unreleased]:');
    if (linksStart >= 0) releaseNotes = releaseNotes.slice(0, linksStart).trim();
  }

  gh(['release', 'create', releaseTag, '--repo', REPO, '--title', releaseTag, '--notes', releaseNotes || `${APP_NAME} ${version}`]);
  console.log(`GitHub release ${releaseTag} created.`);

  // 7. Reset dev to main and force push
  git(['checkout', INTEGRATION_BRANCH]);
  git(['reset', '--hard', DEPLOY_BRANCH]);
  git(['push', '--force-with-lease', 'origin', INTEGRATION_BRANCH]);
  console.log(`Reset ${INTEGRATION_BRANCH} to ${DEPLOY_BRANCH} and force-pushed.`);

  console.log('');
  console.log(`Release ${version} complete.`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (subcommand === 'prep') {
  await prep();
} else if (subcommand === 'ship') {
  await ship();
} else {
  console.error('Usage: node scripts/release.mjs <prep|ship> [--version X.Y.Z] [--dry-run]');
  console.error('');
  console.error('  prep   Create a release PR from dev -> main');
  console.error('  ship   Finalize, merge, tag, and publish the release');
  process.exit(1);
}
