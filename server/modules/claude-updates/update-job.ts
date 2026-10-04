/**
 * The job file: what a Claude update is doing, in one place on disk that outlives the process doing
 * it.
 *
 * An update is a detached runner installing two packages and then a reboot; the API that asked for
 * it may be gone before the install ends, and after the reboot it is a DIFFERENT process. So the job
 * is a file, `job.json`, and its output a second one beside it, `job.log` — both under
 * `~/.cloudcli/claude-updates/` (or `CLOUDCLI_CLAUDE_UPDATES_DIR`), the one directory the pipeline
 * writes in and nothing else does.
 *
 * Two writers, one ruleset, and the split is by STATE: `installing` and `rolling-back` belong to the
 * detached runner, which is the only process that can see the commands it is running; every other
 * state belongs to the API's reconciler, which is the only one that can see the server after a
 * handover. Each write is a rename of a fully written temp file, so a reader never sees half a job.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ClaudeUpdateJob, ClaudeUpdatePackageKey, ClaudeUpdateStep, ClaudeUpdateStepKey } from '@/shared/claude-update-types.js';
import { expandHome } from '@/shared/utils.js';

const JOB_FILE = 'job.json';
const LOG_FILE = 'job.log';

/**
 * The two files an Agent SDK install rewrites, and the only paths this pipeline ever names to git.
 * Everything that touches them reads the list from here: the rollback's `git checkout`, the commit
 * guard's hashes, and the pathspec commit itself (INV-100 — a commit that names a path commits the
 * FULL working-tree content of it, so the paths it names must be exactly the ones npm wrote).
 */
export const PACKAGE_FILES = ['package.json', 'package-lock.json'] as const;

/**
 * The one directory the pipeline writes in: `CLOUDCLI_CLAUDE_UPDATES_DIR` when set, else
 * `~/.cloudcli/claude-updates`. Created on every call with `mkdir -p` and mode 0700 — the job file
 * names versions and the log carries command output, and neither is anybody else on the machine's
 * business.
 */
export function claudeUpdatesDir(): string {
  const dir = expandHome(
    process.env.CLOUDCLI_CLAUDE_UPDATES_DIR || path.join(os.homedir(), '.cloudcli', 'claude-updates'),
  );
  ensureDir(dir);
  return dir;
}

/** The same create-on-demand for a caller handed a directory rather than asking for one — the runner
 *  gets its own as argv. `recursive` makes it a no-op on an existing directory, and an existing
 *  directory keeps the mode it has. */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * The current job, or null. Null covers every way there is no job to act on: the file is absent, it
 * cannot be read, it does not parse, or what it parses to is not a job this build can drive — an id
 * to name it, a state every reader branches on, and the steps every surface lists. Anything less is
 * a shape from another build, or from a hand-edit, and doing nothing beats guessing at it.
 */
export function readJob(dir: string): ClaudeUpdateJob | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, JOB_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const shape = parsed as { id?: unknown; state?: unknown; steps?: unknown };
  const isJob = typeof shape.id === 'string' && typeof shape.state === 'string' && Array.isArray(shape.steps);
  return isJob ? (parsed as ClaudeUpdateJob) : null;
}

/**
 * Writes the job: a fully written temp file first, then a rename over `job.json`, so a reader either
 * sees the previous job whole or this one whole, never a half-written file.
 *
 * `logTail` is always stored EMPTY. It is a report-only field — the last lines of `job.log`, filled
 * by the API when it answers — and storing it in the file would make the job file grow with the log
 * it sits beside.
 */
export function writeJob(dir: string, job: ClaudeUpdateJob): void {
  ensureDir(dir);
  const target = path.join(dir, JOB_FILE);
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify({ ...job, logTail: [] }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, target);
}

/**
 * One step of this job by key, or null when the job has no such step — a cli-only update has no
 * `restart` and no `commit`, and every writer asks before it touches one. A step a job does not
 * carry is not the same as a step still pending, which is why the two answers are `null` and a step.
 */
