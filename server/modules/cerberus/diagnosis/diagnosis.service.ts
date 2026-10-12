import crypto from 'node:crypto';

import { cerberusDiagnosesDb, cerberusUpdatesDb } from '@/modules/database/index.js';
import type {
  CerberusCheckView,
  CerberusDiagnosisSubmission,
  CerberusDiagnosisView,
  CerberusReadInputs,
} from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { publishCatalog } from '../catalog.service.js';
import { hintChanged } from '../cerberus-broadcast.js';
import { HUB_NODE_ID } from '../definition-document.js';
import { checkDetail } from '../read-model/check-detail.js';
import { diagnosisViewById } from '../read-model/diagnosis-views.js';
import { wardenLinks } from '../warden-links.js';

import { DiagnosisAgentFailure, resolveDiagnosisModel, runDiagnosisAgent } from './diagnosis-agent.js';
import { buildDiagnosisToolDeps } from './diagnosis-deps.js';
import { unknownDiagnosis } from './diagnosis-proposal.js';
import { CLOSED_SESSION_STEP, historyOnlyStep, openedSessionStep } from './diagnosis-step-words.js';
import { createDiagnosisStepLog, type DiagnosisStepLog } from './diagnosis-steps.js';
import { maskedConclusion } from './diagnosis-text.js';
import { buildDiagnosisTools } from './diagnosis-tools.js';
import { abandonCallsOf, closeNodeSession, openNodeSession, registerDiagnosisFrames } from './diagnosis-wire.js';

/**
 * The lifecycle of a diagnosis: the row, the session on the node, the steps, the agent, the outcome.
 *
 *   startDiagnosis   the `diagnoses` row (`running`) → `diag.open` and its receipt → the agent runs →
 *                    `diag.close` → the row ends `done` or `failed` → a proposal's one-off is published.
 *
 * THE LOOP IS BACKGROUND WORK. `startDiagnosis` answers the new id as soon as the row is written; the
 * loop runs on, and everything it does is told to the screens as it happens — each step stored and pushed
 * (`diagnosis-steps.ts`), the start and the end hinted, so the card says "Diagnosing…" and then "See
 * diagnosis". A diagnosis lives in this process's memory (`live`) only while it runs; what survives is the
 * row, and a row `running` with no loop is one a restart killed (`registerDiagnosisService`).
 *
 * THE SESSION. A node with a warden linked gets `diag.open`; the warden's `diag.opened` receipt is what
 * makes the session real — only then does the first step say "Opened a read-only session on <node>" and
 * do the node's three reads exist for the agent. The hub (`center`) has no warden, a node that is not
 * linked has no link, a node another diagnosis already holds a session on is refused by its warden (which
 * still sends the receipt), a warden that never answers the open is one from before diagnoses, and a node
 * whose warden is updating (its update is the batch's active one, `cerberusUpdatesDb.activeNode()`) takes
 * no `diag.open` — a session opened after the warden's last idle check would be killed by its clean stop;
 * all five run on history alone, and the FIRST STEP says so, in words. `diag.close` goes whenever a session was
 * asked for, however the diagnosis ends, and the closing step ("Closed the session · nothing was
 * changed") is written only for a session that opened and was closed on a live link.
 *
 * ENDINGS. A diagnosis ends exactly once (the store's `end` fires only while the row is `running`, and
 * `conclude` is the one door), and each way it can fail is a sentence for the sheet:
 *   - the agent submitted      → `done`; a proposal is published as the node's one-off — by the call that
 *     ended the row only: a row already ended out of band (a boot sweep) keeps that end and publishes nothing;
 *   - the agent ended without one, or could not run → `failed`, with the agent's own sentence;
 *   - the 3-minute ceiling     → `failed`; the agent is stopped;
 *   - the link was lost        → `failed`. A session lives and dies with its link, so it ends on the
 *     node's link going down (`wardenLinks.onChange`) and — when a new link replaces a dead one without a
 *     down edge — on the next `hello`, which also answers any diagnosis it lists that center does not
 *     hold with `diag.close`;
 *   - center restarted         → `failed`: a diagnosis's loop dies with the process, so `registerDiagnosisService`
 *     ends every row still `running` at boot, and `stopDiagnoses` ends the live ones on a clean shutdown.
 * Every wait is ended by an event (a frame, a link change, the agent's return) or is a deadline on work
 * in flight (the receipt, a read, the ceiling); nothing polls.
 *
 * A diagnosis made for the hub never carries a proposal: it has no warden to run a fix on, so
 * `diagnosis-deps.ts` refuses one at `submit_diagnosis` and the agent resubmits without.
 *
 * Refusals: 404 `CERBERUS_UNKNOWN_CHECK` (the check is not an active one) and 409 `CERBERUS_DIAG_RUNNING`
 * (the check has a diagnosis running — the store's `insert` enforces it, so two requests cannot both start one).
 *
 * Consumers: `diagnosis.routes.ts` (`startDiagnosis`, `getDiagnosis`) and `cerberus.module.ts`
 * (`registerDiagnosisService` at start, `stopDiagnoses` at stop).
 */

