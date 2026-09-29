/**
 * The update runner: the detached process that runs one job's npm commands.
 *
 * `spawnUpdateRunner()` starts it with `<dir> <install|rollback>` as argv and `job.log` as both of
 * its output streams; everything else it needs is in `job.json`, which is what lets it outlive its
 * caller — by the time the last command exits, the API that asked for the update may be a different
 * process, or gone, and the job file is the only channel the two share. It alone writes the job, for
 * every step change, in the two states a live install has: `installing` and `rolling-back`. Running
 * one command — argv, no shell, the ceiling, the framing — is `runner-command.ts`.
 *
 * Two rules hold everywhere here: a failed step is recorded in the command's own words and the steps
 * after it are left `pending` (that job has lost, and the reconciler only moves a job onwards out of
 * `installed`, so nothing would commit or restart what they changed); and where a half-done install
 * could mislead the restart that follows it, the version that was there is put back first.
 */

import { fileURLToPath } from 'node:url';

import type { ClaudeUpdateJob, ClaudeUpdatePackageKey, ClaudeUpdateStep } from '@/shared/claude-update-types.js';

import { packageRow, readSdkVersionOnDisk } from './packages.js';
import { gitDetail, runCommand, say } from './runner-command.js';
import { PACKAGE_FILES, hashPackageFiles, readJob, stepOf, writeJob } from './update-job.js';

/** How often the runner re-reads `job.json` while it waits for the spawner to name it. */
const JOB_POLL_MS = 100;

/** The ceiling on that wait. The spawner's write is one rename just behind the spawn; this is for a
 *  spawner that died between the two, not for a slow write. */
const JOB_WAIT_MS = 10_000;

/** The repo this runner belongs to, from this file's own location — `<repo>/server/modules/
 *  claude-updates/update-runner.ts` — so a hand-run copy installs into the tree it belongs to rather
 *  than into whatever directory it started in. The spawner sets the same directory as the cwd. */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** `cli` and `sdk` are installed by this process; `restart` and `commit` belong to the API. */
function isInstallStep(step: ClaudeUpdateStep): boolean {
  return step.key === 'cli' || step.key === 'sdk';
}

/** A step becomes `running` in the FILE before its command starts, so the log's `$ <command>` line
 *  is never the first thing said about it. */
function markRunning(dir: string, job: ClaudeUpdateJob, step: ClaudeUpdateStep): void {
  step.state = 'running';
  step.startedAt = Date.now();
  step.endedAt = null;
  writeJob(dir, job);
}

/** The other half: the step's verdict, written the moment it is known. Every step change reaches
 *  `job.json`, which is what a report polls. */
function markEnded(
  dir: string,
  job: ClaudeUpdateJob,
  step: ClaudeUpdateStep,
  state: 'done' | 'failed' | 'skipped',
  detail: string,
): void {
  step.state = state;
  step.detail = detail;
  step.endedAt = Date.now();
  writeJob(dir, job);
}

/** One package's install command: `-g` into npm's global tree for the CLI — the one the
 *  `readCliUpdatable()` rule decides is updatable — and `--save` for the SDK, this repo's dependency.
 *  The version reaches npm as ONE argv word: nothing in it is a shell word, a flag or a package. */
function installArgv(key: ClaudeUpdatePackageKey, version: string): string[] {
  const row = packageRow(key);
  const spec = `${row.name}@${version}`;
  return row.scope === 'global' ? ['npm', 'install', '-g', spec] : ['npm', 'install', '--save', spec];
}

/** The restore of the two package files to HEAD, which is where a clean job started. */
function gitRestoreArgv(): string[] {
  return ['git', 'checkout', 'HEAD', '--', ...PACKAGE_FILES];
}

/** The CLI's step: one global install, and the exit code is the whole verdict. Whether the binary
 *  that ANSWERS is the new one is the reconciler's question, asked once this process is gone. */
async function installCli(dir: string, job: ClaudeUpdateJob, step: ClaudeUpdateStep, version: string): Promise<boolean> {
  markRunning(dir, job, step);
  const result = await runCommand(installArgv('cli', version), REPO_ROOT);
  const installed = result.code === 0;
  const detail = installed ? `npm installed ${packageRow('cli').label} ${version}` : result.detail;
  markEnded(dir, job, step, installed ? 'done' : 'failed', detail);
  return installed;
}

