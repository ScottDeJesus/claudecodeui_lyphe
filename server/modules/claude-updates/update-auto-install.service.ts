/**
 * The automatic install: the app pressing "Update and restart" itself, but only when no Claude work is
 * in flight anywhere on this machine.
 *
 * It is the button's own path and nothing beside it. The targets are the ones the tab sends — the
 * report's `latest` for every package that is behind and updatable — and the install is the same
 * `applyUpdate`, refusals and all; this file only decides WHEN. The manual button stays ungated.
 *
 * THE GATE, in order: the switch is on; an update is on offer; no job is already running; no earlier job
 * has said no to these very versions; and the activity reading says idle. The reading is the
 * last await before `applyUpdate`, and the switch is read once more after it — an operator who turned
 * the switch off while the reading ran is obeyed.
 *
 * A JOB'S WORD OUTLIVES THE JOB. A job that did not finish at these versions would fail the same way on
 * the next tick and the one after, each time reinstalling and possibly restarting the server; and a
 * rollback is the operator reversing exactly this release. Either way the version is left for a human
 * to install by hand, and the reason says so. `job.json` keeps only the last job, so the word is
 * remembered on its own (`update-held-versions.ts`) and survives the next job replacing the file. A
 * newer release is a new question.
 *
 * The clock is the check service's tick (`tick()` is its `afterTick`), so there is no timer here. The
 * journal gets a line when an install starts and a line when an update begins to wait — again only when
 * what it waits for CHANGES, never once per tick.
 */

import type { ClaudeActivity } from '@/shared/claude-activity-types.js';
import type { ClaudeAutoInstall, ClaudeUpdatePackage, ClaudeUpdatePackageKey } from '@/shared/claude-update-types.js';

import { APPLY_ACTIVE_STATES } from './update-actions.service.js';
import type { UpdateActionResult } from './update-actions.service.js';
import type { ReportReadings } from './update-check.report.js';
import { createHeldVersions } from './update-held-versions.js';
import type { ConfigStore } from './update-held-versions.js';

/** The `app_config` key the switch lives under: one JSON value, `{"enabled": boolean}`. */
const AUTO_INSTALL_CONFIG_KEY = 'claude_updates_auto_install';

/** How long the report path reuses an activity reading. The tab polls once a minute per open screen and
 *  the reading walks tmux and the process list, so a few screens should cost one reading, not several.
 *  The install's own reading never uses this — it is always fresh. */
const ACTIVITY_MEMO_MS = 10_000;

/** What `waiting` says while an update is on offer, nothing blocks it, and the next tick has not come. */
const WAITING_FOR_NEXT_CHECK = 'no Claude work is running — the next 5-minute check installs it';

/** The targets, in the shape `applyUpdate` takes. */
type Targets = Partial<Record<ClaudeUpdatePackageKey, string>>;

/** A package on offer: behind, updatable, and with both versions known — true for the compiler too. */
type OfferedPackage = ClaudeUpdatePackage & { installed: string; latest: string };

/** What one evaluation of the gate concluded. */
type Decision =
  /** Nothing to do and nothing waiting: no update on offer, or an install already running. */
  | { kind: 'none' }
  /** An update is on offer and something holds it. `key` is what the journal compares to say a line
   *  only when the REASON moved — the reason itself, with counts that change every tick blanked. */
  | { kind: 'wait'; reason: string; key: string }
  /** Nothing holds it: these packages install now. */
  | { kind: 'install'; packages: OfferedPackage[] };

type AutoInstallDependencies = {
  /** `app_config`'s two calls — where the switch and the held versions are kept. */
  config: ConfigStore;
  /** Is any Claude work in flight? Must fail closed; the service still treats a rejection as busy. */
  readActivity: () => Promise<ClaudeActivity>;
  /** The report as the routes build it — the job and its log read in — without its `autoInstall`. */
  readReadings: () => Promise<ReportReadings>;
  /** The install itself: the same call the button's route makes. */
  applyUpdate: (targets: Targets) => Promise<UpdateActionResult>;
};

/** An error's own words, for the places a failure becomes a sentence here. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The packages the pipeline can move from here, each with the version it would move them to — the
 *  client's `offeredPackages`, which is what the button sends, so the two can never offer different sets. */
function offeredPackages(readings: ReportReadings): OfferedPackage[] {
  return readings.packages.filter(
    (pkg): pkg is OfferedPackage =>
      pkg.updateAvailable && pkg.updatable && pkg.installed !== null && pkg.latest !== null,
  );
}

/** The reason as the journal compares it: counts blanked, so "2 Claude conversations are working"
 *  becoming "3" is the same wait and not a new line. */
function journalKey(reason: string): string {
  return reason.replace(/\d+/g, 'N');
}

/** What `waiting` says for a decision, or null when nothing waits. */
function waitingFor(decision: Decision): string | null {
  if (decision.kind === 'wait') return decision.reason;
  if (decision.kind === 'install') return WAITING_FOR_NEXT_CHECK;
  return null;
}

