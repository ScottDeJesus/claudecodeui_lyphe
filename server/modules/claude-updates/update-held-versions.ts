/**
 * The versions the automatic install leaves for a person — and the memory that keeps them left.
 *
 * `job.json` holds only the LAST job, so a hold read off it alone lasts until any other job replaces
 * the file: roll the SDK back, let the next Claude Code release install on its own, and the job that
 * said "leave SDK 0.3.285 alone" is gone — the tick after that installs it again, commit on `main` and
 * server restart included. So what a job says is written down the first time it is seen, beside the
 * switch in `app_config`, and read from there.
 *
 * WHAT A JOB SAYS. An update that ended without finishing (`failed`, `rolled-back`, `interrupted`)
 * says its target would end the same way; a rollback says the version it moved AWAY from is the one
 * the operator reversed on purpose. Either way that exact version is held. A newer release is a fresh
 * question, and a version the package has since been moved to by hand is released: whoever installed
 * it has said what they wanted.
 *
 * The memory is read from `app_config` once per process and kept: this process is its only writer, and
 * the report path asks on every poll.
 */

import type {
  ClaudeUpdateJob,
  ClaudeUpdateJobState,
  ClaudeUpdatePackage,
  ClaudeUpdatePackageKey,
} from '@/shared/claude-update-types.js';

import { stepOf } from './update-job.js';

/** The `app_config` key the memory lives under: `{"cli"?: {version, why}, "sdk"?: {version, why}}`. */
const HELD_CONFIG_KEY = 'claude_updates_held_versions';

/** The job states that mean an install ended without finishing. `done` is a success and the rest are
 *  running, so neither holds a version back. */
const UNFINISHED_STATES: readonly ClaudeUpdateJobState[] = ['failed', 'rolled-back', 'interrupted'];

const PACKAGE_KEYS: readonly ClaudeUpdatePackageKey[] = ['cli', 'sdk'];

/** Why a version is held: an install of it that did not finish, or a rollback away from it. */
type HeldWhy = 'failed' | 'rolled-back';

/** One held version per package. */
type HeldVersions = Partial<Record<ClaudeUpdatePackageKey, { version: string; why: HeldWhy }>>;

/**
 * `app_config`'s two calls — the one place the switch and this memory are kept.
 * consumer: update-auto-install.service.ts, which takes it as a dependency and hands it on here.
 */
export type ConfigStore = { get: (key: string) => string | null; set: (key: string, value: string) => void };

/** An error's own words, for the two places a failure becomes a sentence here. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The stored memory, or nothing held for a value that is absent or not what this file writes. */
function parseHeld(raw: string | null): HeldVersions {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[claude-updates] the held-versions memory is not JSON (${messageOf(error)}) — starting it empty`);
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const held: HeldVersions = {};
  for (const key of PACKAGE_KEYS) {
    const entry = (parsed as Record<string, { version?: unknown; why?: unknown } | null | undefined>)[key];
    if (entry && typeof entry.version === 'string' && (entry.why === 'failed' || entry.why === 'rolled-back')) {
      held[key] = { version: entry.version, why: entry.why };
    }
  }
  return held;
}

/** What one job says to leave alone, per package it has a step for. */
function heldByJob(job: ClaudeUpdateJob): HeldVersions {
  const held: HeldVersions = {};
  for (const key of PACKAGE_KEYS) {
    const step = stepOf(job, key);
    if (step === null) continue;
    if (job.kind === 'rollback' && step.from !== null) {
      held[key] = { version: step.from, why: 'rolled-back' };
    } else if (job.kind === 'update' && UNFINISHED_STATES.includes(job.state) && step.to !== null) {
      held[key] = { version: step.to, why: 'failed' };
    }
  }
  return held;
}

/**
 * consumer: update-auto-install.service.ts — `remember` on every look at the report, `reasonFor` when
 * the gate decides whether a package on offer may install by itself.
 */
export function createHeldVersions(config: ConfigStore): {
  remember: (readings: { job: ClaudeUpdateJob | null; packages: ClaudeUpdatePackage[] }) => void;
  reasonFor: (pkg: { key: ClaudeUpdatePackageKey; label: string; latest: string }) => string | null;
} {
  let held: HeldVersions | null = null;

  function current(): HeldVersions {
    held ??= parseHeld(config.get(HELD_CONFIG_KEY));
    return held;
  }

  return {
    /**
     * Folds what the report's job says into the memory, then releases any version its package has
     * been moved to. Called before the switch is consulted, so a rollback made while the switch was
     * off is still remembered when it is turned on. Writes only when the memory changed.
     */
    remember(readings): void {
      const before = current();
      // Released FIRST, from what was already remembered, and the job's own word laid over it after:
      // a rollback still in flight names the version it is moving away from — still installed at that
      // moment — and that is exactly the one to keep.
      const kept: HeldVersions = { ...before };
      for (const pkg of readings.packages) {
        if (kept[pkg.key]?.version === pkg.installed) delete kept[pkg.key];
      }
      const next: HeldVersions = { ...kept, ...(readings.job === null ? {} : heldByJob(readings.job)) };

      const serialized = JSON.stringify(next);
      if (serialized === JSON.stringify(before)) return;
      // The process's own copy first: a write that fails must not leave the next look to decide again.
      held = next;
      try {
        config.set(HELD_CONFIG_KEY, serialized);
      } catch (error) {
        console.warn(`[claude-updates] the held-versions memory could not be saved: ${messageOf(error)}`);
      }
    },

    /** Why this package's `latest` is left for a person, or null when nothing holds it. */
    reasonFor(pkg): string | null {
      const entry = current()[pkg.key];
      if (entry === undefined || entry.version !== pkg.latest) return null;
      const named = `${pkg.label} ${pkg.latest}`;
      return entry.why === 'rolled-back'
        ? `${named} was rolled back — use Update and restart to install it again by hand`
        : `the last install of ${named} did not finish — use Update and restart to try it by hand`;
    },
  };
}
