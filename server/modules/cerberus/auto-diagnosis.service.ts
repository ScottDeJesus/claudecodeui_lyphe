import {
  cerberusAutoDiagnosisDb,
  cerberusDiagnosesDb,
  cerberusResultsDb,
  cerberusUpdatesDb,
} from '@/modules/database/index.js';
import type { CerberusOverview, CerberusReadInputs } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import {
  AUTO_DIAGNOSIS_FAILURES_PER_TROUBLE,
  planAutoDiagnosis,
  type AutoDiagnosisStart,
} from './auto-diagnosis-plan.js';
import { hintChanged, onHintSent } from './cerberus-broadcast.js';
import { troubleDiagnoses } from './check-trouble.js';
import { HUB_NODE_ID } from './definition-document.js';
import { startDiagnosis } from './diagnosis/diagnosis.service.js';
import { findActiveCheck } from './read-model/check-views.js';
import { wardenLinks } from './warden-links.js';

/**
 * "Diagnose on its own": the operator's per-check switch for letting Cerberus read a check by itself
 * once it has stayed red, and the trigger that does the reading.
 *
 * THE SWITCH is the operator's own choice about a check, like a mute, so it lives in its own table
 * (`auto_diagnosis`, `cerberusAutoDiagnosisDb`) and never as a column of `checks`, whose rows the
 * definitions write. Step 7 of the store seeds it ON for shadow-connector's eleven poller checks; a
 * check with no row is off. `setAutoDiagnosis` is the one write: the check first (a switch for something
 * that is not an active check is a 404 `CERBERUS_UNKNOWN_CHECK`), then the row, then `hintChanged` AFTER the
 * write, so the sheet's switch reads differently the moment it lands and the trigger plans again: a check
 * switched on while it is already red is considered at once, one switched off is dropped from the plan.
 *
 * THE TRIGGER, `startAutoDiagnosis`, is `planAutoDiagnosis` (`auto-diagnosis-plan.ts`: which switched-on reds
 * are diagnosed now, and the next moment the clock alone changes that) applied to the store as it stands. It
 * gathers the plan's inputs when the plan runs, starts each check the plan names through `startDiagnosis`
 * (`askedBy: 'cerberus'`, `by: 'auto'`, no model, so `resolveDiagnosisModel` picks it) and logs four lines:
 * `armed`, `diagnosing … on its own`, `… was not diagnosed on its own` (a start `startDiagnosis` refused: the
 * 409 of a press that won the race, the 404 of a check retired since the overview was read; the plan goes on
 * to its next start) and `… its diagnosis failed 3 times this trouble` (once per trouble: remembered here by
 * slot and by the trouble's last ok, so a check that flips failing → warn → failing, or a node whose link
 * flaps, never says it twice, and a trouble that began after the check was ok says it afresh. The memory is
 * this process's: a boot says it once more for a check that is still exhausted).
 *
 * EVENTS, NEVER A TICK. Every Cerberus writer already hints after its write commits: a stored status move, a
 * link up or down, a mute, a diagnosis starting or ending, an update moving, the switch. `onHintSent` hears
 * every one of them, so one subscription covers every writer there is and every one added later. The
 * operator's standing rule is "Always event driven, no lazy watchdog checks ever"; riding the red watch's
 * 60-second tick would be a watchdog. Each hint schedules ONE plan on the next turn of the event loop
 * (`setImmediate`, at most one pending however many hints arrive), so a plan never runs inside a writer's
 * call, and the plan's own start, which hints, finds the node busy and starts nothing.
 *
 * THE ONE DEADLINE. The clock's moments — a hold ending, a mute lapsing, a retry's pause ending — are the one
 * thing no event announces, so each plan arms one unref'd timer at its `nextAt`, replacing the last. That is a
 * deadline on a moment the plan computed, never a poll: nothing is asked when it fires but the plan.
 *
 * A PLAN THAT THROWS is logged in one line and retried once `PLAN_RETRY_MS` later, at most `PLAN_RETRIES` times in
 * a row (a plan that runs resets the count). The throw is the event: the deadline that fired is spent, and a red
 * that is ready has no deadline of its own and a failed start hints nothing, so without the retry a transient
 * failure of the overview or the store would leave a ready red unread until some unrelated hint arrived. The
 * retry never replaces a nearer deadline, and after the last one the next hint plans again.
 *
 * THE SETTLE MINUTE. The dev API hands over on every save (135 boots in a day, some seconds apart), so a
 * process that lives under a minute starts nothing: the first plan runs `SETTLE_MS` after arming and a hint
 * before then plans nothing. The next process plans from the store, and by then the warden's link is back.
 * This is the red watch's first-tick rule.
 *
 * A SOLE DUTY. The page is one process's, and a second process would start the same diagnoses from its own
 * memory (INV-10187), so `cerberus.module.ts` arms the trigger only in `armSoleDuties`, and stops it BEFORE
 * `stopDiagnoses`, so the ends a shutdown stores and hints start nothing.
 *
 * IT STARTS DIAGNOSES AND ENDS NONE. `startDiagnosis` stays the one door, and the lifecycle, its session
 * rules and its one-off are untouched (INV-7177). A proposal still becomes a run only by the operator's own
 * press or by an auto-run he switched on himself.
 *
 * Consumers: `cerberus.module.ts` (`startAutoDiagnosis` and `stopAutoDiagnosis`, from `armSoleDuties` and
 * `stop`) and `diagnosis/diagnosis.routes.ts` (`PUT /checks/:node/:service/:check/auto-diagnosis`, with `by`
 * the signed-in user's name).
 */

