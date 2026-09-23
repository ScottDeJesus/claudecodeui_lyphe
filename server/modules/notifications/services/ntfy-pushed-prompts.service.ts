/**
 * Which permission prompts have already had their one push to the phone, remembered on disk.
 *
 * A question that parks the CLI is asked again by every successor process — the dev server boots
 * a fresh one behind the running one on each save, and the re-adopted host replays the CLI's
 * pending tool request, so `promptForToolDecision` runs again with a new request id and an empty
 * in-process dedupe map. Measured 2026-09-22: one AskUserQuestion at 17:51:32, 23 handovers in
 * seven minutes while builders saved server files, and 12 identical pushes on the phone, one per
 * handover. The prompt key is what stays put across that relay; this file is what remembers it.
 *
 * A record is written only once a push has actually LEFT (`publishNtfy` answered ok). The order
 * matters: a predecessor killed between its question and its push leaves no record, so the
 * successor pushes and the question is never lost. One window is left open by that choice, and
 * deliberately: a predecessor killed between ntfy ACCEPTING the push and this write leaves no
 * record either, so the successor pushes the same question twice. A rare second buzz on a save
 * storm is the price of never losing a question, and it is the only price this file trades at. The window is the question's own, so a
 * question still parked when its window closes is pushed again rather than going unanswered —
 * by then the earlier push has scrolled off the phone and its buttons have expired.
 *
 * Read fresh on every check and re-read before every write, never cached in the process: the
 * whole point is to know what a process that is now gone saw, and two servers sharing this file
 * (the dev one and a probe's) must not overwrite each other's records. That second requirement is
 * what the write lock below is for — on one box two servers really do share this file.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * How long a question may stay parked — the memory of its push, and the life of its answer
 * buttons, are the same window, and `ntfy-action-decisions.service.ts` sizes those from here.
 */
export const QUESTION_WINDOW_MS = 4 * 60 * 60_000;

/** `CLOUDCLI_NTFY_PUSHED_PATH` is read on every call, so a probe that redirects it gets its own file. */
function storePath(): string {
  return process.env.CLOUDCLI_NTFY_PUSHED_PATH
    || path.join(os.homedir(), '.cloudcli', 'ntfy-pushed-prompts.json');
}

type PushedPrompts = Record<string, number>;

/** The live records: an unreadable or hand-broken file is an empty memory, and costs one push too many. */
function read(now: number): PushedPrompts {
  let stored: unknown;
  try {
    stored = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return {};
  }
  if (!stored || typeof stored !== 'object') return {};

  const live: PushedPrompts = {};
  for (const [promptKey, pushedAt] of Object.entries(stored as PushedPrompts)) {
    if (typeof pushedAt === 'number' && now - pushedAt < QUESTION_WINDOW_MS) live[promptKey] = pushedAt;
  }
  return live;
}

/** How long a writer waits for another process's lock before going on without the record. */
const LOCK_WAIT_MS = 1_000;
/** How long a lock file may sit before the process holding it is taken to be gone. */
const LOCK_STALE_MS = 5_000;
const LOCK_RETRY_MS = 20;

/** One synchronous sleep, so the read-modify-write below is one step per process, not two. */
function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `run` holding this store's lock, or `fallback` when the lock cannot be had in time.
 *
 * Staging and renaming stops a torn file, not a lost update: two processes that both read, then
 * both write, leave one of the two records gone — measured on this store, four processes writing
 * 200 records each kept 297 of 800. What that costs is a later push for a prompt already pushed,
 * never a lost question, so this gives up rather than blocks: a caller that cannot take the lock
 * in LOCK_WAIT_MS writes nothing, and the prompt it could not record is simply pushed again by
 * whoever asks next. A lock older than LOCK_STALE_MS is taken from whatever process died holding
 * it, because a write is a few milliseconds of work.
 */
function withStoreLock<T>(run: () => T, fallback: T): T {
  const lock = `${storePath()}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      fs.closeSync(fs.openSync(lock, 'wx', 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') return fallback;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
      } catch {
        // The holder released it between the open and the stat: the next turn takes it.
      }
      if (Date.now() >= deadline) return fallback;
      pauseSync(LOCK_RETRY_MS);
    }
  }
  try {
    return run();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      // Gone already: a stale lock taken by another writer is not this writer's to remove.
    }
  }
}

/** Staged and renamed, so a process handed over mid-write never reads half a file. */
function write(prompts: PushedPrompts): void {
  const target = storePath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(prompts), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    // A memory that cannot be kept is one push too many, never a lost one: the successor that
    // cannot read this record pushes the question again.
  }
}

/** Has this prompt's push already gone out, from this process or any process before it? */
export function wasPromptPushed(promptKey: string): boolean {
  if (!promptKey) return false;
  // Own keys only: a bare lookup would answer true for a key this record never held, because
  // `toString` and `__proto__` are inherited from Object.prototype.
  return Object.hasOwn(read(Date.now()), promptKey);
}

/**
 * Records that this prompt's push went out. Written after the publish, never before it: see the
 * header — the lost-push window is exactly the window this ordering closes.
 */
export function rememberPromptPushed(promptKey: string): void {
  if (!promptKey) return;
  withStoreLock(() => {
    const now = Date.now();
    write({ ...read(now), [promptKey]: now });
  }, undefined);
}