/** A diagnosis is stopped this long after it started, answered or not. */
const CEILING_MS = 3 * 60 * 1000;

/** Whether a session is asked for on the node's link (`asked`: `diag.open` sent, no receipt yet) or open (`open`: the warden's receipt came). */
type SessionState = 'none' | 'asked' | 'open';

/** A diagnosis whose loop is running in this process. */
type LiveDiagnosis = {
  id: string;
  node: string;
  /** The check's key. */
  check: string;
  steps: DiagnosisStepLog;
  /** Fires on the ceiling, a lost link and a shutdown; the agent's signal follows it. */
  controller: AbortController;
  ceiling: NodeJS.Timeout;
  /** When the ceiling fires (epoch ms). */
  endsAt: number;
  session: SessionState;
  ended: boolean;
};

type Outcome =
  | { status: 'done'; submission: CerberusDiagnosisSubmission }
  // `sessionLost`: the link the session lived on is gone, so there is nothing to close and nothing was "closed".
  | { status: 'failed'; error: string; sessionLost?: boolean };

const live = new Map<string, LiveDiagnosis>();

const CEILING_SENTENCE = 'The diagnosis ran past its 3-minute limit and was stopped before it submitted an answer.';
const RESTART_SENTENCE = 'Cerberus restarted while the diagnosis was running, so it was stopped. Ask again.';

const lostLinkSentence = (node: string): string => `The link to ${node} was lost during the diagnosis, so it was stopped.`;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Ends the diagnosis — once. Closes the session first (so the closing step precedes the end), stores the
 * outcome, publishes a proposal's one-off, and tells the screens. A second call, from whichever of the
 * agent's return, the ceiling or a lost link comes second, does nothing.
 */
function conclude(diag: LiveDiagnosis, outcome: Outcome): void {
  if (diag.ended) return;
  diag.ended = true;
  clearTimeout(diag.ceiling);
  live.delete(diag.id);

  // Nobody is waiting for a read any more. A failed diagnosis also stops the agent, which may be mid-turn.
  abandonCallsOf(diag.id, new Error('The diagnosis ended.'));
  if (outcome.status === 'failed') diag.controller.abort(new Error(outcome.error));

  const sessionLost = outcome.status === 'failed' && outcome.sessionLost === true;
  if (diag.session !== 'none' && !sessionLost) {
    const sent = closeNodeSession(diag.node, diag.id);
    if (sent && diag.session === 'open') diag.steps.say(CLOSED_SESSION_STEP);
  }
  diag.session = 'none';

  const stored = storeOutcome(diag.id, outcome);
  if (stored === 'done' && outcome.status === 'done' && outcome.submission.proposal !== null) {
    try {
      publishCatalog(diag.node);
    } catch (error) {
      // The diagnosis stands; the one-off rides the next set any publish builds, and the run asks for the ack it waits on.
      console.error(`[Cerberus] diagnosis ${diag.id} ended with a proposal and node ${diag.node}'s catalog could not be published: ${describe(error)}`);
    }
  }
  hintChanged({ nodes: [diag.node], checks: [`${diag.node}/${diag.check}`] });
}

/**
 * Writes the end to the row and answers the status THIS call ended it with. The store's `end` fires only
 * while the row is `running` and answers whether it did: when the row had already ended out of band (a
 * restart's boot sweep, an older process at a handover) that end stands, this one changed nothing, and
 * the answer is `null` — so no one-off is published for a conclusion the row does not hold. A
 * conclusion the store refuses (it checks the shape its readers need) is stored as the failure it is,
 * never lost with the row left `running`; `null` too when even that could not be written.
 */
