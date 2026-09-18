/**
 * What has already been said about each usage window, kept per Claude account and kept on disk.
 *
 * A limit belongs to the ACCOUNT: every session on it reads the same windows, so one warning per
 * window step is the whole of what the phone should get. That memory used to live in the server's
 * heap, and the dev server hands over to a fresh process on every save under `server/` — measured
 * 2026-09-17, about thirty handovers between 20:47 and 20:52 — so each new process had forgotten
 * the warning and re-sent it on the next session's reading ("Weekly limit at 76%" at 20:36, 20:48
 * and 20:53). On disk, the memory outlives the process that wrote it.
 *
 * Keyed by the live login's email, because the switcher can move the whole CLI to another account:
 * that account's windows are its own, and a warning already sent for one must not silence the other.
 * Timers are not kept — `claude-runtime-signals` re-arms a pending reset from the stored window.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { liveAccountEmail } from '@/modules/accounts/index.js';

/** One rate-limit window's memory: everything already said about it. */
export type LimitMemory = {
  /** The `resetsAt` of the rejection already announced (0 when none was sent); null while open. */
  announcedResetsAt: number | null;
  resetTimer: ReturnType<typeof setTimeout> | null;
  /** Warning thresholds already announced in the window `warnedWindowResetsAt` names. */
  warnedBuckets: Set<number>;
  /** The window those warnings belong to. A new `resetsAt` is a new window, and only that clears them. */
  warnedWindowResetsAt: number | null;
  /** When the last warning was announced, for a stream that names no window at all. */
  warnedAt: number;
  overageAnnounced: boolean;
};

type AccountMemory = {
  windows: Map<string, LimitMemory>;
  /**
   * Running out of credits is a fact about the ACCOUNT, not about one window, and it arrives by two
   * roads: a `rate_limit_event` naming `overageDisabledReason`, and an assistant `billing_error`. One
   * flag for both, or the same emptied wallet is announced once per road and once per window type.
   */
  creditsExhaustedAnnounced: boolean;
};

type StoredWindow = Omit<LimitMemory, 'resetTimer' | 'warnedBuckets'> & { warnedBuckets: number[] };
type StoredAccount = { windows: Record<string, StoredWindow>; creditsExhaustedAnnounced: boolean };

const accounts = new Map<string, AccountMemory>();
let loaded = false;

/** `CLOUDCLI_LIMIT_MEMORY_PATH` is read on every call, so a probe that redirects it gets its own file. */
function storePath(): string {
  return process.env.CLOUDCLI_LIMIT_MEMORY_PATH || path.join(os.homedir(), '.cloudcli', 'limit-memory.json');
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An unreadable or hand-broken file is an empty memory: the worst it costs is one warning too many. */
function load(): void {
  if (loaded) return;
  loaded = true;
  let stored: Record<string, StoredAccount>;
  try {
    stored = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return;
  }
  if (!stored || typeof stored !== 'object') return;
  for (const [account, entry] of Object.entries(stored)) {
    const windows = new Map<string, LimitMemory>();
    for (const [type, window] of Object.entries(entry?.windows ?? {})) {
      windows.set(type, {
        announcedResetsAt: readNumberOrNull(window?.announcedResetsAt),
        resetTimer: null,
        warnedBuckets: new Set(Array.isArray(window?.warnedBuckets) ? window.warnedBuckets.filter((b) => typeof b === 'number') : []),
        warnedWindowResetsAt: readNumberOrNull(window?.warnedWindowResetsAt),
        warnedAt: readNumberOrNull(window?.warnedAt) ?? 0,
        overageAnnounced: window?.overageAnnounced === true,
      });
    }
    accounts.set(account, { windows, creditsExhaustedAnnounced: entry?.creditsExhaustedAnnounced === true });
  }
}

/** Staged and renamed, so a process handed over mid-write never reads half a file. */
export function saveLimitMemory(): void {
  const out: Record<string, StoredAccount> = {};
  for (const [account, memory] of accounts) {
    const windows: Record<string, StoredWindow> = {};
    for (const [type, window] of memory.windows) {
      const { resetTimer: _timer, warnedBuckets, ...rest } = window;
      windows[type] = { ...rest, warnedBuckets: [...warnedBuckets] };
    }
    out[account] = { windows, creditsExhaustedAnnounced: memory.creditsExhaustedAnnounced };
  }
  const target = storePath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    // A memory that cannot be kept is a memory for this process only — never a reason to drop the push.
  }
}

/** The account's memory. An unknown login is still one account, named as such. */
export function accountLimitMemory(): AccountMemory {
  load();
  const account = liveAccountEmail() ?? 'unknown';
  let memory = accounts.get(account);
  if (!memory) {
    memory = { windows: new Map(), creditsExhaustedAnnounced: false };
    accounts.set(account, memory);
  }
  return memory;
}

export function windowMemory(rateLimitType: string): LimitMemory {
  const { windows } = accountLimitMemory();
  let memory = windows.get(rateLimitType);
  if (!memory) {
    memory = { announcedResetsAt: null, resetTimer: null, warnedBuckets: new Set<number>(), warnedWindowResetsAt: null, warnedAt: 0, overageAnnounced: false };
    windows.set(rateLimitType, memory);
  }
  return memory;
}
