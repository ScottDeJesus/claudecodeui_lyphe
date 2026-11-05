import type { CerberusDiagnosisRow } from '@/modules/database/index.js';
import type { CerberusCheckView, CerberusOverview } from '@/shared/cerberus-types.js';

import { endedByRestart } from './diagnosis/diagnosis-endings.js';
import { PAGING_STATUSES } from './red-watch-plan.js';

/**
 * The auto-diagnosis's judgment, pure: given the fleet as the overview reads it, which switched-on reds
 * are diagnosed NOW, and the next moment the clock alone changes that answer. It reads nothing and writes
 * nothing, so the trigger (`auto-diagnosis.service.ts`) is this plan applied, and a plan can be checked by
 * handing it a fleet. The one thing it asks the store, a trouble's diagnoses, comes in as a function so a
 * check that is switched off costs no read.
 *
 * A CANDIDATE is a red check: one of the overview's `needsYou` whose status is in `PAGING_STATUSES`, or
 * one of its `muted` whose STORED status is. Candidates are taken oldest red first, then by
 * `<node>/<key>`. The set is the red watch's own, so the diagnosis is there for the page it rides:
 * `failing` and `denied` page and `warn` never does, so `warn` starts nothing, and `denied` is in because
 * a refusal is exactly what a read explains.
 *
 * A CANDIDATE IS DROPPED — nothing for it in the plan and no deadline — when, tested in this order (a check
 * that is switched off costs no read of the store):
 *   - it is not in `enabled`, the checks the operator switched on;
 *   - its node's link is not `reporting`;
 *   - its `since` is null (nothing says how long it has been red);
 *   - its trouble holds a diagnosis that is running or done;
 *   - its trouble holds `AUTO_DIAGNOSIS_FAILURES_PER_TROUBLE` counted failures. Those candidates are
 *     returned as `exhausted`, so the trigger can say "failed 3 times" once per trouble with no read of
 *     its own.
 *
 * A TROUBLE IS READ ONCE, WHOEVER ASKED. It is everything since the red began, the first row after the
 * check's last ok (`check-trouble.ts`): a diagnosis the trouble already holds, from the operator or from this trigger,
 * spares the trigger. The operator, 2026-11-04: "once it goes red, check the reason why, and there's no
 * reason to check unless it's been fixed and cleared". A press of Diagnose at minute 5 therefore spares
 * the trigger its read at minute 10, and a check that was ok and went red again is a new trouble.
 *
 * THERE IS NO CAP: no age limit, no per-check bound, no daily cap (the operator, 2026-11-04: "There
 * shouldn't be a cap"). A switched-on check already red when this landed is read on the first settled plan.
 *
 * A CANDIDATE WAITS for the latest of its clock tests, `readyAt`:
 *   - the hold, 10 minutes counted from `since` as the page's own "red for" is, so a red that clears itself
 *     starts nothing. `since` is on the warden's clock, so the node's offset brings it onto center's;
 *   - the mute, `mute.until`: a muted check waits for its mute to end, because the page it rides is
 *     silenced with it;
 *   - the retry, 15 minutes after the newest counted failure ended.
 * A `readyAt` after `now` is a deadline, and `nextAt` is the earliest of them: the one moment the clock
 * alone changes a verdict, so the trigger needs a timer for that and nothing else.
 *
 * WHAT A FAILED DIAGNOSIS COSTS. A counted failure is one the trigger's own start suffered: by `auto`,
 * status `failed`, and not `endedByRestart`. A diagnosis a handover cut short counts for nothing: the dev
 * server restarts on every save, and with no cap a restart must never cost a red its reading. One that
 * failed on its own (the model erring, the 3-minute ceiling, a lost link) is tried again 15 minutes after it
 * ended, so a passing outage of the model passes. After three such failures in one trouble the check waits
 * for a press of Diagnose or for the trouble to clear: a guard against a loop, not a cap on reading a red.
 *
 * ONE START PER NODE, oldest red first, because a warden holds one diagnosis session. A ready check STARTS
 * when its node is linked, is not the node an update is taking, runs no diagnosis and has no start in this
 * plan yet. Otherwise it is neither started nor given a deadline: the event that frees the node (the end of
 * that diagnosis hints, a link comes back, an update ends) plans again, and the next one starts then.
 *
 * Consumed by `auto-diagnosis.service.ts`.
 */

/** How long a check must have been red before it is diagnosed, counted from its `since`: a red that clears itself starts nothing. */
export const AUTO_DIAGNOSIS_HOLD_MS = 10 * 60_000;

/** How long after a failed diagnosis ended the same trouble is tried again, so a passing outage of the model passes. */
export const AUTO_DIAGNOSIS_RETRY_MS = 15 * 60_000;

/** How many failed tries a trouble is given before it waits for a press of Diagnose or for the check to clear. A guard against a loop, not a cap. */
export const AUTO_DIAGNOSIS_FAILURES_PER_TROUBLE = 3;