/**
 * Puts the previous SDK back after an install that did not land: the same command with the step's
 * `from`, and — when the repo was clean when the job started — `git checkout HEAD -- package.json
 * package-lock.json` over it, the only thing that can undo a `--save` npm wrote its own way.
 *
 * What the restore became is appended to the step's detail in the `; <version> restored` shape the
 * rollback uses: a reader has to tell a tree that was put back from one a failed install abandoned.
 */
async function restoreSdk(dir: string, job: ClaudeUpdateJob, step: ClaudeUpdateStep): Promise<void> {
  const from = step.from;
  if (from === null) {
    step.detail = `${step.detail}; the version to restore to is not known`;
  } else {
    const restored = await runCommand(installArgv('sdk', from), REPO_ROOT);
    const outcome = restored.code === 0 ? `${from} restored` : `the restore itself failed: ${restored.detail}`;
    step.detail = `${step.detail}; ${outcome}`;
  }

  if (job.packageFiles.cleanAtStart) {
    const checkout = await runCommand(gitRestoreArgv(), REPO_ROOT);
    if (checkout.code !== 0) step.detail = `${step.detail}; git could not restore the package files: ${gitDetail(checkout)}`;
  }
  writeJob(dir, job);
}

/**
 * The SDK's step: this repo's own dependency, so the proof of the install is not the exit code alone
 * but the package that ANSWERS afterwards — `readSdkVersionOnDisk() === version`. npm can exit 0
 * having put something else in place, and what is on disk is the only claim the restart may act on.
 *
 * When it does not land, the previous version is put back here rather than left to the API: the next
 * thing that happens to this repository is a server restart onto whatever the SDK resolves to, and a
 * half-installed SDK is not something to restart onto.
 */
async function installSdk(dir: string, job: ClaudeUpdateJob, step: ClaudeUpdateStep, version: string): Promise<boolean> {
  markRunning(dir, job, step);
  const result = await runCommand(installArgv('sdk', version), REPO_ROOT);

  if (result.code === 0 && readSdkVersionOnDisk() === version) {
    // The commit guard's after-picture, taken here because this is the one moment the files hold
    // what the install left them (INV-100): a later read could be a later writer's.
    job.packageFiles.hashesAfterInstall = hashPackageFiles(REPO_ROOT);
    markEnded(dir, job, step, 'done', `npm installed ${packageRow('sdk').label} ${version}`);
    return true;
  }

  markEnded(dir, job, step, 'failed', result.detail);
  await restoreSdk(dir, job, step);
  for (const key of ['restart', 'commit'] as const) {
    const apiStep = stepOf(job, key);
    if (apiStep) markEnded(dir, job, apiStep, 'skipped', 'the SDK did not install');
  }
  return false;
}

/** INSTALL: the install steps this job has, in order, exactly once each. The end state is `installed`
 *  when every one of them is done, and `failed` otherwise. */
async function runInstall(dir: string, job: ClaudeUpdateJob): Promise<void> {
  const installs = job.steps.filter(isInstallStep);
  // `every` over none is `true`, so a green `installed` for a run that installed nothing is the one
  // answer this may not give: a job naming no install step can never be finished.
  if (installs.length === 0) throw new Error('the job names no install step');
  for (const step of installs) {
    const version = step.to;
    if (version === null) {
      markEnded(dir, job, step, 'failed', 'the version to install is not known');
      break;
    }
    const landed = step.key === 'cli'
      ? await installCli(dir, job, step, version)
      : await installSdk(dir, job, step, version);
    if (!landed) break;
  }

  const finished = installs.every((step) => step.state === 'done');
  job.state = finished ? 'installed' : 'failed';
  // `installed` deliberately leaves `endedAt` null — that job is not over, it is waiting for the API
  // to restart onto what was just installed — while `failed` is a job nothing else will happen to.
  if (!finished) job.endedAt = Date.now();
  writeJob(dir, job);
}

/**
 * ROLLBACK: put the Agent SDK back to the version the last update moved away from.
 *
 * It is an install like any other, and it ends ON the sdk step rather than on a fresh one: that step
 * already carries the from/to pair a person reads, and what became of the command is the job's
 * answer. The serving process keeps what it loaded — the report says so in words — so this process
 * only makes the disk match the version that is coming back.
 */