export function stepOf(job: ClaudeUpdateJob, key: ClaudeUpdateStepKey): ClaudeUpdateStep | null {
  return job.steps.find((step) => step.key === key) ?? null;
}

/** The last `lines` lines of `job.log` — the tail the report carries. An absent or unreadable log is
 *  an empty tail, which is what a job that has not printed anything yet honestly has, and so is a
 *  caller asking for no lines at all. */
export function readLogTail(dir: string, lines: number): string[] {
  // Zero, a negative or a NaN asks for NOTHING, and that has to be said out loud rather than left to
  // a negative index: `slice(-0)` IS `slice(0)`, so a count of zero through the guard below comes
  // back with the whole log instead of none of it.
  if (!(lines >= 1)) return [];
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, LOG_FILE), 'utf8');
  } catch {
    return [];
  }
  const all = text.split('\n');
  while (all.length > 0 && all[all.length - 1] === '') all.pop(); // a trailing newline is not a line
  return all.slice(-lines);
}

/** The sha256 of one file as hex, or the empty string when it cannot be read. */
function sha256Of(file: string): string {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

/**
 * The sha256 of the two files an Agent SDK install rewrites, before and after.
 *
 * An unreadable file hashes to the empty string, which equals no real digest. That is the safe
 * direction for the only two readers: the commit guard compares these hashes against what the
 * runner left, so a file it cannot read is a commit that does not happen, never one that happens
 * blind (INV-100).
 */
export function hashPackageFiles(appRoot: string): { packageJson: string; packageLock: string } {
  const [packageJsonFile, packageLockFile] = PACKAGE_FILES;
  return {
    packageJson: sha256Of(path.join(appRoot, packageJsonFile)),
    packageLock: sha256Of(path.join(appRoot, packageLockFile)),
  };
}

/**
 * Whether the runner this job spawned is still running.
 *
 * Signal 0 asks the kernel whether the pid exists; the second half asks whether it is still OUR pid.
 * A pid alone is not proof — the machine recycles them — so the proof is the runner's own argv,
 * read from `/proc/<pid>/cmdline`, naming `update-runner`. Both halves are required: a live pid that
 * is something else is a dead runner, and saying otherwise would leave a job stuck in `installing`
 * for good.
 */
export function isRunnerAlive(pid: number | null): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('update-runner');
  } catch {
    return false; // no /proc entry to read: gone is the only safe reading
  }
}

/** What a caller must decide before a job exists. `installed` is what each package answers NOW, so
 *  the steps carry the version the job is moving away from rather than one read later. */
type JobRequest = {
  kind: ClaudeUpdateJob['kind'];
  targets: Partial<Record<ClaudeUpdatePackageKey, string>>;
  installed: Partial<Record<ClaudeUpdatePackageKey, string | null>>;
  cleanAtStart: boolean;
};

/** One step, pending, with its own from/to. */
function pendingStep(key: ClaudeUpdateStepKey, from: string | null | undefined, to: string | null | undefined): ClaudeUpdateStep {
  return { key, state: 'pending', from: from ?? null, to: to ?? null, detail: null, startedAt: null, endedAt: null };
}

/**
 * A new job, in memory, with its log truncated — and deliberately NOT written.
 *
 * The caller writes the file once, after spawning the runner, so the first version on disk already
 * carries `runnerPid`: a job whose pid arrives later is a job the reconciler could read as a runner
 * that died before it started.
 *
 * The steps are only the ones this job has. `cli` and `sdk` come from the targets the caller asked
 * for; `restart` and `commit` come with an sdk step exactly, because installing an SDK package is
 * only finished once the process that imported the old one is gone, and only an SDK install changes
 * the files a commit would name. Both carry the SDK step's own from/to — they are about that
 * version, not about the job.
 */
