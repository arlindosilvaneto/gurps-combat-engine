// Release tooling for this package. Used by .github/workflows.
//
//   node scripts/release.mjs check --base <git-ref>   PR gate: no local-path dependencies, and if the package changed
//                                                     since <ref> its version must not be published yet
//   node scripts/release.mjs publish [--dry-run]      publish the package if its version is not on the registry;
//                                                     tag and create a GitHub release
//
// A release is a version bump: `npm version patch --no-git-tag-version` in the PR; merging to main publishes.
// A package marked "private" is never published, so the pipeline stays inert until that is removed.
// The registry and its token come from the npm config (actions/setup-node writes them from NPM_REGISTRY_TOKEN).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pkg = readJson('package.json');
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
/** Changes to these paths change what gets published (tests, docs and CI don't). */
const RELEASED = [/^src\//, /^package\.json$/, /^tsconfig\.build\.json$/];

/** True when name@version is on the registry; a missing package or version is false; any other failure throws. */
function isPublished(name, version) {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim() !== '';
  if (/E404|404 Not Found/.test(r.stderr)) return false;
  throw new Error(`npm view ${name}@${version} failed:\n${r.stderr}`);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

/** Dependencies that point at a path on someone's machine instead of the registry. */
function localDependencies() {
  const problems = [];
  const isLocal = (spec) => /^(file|link):/.test(spec);
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
      if (isLocal(spec)) problems.push(`package.json: ${field}["${dep}"] is "${spec}", a local path. Depend on the published version.`);
    }
  }
  // A lockfile "link" entry is what `npm link` or an earlier file: dependency leaves behind, and it only works on that machine.
  if (existsSync('package-lock.json')) {
    for (const [path, entry] of Object.entries(readJson('package-lock.json').packages ?? {})) {
      if (entry.link) problems.push(`package-lock.json: "${path}" is a link to "${entry.resolved}". Reinstall it from the registry.`);
    }
  }
  return problems;
}

// ---------------- check (pull requests) ----------------
function check(base) {
  const problems = localDependencies();

  if (base && pkg.private) {
    console.log(`${pkg.name} is private, so there is nothing to release.`);
  } else if (base) {
    const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    const files = changed.filter((file) => RELEASED.some((pattern) => pattern.test(file)));
    if (files.length) {
      if (isPublished(pkg.name, pkg.version)) {
        problems.push(`${pkg.name} changed (${files.length} file(s), e.g. ${files[0]}) but ${pkg.version} is already published: `
          + 'bump it, e.g. `npm version patch --no-git-tag-version`.');
      } else {
        console.log(`${pkg.name}: changed; ${pkg.version} will be released when this is merged.`);
        summary(`- **${pkg.name}** ${pkg.version} will be released on merge`);
      }
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log('Release check passed.');
}

// ---------------- publish (pushes to main) ----------------
function releaseNotes(tagPrefix) {
  const previous = git('tag', '--list', `${tagPrefix}*`, '--sort=-v:refname').split('\n').filter(Boolean)[0];
  const log = git('log', '--no-merges', '--format=- %s (%h)', ...(previous ? [`${previous}..HEAD`] : []), '--', 'src', 'package.json');
  return `${previous ? `Changes since ${previous}:` : 'First release.'}\n\n${log || '- (no commits touching the package)'}`;
}

/** "latest" for a release, the prerelease id for 1.0.0-beta.1 (or "next" if it is numeric, as in 1.0.0-0). */
function distTag(version) {
  const id = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version)?.[1];
  if (id === undefined) return 'latest';
  return /^\d+$/.test(id) ? 'next' : id;
}

function publish(dryRun) {
  const { name, version } = pkg;
  summary(`### Package release${dryRun ? ' (dry run)' : ''}\n`);
  if (pkg.private) {
    console.log(`${name} is private; skipping. Remove "private" from package.json to release it.`);
    summary(`- ${name}: private, not released`);
    return;
  }
  if (isPublished(name, version)) {
    console.log(`${name}@${version} is already published; skipping.`);
    summary(`- ${name}@${version}: already published`);
    return;
  }

  const tag = distTag(version);
  const args = ['publish', '--tag', tag];
  if (process.env.NPM_PROVENANCE === 'true') args.push('--provenance');
  if (dryRun) args.push('--dry-run');
  console.log(`> npm ${args.join(' ')}`);
  execFileSync('npm', args, { stdio: 'inherit' });

  const release = `v${version}`;
  const prerelease = tag !== 'latest';
  if (!dryRun && process.env.GITHUB_ACTIONS === 'true') {
    execFileSync('gh', ['release', 'create', release, '--target', process.env.GITHUB_SHA, '--title', `${name} ${version}`,
      '--notes', releaseNotes('v'), ...(prerelease ? ['--prerelease'] : [])], { stdio: 'inherit' });
  }
  summary(`- **${name}@${version}** ${dryRun ? 'would be published' : 'published'} (dist-tag \`${tag}\`, release \`${release}\`)`);
}

const [command, ...rest] = process.argv.slice(2);
const option = (flag) => {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (command === 'check') check(option('--base'));
else if (command === 'publish') publish(rest.includes('--dry-run'));
else {
  console.error('usage: node scripts/release.mjs check [--base <git-ref>] | publish [--dry-run]');
  process.exit(2);
}