async function runRollback(dir: string, job: ClaudeUpdateJob): Promise<void> {
  const step = stepOf(job, 'sdk');
  const from = step?.from ?? null;
  if (!step || from === null) {
    // No SDK step, or no version to come back to: a rollback that ran anyway would install whatever
    // it guessed. The log's own line is the whole record of why nothing happened.
    say('nothing to roll back to: the job does not name an Agent SDK version');
    job.state = 'failed';
    job.endedAt = Date.now();
    writeJob(dir, job);
    return;
  }

  markRunning(dir, job, step);
  const installed = await runCommand(installArgv('sdk', from), REPO_ROOT);
  let failure: string | null = null;
  if (installed.code !== 0) {
    failure = `the rollback's npm install failed: ${installed.detail} — node_modules may not match package-lock.json`;
  } else if (job.packageFiles.cleanAtStart) {
    const checkout = await runCommand(gitRestoreArgv(), REPO_ROOT);
    if (checkout.code !== 0) {
      failure = `the rollback's git checkout failed: ${gitDetail(checkout)} — node_modules may not match package-lock.json`;
    }
  }

  if (failure === null) {
    step.state = 'done';
    step.detail = `npm installed ${packageRow('sdk').label} ${from}; ${from} restored`;
    const commit = stepOf(job, 'commit');
    if (commit) markEnded(dir, job, commit, 'skipped', `nothing to commit — Claude Agent SDK ${from} is back`);
    job.state = 'rolled-back';
  } else {
    step.state = 'failed';
    step.detail = failure;
    job.state = 'failed';
  }
  step.endedAt = Date.now();
  job.endedAt = Date.now();
  writeJob(dir, job);
}

/**
 * Waits for `job.json` to name this process, for at most JOB_WAIT_MS, and answers the job when it
 * does. The write is one rename right behind the spawn, so the pid is there within a poll or two;
 * the refusal it makes possible is what matters. A hand-run copy of this file, or a second spawn of
 * a job directory something else owns, would install the same versions a second time — or roll back
 * a tree another job is midway through. A runner that is not named does nothing and says so.
 */
async function awaitJob(dir: string): Promise<ClaudeUpdateJob | null> {
  const deadline = Date.now() + JOB_WAIT_MS;
  for (;;) {
    const job = readJob(dir);
    if (job && job.runnerPid === process.pid) return job;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }
}

/**
 * A throw that reached the top: whatever step was running is marked failed in the error's own words,
 * and the job with it, both written before this process goes. Leaving the job in `installing` is not
 * the neutral choice it looks like: the reconciler reads that state with a dead runner as
 * `interrupted`, which says the runner vanished rather than what actually went wrong.
 */
function markTopLevelFailure(dir: string, job: ClaudeUpdateJob, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  say(`the runner stopped: ${message}`);
  const running = job.steps.find((step) => step.state === 'running');
  if (running) {
    running.state = 'failed';
    running.detail = message;
    running.endedAt = Date.now();
  }
  job.state = 'failed';
  job.endedAt = Date.now();
  writeJob(dir, job);
}

/**
 * The whole run: argv is `<dir> <install|rollback>`, and the cwd becomes this file's own repository
 * before anything is spawned — npm writes package.json for the directory it is run in, and git
 * answers for that directory's tree. The exit code is about THIS process, not about the job: 0 once
 * the verdict is on disk, whatever it says, and 1 only when it never got that far.
 */
async function main(): Promise<void> {
  const dir = process.argv[2];
  const mode = process.argv[3];
  if (!dir || (mode !== 'install' && mode !== 'rollback')) {
    say(`usage: update-runner.ts <dir> <install|rollback> — got '${process.argv.slice(2).join(' ') || 'nothing'}'`);
    process.exit(1);
  }

  const job = await awaitJob(dir);
  if (!job) {
    say(`the job never named this runner (pid ${process.pid})`);
    process.exit(1);
  }

  try {
    process.chdir(REPO_ROOT);
    if (mode === 'install') await runInstall(dir, job);
    else await runRollback(dir, job);
  } catch (error) {
    markTopLevelFailure(dir, job, error);
    process.exit(1);
  }
  process.exit(0);
}

void main();