export type AutoDiagnosisInputs = {
  overview: CerberusOverview;
  /** The `<node>/<check_key>` of every check switched on: `cerberusAutoDiagnosisDb.enabledSlots()`. */
  enabled: ReadonlySet<string>;
  /** `check-trouble.ts`: the diagnoses since the red began, newest first, whoever asked. */
  troubleDiagnoses: (node: string, key: string) => CerberusDiagnosisRow[];
  /** The nodes of `cerberusDiagnosesDb.running()`. */
  busyNodes: ReadonlySet<string>;
  /** `wardenLinks.isLinked(node)`; true for the hub. */
  linked: (node: string) => boolean;
  /** `cerberusUpdatesDb.activeNode()`: the node whose warden is being updated, or null. */
  updatingNode: string | null;
  /** Center's clock minus the node's, in ms: what brings a node's `since` onto center's clock. */
  clockOffsetMs: (node: string) => number;
};

/** A check to diagnose; `redSince` is when its red began, on center's clock. */
export type AutoDiagnosisStart = { node: string; key: string; label: string; redSince: number };

export type AutoDiagnosisPlan = {
  /** The checks to diagnose now, at most one per node, oldest red first. */
  starts: AutoDiagnosisStart[];
  /** The checks dropped at the last test: their trouble holds three counted failures, so each waits for a press or for the trouble to clear. */
  exhausted: AutoDiagnosisStart[];
  /** The earliest moment the clock alone changes the plan (a hold, a mute or a retry running out), or null when none will. Center's clock. */
  nextAt: number | null;
};

/** A diagnosis the trigger started, that failed, and that a restart did not end. */
function isCountedFailure(row: CerberusDiagnosisRow): boolean {
  return row.by === 'auto' && row.status === 'failed' && !endedByRestart(row);
}

const slotOf = (check: CerberusCheckView): string => `${check.node}/${check.key}`;

export function planAutoDiagnosis(inputs: AutoDiagnosisInputs): AutoDiagnosisPlan {
  const { overview, enabled, troubleDiagnoses, busyNodes, linked, updatingNode, clockOffsetMs } = inputs;
  const { now } = overview;
  const links = new Map(overview.nodes.map((node) => [node.id, node.link]));

  const reds: CerberusCheckView[] = [
    ...overview.needsYou.map((need) => need.check).filter((check) => PAGING_STATUSES.has(check.status)),
    // A muted check shows `muted`; its stored status says what it is under the mute.
    ...overview.muted.filter((check) => check.stored !== null && PAGING_STATUSES.has(check.stored)),
  ];
  // `since` is the warden's clock; the order and the hold are center's.
  const candidates = reds
    .map((check) => ({ check, redSince: check.since === null ? null : check.since + clockOffsetMs(check.node) }))
    .sort((a, b) => {
      // A null `since` is dropped below; sorting it last keeps the order total.
      const byRed = (a.redSince ?? Number.MAX_SAFE_INTEGER) - (b.redSince ?? Number.MAX_SAFE_INTEGER);
      if (byRed !== 0) return byRed;
      const [slotA, slotB] = [slotOf(a.check), slotOf(b.check)];
      return slotA < slotB ? -1 : slotA > slotB ? 1 : 0;
    });

  const plan: AutoDiagnosisPlan = { starts: [], exhausted: [], nextAt: null };
  const nodesStarted = new Set<string>();

  for (const { check, redSince } of candidates) {
    if (!enabled.has(slotOf(check))) continue;
    if (links.get(check.node) !== 'reporting') continue;
    if (redSince === null) continue;

    const trouble = troubleDiagnoses(check.node, check.key);
    if (trouble.some((row) => row.status === 'running' || row.status === 'done')) continue;
    const failures = trouble.filter(isCountedFailure);
    const start: AutoDiagnosisStart = { node: check.node, key: check.key, label: check.label ?? check.key, redSince };
    if (failures.length >= AUTO_DIAGNOSIS_FAILURES_PER_TROUBLE) {
      plan.exhausted.push(start);
      continue;
    }

    let readyAt = redSince + AUTO_DIAGNOSIS_HOLD_MS;
    if (check.mute !== null) readyAt = Math.max(readyAt, check.mute.until);
    for (const failure of failures) {
      readyAt = Math.max(readyAt, (failure.ended_at ?? failure.started_at) + AUTO_DIAGNOSIS_RETRY_MS);
    }

    if (readyAt > now) {
      plan.nextAt = plan.nextAt === null ? readyAt : Math.min(plan.nextAt, readyAt);
    } else if (linked(check.node) && check.node !== updatingNode && !busyNodes.has(check.node) && !nodesStarted.has(check.node)) {
      nodesStarted.add(check.node);
      plan.starts.push(start);
    }
  }

  return plan;
}