/** The first plan runs this long after arming; a hint before then plans nothing. See the header. */
const SETTLE_MS = 60_000;

/** The longest delay `setTimeout` takes (a signed 32-bit count of ms); a nearer deadline is re-armed by the plan it fires. */
const LONGEST_TIMER_MS = 2_147_483_647;

/** How long after a plan threw the same plan is tried again. */
const PLAN_RETRY_MS = 30_000;

/** How many plans in a row may be retried this way; a plan that runs resets the count. */
const PLAN_RETRIES = 3;

let unsubscribe: (() => void) | null = null;
let settleTimer: NodeJS.Timeout | null = null;
/** The one plan scheduled for the next turn of the event loop, if any. */
let pendingPlan: NodeJS.Immediate | null = null;
let deadlineTimer: NodeJS.Timeout | null = null;
/** When the live deadline fires (center's clock); null once it has fired, and when none is armed. */
let deadlineAt: number | null = null;
/** Plans that threw one after another. */
let throwsInARow = 0;
let settled = false;
/**
 * The slots whose "failed 3 times" line this process has said, each with the warden-clock moment its trouble
 * began from: the check's last ok (null: never ok). A new trouble has another last ok, so it says the line again.
 */
const saidExhausted = new Map<string, number | null>();

const slotOf = (node: string, key: string): string => `${node}/${key}`;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** "00:50" on the box's own clock. */
function localClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** How long a red has lasted in the push's units: whole minutes under an hour, whole hours under a day, whole days past that. */
function redSpan(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes >= 24 * 60) return `${Math.floor(minutes / (24 * 60))} d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h`;
  return `${minutes} m`;
}

/**
 * The "failed 3 times" line, once per trouble. A trouble is everything since the check was last ok
 * (`check-trouble.ts`), so the memory is that moment, read on the warden's clock: `lastOkAt` of the trouble
 * module adds the node's clock offset, which drifts with each heartbeat and would read as a new trouble.
 */
function sayExhausted(exhausted: AutoDiagnosisStart[]): void {
  for (const { node, key } of exhausted) {
    const slot = slotOf(node, key);
    const lastOk = cerberusResultsDb.lastOkAt(node, key);
    if (saidExhausted.has(slot) && saidExhausted.get(slot) === lastOk) continue;
    saidExhausted.set(slot, lastOk);
    console.log(
      `[auto-diagnosis] ${slot}: its diagnosis failed ${AUTO_DIAGNOSIS_FAILURES_PER_TROUBLE} times this trouble · it waits for Diagnose or for the check to clear`
    );
  }
}

/** Replaces the deadline: one unref'd timer at `at` (center's clock), or none when the clock alone will change nothing. */
function armDeadline(at: number | null, requestPlan: () => void): void {
  if (deadlineTimer) clearTimeout(deadlineTimer);
  deadlineTimer = null;
  deadlineAt = null;
  if (at === null) return;
  deadlineAt = at;
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null;
    deadlineAt = null;
    requestPlan();
  }, Math.min(LONGEST_TIMER_MS, Math.max(0, at - Date.now())));
  // A deadline on work the plan computed, never a reason for a process to stay up.
  deadlineTimer.unref();
}

/** After a plan threw: try it again `PLAN_RETRY_MS` on, unless a nearer deadline is already armed or the retries in a row are spent. */
function retryAfterThrow(requestPlan: () => void): void {
  throwsInARow += 1;
  if (throwsInARow > PLAN_RETRIES) return;
  const retryAt = Date.now() + PLAN_RETRY_MS;
  if (deadlineAt === null || retryAt < deadlineAt) armDeadline(retryAt, requestPlan);
}