function storeOutcome(diagId: string, outcome: Outcome): 'done' | 'failed' | null {
  const endedAt = Date.now();
  try {
    if (outcome.status === 'failed') {
      return cerberusDiagnosesDb.end(diagId, 'failed', { endedAt, error: outcome.error }) ? 'failed' : null;
    }
    // The agent's words are masked as they are stored (`diagnosis-text.ts`): a model can reassemble a credential it was never shown.
    const { summary, evidence, proposal } = maskedConclusion(outcome.submission);
    const ended = cerberusDiagnosesDb.end(diagId, 'done', {
      endedAt,
      summary,
      evidence: JSON.stringify(evidence),
      proposal: proposal === null ? null : JSON.stringify(proposal),
    });
    return ended ? 'done' : null;
  } catch (error) {
    console.error(`[Cerberus] diagnosis ${diagId} could not be stored as it ended: ${describe(error)}`);
    if (outcome.status === 'failed') return null;
    try {
      const failed = cerberusDiagnosesDb.end(diagId, 'failed', {
        endedAt,
        error: `The diagnosis reached an answer that could not be stored: ${describe(error)}.`,
      });
      return failed ? 'failed' : null;
    } catch (secondError) {
      console.error(`[Cerberus] diagnosis ${diagId} could not be stored as failed either: ${describe(secondError)}`);
      return null;
    }
  }
}

/**
 * Whether another diagnosis of this node's has a session asked for or open — `session` is set before the
 * first await of `openSession`, so one started a moment ago already counts.
 */
function sessionHeldByAnother(diag: LiveDiagnosis): boolean {
  return [...live.values()].some((other) => other !== diag && other.node === diag.node && other.session !== 'none');
}

/**
 * Opens the node's session when there is one to open, and writes the diagnosis's first step either way.
 * Answers whether the node's reads exist for this diagnosis.
 */
async function openSession(diag: LiveDiagnosis): Promise<boolean> {
  const { node } = diag;
  if (node === HUB_NODE_ID) {
    diag.steps.say(historyOnlyStep(node, 'hub'));
    return false;
  }
  // Read from the store: this node's update is the active one, so its warden is about to restart and takes no session.
  if (cerberusUpdatesDb.activeNode() === node) {
    diag.steps.say(historyOnlyStep(node, 'updating'));
    return false;
  }
  if (!wardenLinks.isLinked(node)) {
    diag.steps.say(historyOnlyStep(node, 'not_linked'));
    return false;
  }
  // A warden holds ONE open diagnosis and still answers `diag.opened` to a second `diag.open`, refusing it only on
  // its reads — so the receipt cannot tell a session from a refusal. Center knows its own sessions: a node
  // another diagnosis holds is read from history alone, and the first step says why.
  if (sessionHeldByAnother(diag)) {
    diag.steps.say(historyOnlyStep(node, 'busy'));
    return false;
  }

  diag.session = 'asked';
  const opening = await openNodeSession(node, diag.id, diag.check);
  // The ceiling or a lost link ended it while the receipt was awaited: nothing more to say.
  if (diag.ended) return false;

  if (opening === 'opened') {
    diag.session = 'open';
    diag.steps.say(openedSessionStep(node));
    return true;
  }
  // `no_link` never reached the warden, so there is no session to close; `no_answer` may yet open late, and the close at the end covers it.
  if (opening === 'no_link') diag.session = 'none';
  diag.steps.say(historyOnlyStep(node, opening === 'no_link' ? 'not_linked' : 'no_answer'));
  return false;
}

/** The sentence for an agent that ended without an answer: its own, or a generic one for a fault outside it. */
function failureSentence(error: unknown): string {
  if (error instanceof DiagnosisAgentFailure) return error.message;
  console.error(`[Cerberus] a diagnosis loop failed: ${describe(error)}`);
  return `The diagnosis could not run: ${describe(error).replace(/[.\s]+$/, '')}.`;
}

async function runDiagnosis(diag: LiveDiagnosis, check: CerberusCheckView, model: string): Promise<void> {
  try {
    const linked = await openSession(diag);
    if (diag.ended) return;
    // Filled by the agent once its prompt is built; the submission is held to the quotations the reads and the prompt carry.
    const told = { prompt: '' };
    const tools = buildDiagnosisTools(
      buildDiagnosisToolDeps({
        diagId: diag.id,
        node: diag.node,
        linked,
        canRunFixes: diag.node !== HUB_NODE_ID,
        steps: diag.steps,
        isOver: () => diag.ended,
        endsAt: diag.endsAt,
        signal: diag.controller.signal,
        told,
      })
    );
    const submission = await runDiagnosisAgent({
      check,
      node: diag.node,
      model,
      tools,
      signal: diag.controller.signal,
      onPrompt: (systemPrompt) => {
        told.prompt = systemPrompt;
      },
    });
    conclude(diag, { status: 'done', submission });
  } catch (error) {
    // A no-op when the ceiling or a lost link ended it first: their sentence is the one stored.
    conclude(diag, { status: 'failed', error: failureSentence(error) });
  }
}