export function createAutoInstall(dependencies: AutoInstallDependencies): {
  describe: (readings: ReportReadings) => Promise<ClaudeAutoInstall>;
  setEnabled: (enabled: boolean) => void;
  tick: () => Promise<void>;
} {
  const { config, readActivity, readReadings, applyUpdate } = dependencies;

  /** The versions earlier jobs said to leave alone, remembered past the job file. */
  const heldVersions = createHeldVersions(config);

  /** The reason last written to the journal, by its `key`; null when nothing was waiting at the last
   *  tick. A tick that finds the same key stays silent. */
  let lastWaitingKey: string | null = null;
  /** True while a tick is deciding or starting an install, so a slow reading can never overlap the next. */
  let ticking = false;
  /** A malformed stored switch is said once, not on every report that reads it. */
  let saidMalformed = false;
  /** The activity reading the report path reuses, with the moment it was asked. */
  let recent: { at: number; answer: Promise<ClaudeActivity> } | null = null;

  /**
   * The switch. Absent means ON — the operator's ruling. A value that is there but is not
   * `{"enabled": boolean}` reads as OFF and says so once: installing software on the strength of a
   * row nobody can read is the wrong way to fail, and flipping the switch rewrites it well-formed.
   */
  function readEnabled(): boolean {
    const raw = config.get(AUTO_INSTALL_CONFIG_KEY);
    if (raw === null) return true;

    let enabled: unknown;
    let problem = 'has no boolean `enabled`';
    try {
      enabled = (JSON.parse(raw) as { enabled?: unknown } | null)?.enabled;
    } catch (error) {
      problem = `is not JSON (${messageOf(error)})`;
    }
    if (typeof enabled === 'boolean') return enabled;

    if (!saidMalformed) {
      saidMalformed = true;
      console.warn(`[claude-updates] the auto-install switch ${problem} — treating it as off`);
    }
    return false;
  }

  /** One activity reading, fresh. A reading that throws is busy, in words — the gate fails closed. */
  async function readActivityNow(): Promise<ClaudeActivity> {
    try {
      return await readActivity();
    } catch (error) {
      return { busy: true, reasons: [`the Claude activity could not be read: ${messageOf(error)}`] };
    }
  }

  /** The reading the report path uses: one per `ACTIVITY_MEMO_MS`, shared by whoever asks meanwhile. */
  function readActivityRecent(): Promise<ClaudeActivity> {
    const now = Date.now();
    if (recent !== null && now - recent.at < ACTIVITY_MEMO_MS) return recent.answer;
    const answer = readActivityNow();
    recent = { at: now, answer };
    return answer;
  }

  /**
   * The gate, evaluated against a report. Cheap checks first, so the activity reading — which walks
   * tmux and the process list — is asked only when an install would otherwise go ahead; a box with
   * nothing on offer, which is almost every box, never pays for it.
   */
  async function decide(readings: ReportReadings, readActivityFor: () => Promise<ClaudeActivity>): Promise<Decision> {
    if (readings.job !== null && APPLY_ACTIVE_STATES.includes(readings.job.state)) return { kind: 'none' };

    const held: string[] = [];
    const packages: OfferedPackage[] = [];
    for (const pkg of offeredPackages(readings)) {
      const reason = heldVersions.reasonFor(pkg);
      if (reason === null) packages.push(pkg);
      else held.push(reason);
    }
    if (packages.length === 0) {
      if (held.length === 0) return { kind: 'none' };
      const reason = held.join('; ');
      return { kind: 'wait', reason, key: reason };
    }

    const activity = await readActivityFor();
    if (activity.busy) {
      const reason = activity.reasons.join('; ');
      return { kind: 'wait', reason, key: journalKey(reason) };
    }
    return { kind: 'install', packages };
  }

  /** Writes the waiting line when the reason moved, and forgets it when nothing waits any more. */
  function journalWaiting(decision: Decision): void {
    if (decision.kind !== 'wait') {
      lastWaitingKey = null;
      return;
    }
    if (decision.key === lastWaitingKey) return;
    lastWaitingKey = decision.key;
    console.log(`[claude-updates] auto-install waiting: ${decision.reason}`);
  }

  /**
   * One turn of the automatic install: decide, and start the install when the gate is open.
   * Never rejects — it runs from a timer, and what goes wrong is one journal line.
   */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      // Read and remembered before the switch is asked: what a job said while the switch was off still
      // holds when it is turned on.
      const readings = await readReadings();
      heldVersions.remember(readings);
      if (!readEnabled()) {
        lastWaitingKey = null;
        return;
      }
      const decision = await decide(readings, readActivityNow);
      journalWaiting(decision);
      if (decision.kind !== 'install') return;

      // The reading above was the last await; this is the switch's last word before the install.
      if (!readEnabled()) return;

      const targets: Targets = {};
      for (const pkg of decision.packages) targets[pkg.key] = pkg.latest;
      const moves = decision.packages.map((pkg) => `${pkg.label} ${pkg.installed} → ${pkg.latest}`).join(' and ');

      const result = await applyUpdate(targets);
      if (result.ok) console.log(`[claude-updates] auto-install: installing ${moves} — no Claude work is running`);
      else console.warn(`[claude-updates] auto-install: ${moves} was not started — ${result.refusal.message}`);
    } catch (error) {
      console.error(`[claude-updates] auto-install failed: ${messageOf(error)}`);
    } finally {
      ticking = false;
    }
  }

  return {
    /**
     * The report's `autoInstall` block. `waiting` is null with the switch off: an operator who chose to
     * install by hand is not waiting for anything, and is not shown an install that will not happen.
     */
    async describe(readings): Promise<ClaudeAutoInstall> {
      heldVersions.remember(readings);
      const enabled = readEnabled();
      if (!enabled) return { enabled, waiting: null };
      return { enabled, waiting: waitingFor(await decide(readings, readActivityRecent)) };
    },

    /** Writes the switch. Takes effect at the next tick, which re-reads it. */
    setEnabled(enabled: boolean): void {
      config.set(AUTO_INSTALL_CONFIG_KEY, JSON.stringify({ enabled }));
    },

    tick,
  };
}