/** One plan over the store as it stands now, applied: arm the deadline, say what is exhausted, start what is ready. */
function runPlan(deps: { overview: () => CerberusOverview; readInputs: () => CerberusReadInputs }, requestPlan: () => void): void {
  pendingPlan = null;
  try {
    const overview = deps.overview();
    const plan = planAutoDiagnosis({
      overview,
      enabled: cerberusAutoDiagnosisDb.enabledSlots(),
      troubleDiagnoses,
      busyNodes: new Set(cerberusDiagnosesDb.running().map((row) => row.node)),
      linked: (node) => node === HUB_NODE_ID || wardenLinks.isLinked(node),
      updatingNode: cerberusUpdatesDb.activeNode(),
      clockOffsetMs: (node) => wardenLinks.clockOffsetMs(node),
    });

    // Before the starts: the deadline belongs to the plan, so a start that throws costs it nothing.
    armDeadline(plan.nextAt, requestPlan);
    sayExhausted(plan.exhausted);

    for (const start of plan.starts) {
      const slot = slotOf(start.node, start.key);
      try {
        startDiagnosis({ node: start.node, check: start.key, askedBy: 'cerberus', by: 'auto' }, deps.readInputs());
      } catch (error) {
        // A refusal (the 409 of a press that won the race, the 404 of a check retired since the overview was read)
        // is that start's alone; anything else is not ours to swallow and ends the plan in the catch below.
        if (!(error instanceof AppError)) throw error;
        console.log(`[auto-diagnosis] ${slot} was not diagnosed on its own: ${error.message}`);
        continue;
      }
      console.log(
        `[auto-diagnosis] diagnosing ${slot} on its own · red since ${localClock(start.redSince)} (${redSpan(overview.now - start.redSince)})`
      );
    }
    throwsInARow = 0;
  } catch (error) {
    console.error(`[auto-diagnosis] a plan did nothing: ${describe(error)}`);
    retryAfterThrow(requestPlan);
  }
}

/**
 * Arms the trigger: it hears every hint Cerberus sends and plans on each, and its first plan runs one settle
 * minute from now. `overview` and `readInputs` are read at each plan and each start. A second call while armed
 * does nothing.
 */
export function startAutoDiagnosis(deps: { overview: () => CerberusOverview; readInputs: () => CerberusReadInputs }): void {
  if (unsubscribe) return;

  const requestPlan = (): void => {
    if (!settled || pendingPlan) return;
    // Not unref'd: an unref'd immediate waits for the loop's next wake instead of its next turn. It lives one turn
    // and is only ever scheduled once settled, so it holds no process up that a minute has not already kept.
    pendingPlan = setImmediate(() => runPlan(deps, requestPlan));
  };

  unsubscribe = onHintSent(requestPlan);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    settled = true;
    requestPlan();
  }, SETTLE_MS);
  settleTimer.unref();

  const count = cerberusAutoDiagnosisDb.enabledSlots().size;
  console.log(`[auto-diagnosis] armed · ${count} ${count === 1 ? 'check diagnoses' : 'checks diagnose'} on their own`);
}

/**
 * Stops the trigger: it hears no more hints, and its settle timer, its deadline and its pending plan are gone. A
 * diagnosis already running is not touched; the lifecycle ends it.
 */
export function stopAutoDiagnosis(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  if (pendingPlan) clearImmediate(pendingPlan);
  pendingPlan = null;
  if (deadlineTimer) clearTimeout(deadlineTimer);
  deadlineTimer = null;
  deadlineAt = null;
  throwsInARow = 0;
  settled = false;
  saidExhausted.clear();
}

/**
 * Switches one active check's "Diagnose on its own" on or off. Throws the 404 for a check that is not
 * active; otherwise writes the check's one row (rewriting it when the check was switched before) and
 * hints the node and the check. `by` is who asked: the route passes the signed-in user's name.
 */
export function setAutoDiagnosis(input: { node: string; key: string; on: boolean }, by: string): void {
  // The check first: a switch for something that is not there is refused before a row is written.
  // Throws the 404 itself; the row it finds is not needed.
  findActiveCheck(input.node, input.key);

  cerberusAutoDiagnosisDb.set(input.node, input.key, input.on, Date.now(), by);

  hintChanged({ nodes: [input.node], checks: [`${input.node}/${input.key}`] });
}