/**
 * Starts a diagnosis of `check` on `node`, asked by `askedBy`, and answers its id; the loop runs on in
 * the background. `model` is the model asked for (`haiku`, a full id) — absent, `CERBERUS_DIAG_MODEL`,
 * else `sonnet` (`resolveDiagnosisModel`). The check is read as the sheet reads it NOW, with `inputs`
 * (the moment, the links, ingest's memory): it is what the agent's prompt names.
 */
export function startDiagnosis(input: { node: string; check: string; model?: string | null; askedBy: string }, inputs: CerberusReadInputs): string {
  const { node, check: checkKey, askedBy } = input;
  const check = checkDetail(node, checkKey, {}, inputs).check;
  const model = resolveDiagnosisModel(input.model);
  const id = crypto.randomBytes(8).toString('hex');
  const startedAt = Date.now();

  if (!cerberusDiagnosesDb.insert({ id, node, check_key: checkKey, asked_by: askedBy, model, started_at: startedAt })) {
    throw new AppError(`A diagnosis of ${check.label ?? checkKey} is already running on ${node}.`, {
      code: 'CERBERUS_DIAG_RUNNING',
      statusCode: 409,
    });
  }

  const diag: LiveDiagnosis = {
    id,
    node,
    check: checkKey,
    steps: createDiagnosisStepLog(id, startedAt),
    controller: new AbortController(),
    ceiling: setTimeout(() => conclude(diag, { status: 'failed', error: CEILING_SENTENCE }), CEILING_MS),
    endsAt: startedAt + CEILING_MS,
    session: 'none',
    ended: false,
  };
  // The ceiling is a deadline on work in flight, never a reason for a process to stay up.
  diag.ceiling.unref();
  live.set(id, diag);
  hintChanged({ nodes: [node], checks: [`${node}/${checkKey}`] });

  void runDiagnosis(diag, check, model);
  return id;
}

/** One diagnosis with its steps and its run's lines, for `GET /diagnoses/:id`; a 404 `CERBERUS_UNKNOWN_DIAGNOSIS` when none carries the id. */
export function getDiagnosis(id: string): CerberusDiagnosisView {
  const view = diagnosisViewById(id);
  if (!view) throw unknownDiagnosis(id);
  return view;
}

/** Fails every diagnosis of `node` that has a session on its link: the link it went out on is gone. */
function failSessionsOf(node: string): void {
  for (const diag of [...live.values()]) {
    if (diag.node === node && diag.session !== 'none') {
      conclude(diag, { status: 'failed', error: lostLinkSentence(node), sessionLost: true });
    }
  }
}

/** Ends every diagnosis still running in this process — a clean shutdown: their loops end with it. */
export function stopDiagnoses(): void {
  for (const diag of [...live.values()]) conclude(diag, { status: 'failed', error: RESTART_SENTENCE });
}

/**
 * Arms the diagnosis service: the two frames a warden answers with, the two events that end a session
 * (the node's link going down, and a hello — see the file header), and the sweep of what a restart left
 * behind. Called once at the module's start, before the gateway binds: a second registration of the
 * frames throws, a mistake to hear about at boot.
 */
export function registerDiagnosisService(): void {
  registerDiagnosisFrames();
  wardenLinks.onChange((node, state) => {
    if (!state.linked) failSessionsOf(node);
  });
  wardenLinks.onHello((node, hello) => {
    failSessionsOf(node);
    // A diagnosis the warden lists that center does not hold (one a restart ended, one just failed above) is closed on the warden's side.
    for (const diagId of hello.activeDiags ?? []) {
      if (!live.has(diagId)) wardenLinks.send(node, 'diag.close', { diagId });
    }
  });

  // A row `running` with no loop behind it was left by a process that is gone (or by a handover's older one,
  // whose loops end with it): nothing will ever end it, so it ends now, with the reason.
  const endedAt = Date.now();
  for (const row of cerberusDiagnosesDb.running()) {
    if (live.has(row.id)) continue;
    if (cerberusDiagnosesDb.end(row.id, 'failed', { endedAt, error: RESTART_SENTENCE })) {
      hintChanged({ nodes: [row.node], checks: [`${row.node}/${row.check_key}`] });
    }
  }
}