export function createJob(dir: string, request: JobRequest): ClaudeUpdateJob {
  const steps: ClaudeUpdateStep[] = [];
  if (request.targets.cli) steps.push(pendingStep('cli', request.installed.cli, request.targets.cli));
  if (request.targets.sdk) {
    steps.push(pendingStep('sdk', request.installed.sdk, request.targets.sdk));
    steps.push(pendingStep('restart', request.installed.sdk, request.targets.sdk));
    steps.push(pendingStep('commit', request.installed.sdk, request.targets.sdk));
  }

  const now = Date.now();
  const job: ClaudeUpdateJob = {
    id: now.toString(36),
    kind: request.kind,
    state: 'installing',
    startedAt: now,
    endedAt: null,
    runnerPid: null,
    steps,
    restart: { requestedAt: null, requestedBy: null },
    packageFiles: { cleanAtStart: request.cleanAtStart, hashesAfterInstall: null },
    logTail: [],
  };

  // The log belongs to THIS job: truncated, and created when it is not there yet, so the runner's
  // first line lands in an empty file and nobody ever reads the last job's output here.
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, LOG_FILE), '', { mode: 0o600 });

  return job;
}

/**
 * Spawns the runner that does the installing, detached, and answers its pid at once.
 *
 * DETACHED is the whole point. The API that asked for this update is about to be replaced by a new
 * process — that is what the restart step is for — and the install has to outlive it, so the runner
 * gets a session of its own and the caller never waits: it gets a pid back, writes it into the job,
 * and the reconciler reads the job file from then on.
 *
 * The loader pair is the one `deploy/dev-supervisor/child.mjs` builds, and for the same reason it
 * gives: through the tsx CLI the pid returned here would be tsx's, and `/proc/<pid>/cmdline` would
 * name the CLI. `isRunnerAlive()` asks that file for `update-runner`, so the CLI would make every
 * live runner read as dead and every job stall in `installing`.
 *
 * The runner writes nothing itself: `job.log` is opened here for append and handed over as the
 * child's stdout AND stderr, so every framed line in it is the runner's own or one of its commands',
 * in order. The parent closes its copy as soon as the child holds it — a second writer could not be
 * ordered against the first.
 *
 * A spawn that fails asynchronously reports it as an `error` event, and an unhandled one is thrown
 * into the API. There is no caller left to hand it to, so it is said in the journal, and the pid
 * check below catches the synchronous half of the same failure.
 */
export function spawnUpdateRunner(appRoot: string, dir: string, mode: 'install' | 'rollback'): number {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TSX_TSCONFIG_PATH: path.join(appRoot, 'server', 'tsconfig.json'),
  };
  // Deleted, not merely left unset, for the reason child.mjs deletes CLOUDCLI_HANDOVER: these two
  // bits mean "a supervisor started me and will hand me over", and a command the runner spawns must
  // not inherit a claim about a supervisor that is not this process's.
  delete env.CLOUDCLI_SUPERVISED;
  delete env.CLOUDCLI_HANDOVER;

  const tsxDist = path.join(appRoot, 'node_modules', 'tsx', 'dist');
  ensureDir(dir);
  const logFd = fs.openSync(path.join(dir, LOG_FILE), 'a', 0o600);
  try {
    const child = spawn(
      process.execPath,
      [
        '--require',
        path.join(tsxDist, 'preflight.cjs'),
        '--import',
        pathToFileURL(path.join(tsxDist, 'loader.mjs')).href,
        path.join(path.dirname(fileURLToPath(import.meta.url)), 'update-runner.ts'),
        dir,
        mode,
      ],
      { cwd: appRoot, detached: true, stdio: ['ignore', logFd, logFd], env },
    );

    child.on('error', (error) => {
      console.error(`[claude-updates] the update runner did not start: ${error.message}`);
    });

    const pid = child.pid;
    if (pid === undefined) throw new Error('the update runner was spawned without a pid');
    child.unref();
    return pid;
  } finally {
    fs.closeSync(logFd);
  }
}
