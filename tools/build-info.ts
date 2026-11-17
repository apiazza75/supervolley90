/**
 * Write public/build-info.json.
 *
 * The rejected delivery could not be tied to a commit by looking at it, so a
 * build that was months of work and a build that was one stale artifact were
 * indistinguishable on screen. Now the identity is generated at build time,
 * shipped inside the app, and shown in the menu and on the pause screen — and
 * CI compares it against the SHA it is building.
 *
 *   npx tsx tools/build-info.ts
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

function git(cmd: string, fallback: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

// DELIVERY_SHA is set by CI. On a pull_request event GITHUB_SHA is the
// ephemeral merge commit rather than the commit being delivered, and a build
// stamped with a SHA that exists nowhere in the branch cannot be traced back
// to anything — which is the one job this manifest has.
const commit =
  process.env.DELIVERY_SHA ?? process.env.GITHUB_SHA ?? git('rev-parse HEAD', 'unknown');
const branch =
  process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  git('rev-parse --abbrev-ref HEAD', 'unknown');
const repository = process.env.GITHUB_REPOSITORY ?? 'apiazza75/supervolley90';
const runId = process.env.GITHUB_RUN_ID ?? 'local';
// Local work can include authored art and uncommitted gameplay changes. Keep
// the git baseline while identifying the actual source shipped in this build.
const fingerprint = createHash('sha256');
function hashSource(path: string): void {
  if (!existsSync(path) || path === 'public/build-info.json') return;
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) hashSource(`${path}/${name}`);
  } else {
    fingerprint.update(path); fingerprint.update('\0'); fingerprint.update(readFileSync(path));
  }
}
for (const path of ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts']) hashSource(path);
const sourceHash = fingerprint.digest('hex');
const dirty = git('status --porcelain --untracked-files=normal', '').length > 0;

const info = {
  repository,
  branch,
  commit,
  shortCommit: commit.slice(0, 7),
  runId,
  builtAt: new Date().toISOString(),
  sourceHash,
  dirty,
};

mkdirSync(resolve('public'), { recursive: true });
writeFileSync(resolve('public/build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info: ${info.shortCommit} run ${info.runId} (${info.branch})`);
