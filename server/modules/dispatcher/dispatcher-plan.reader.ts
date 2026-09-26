import type { DispatcherEvent, DispatcherPhase, DispatcherPlan, DispatcherStage } from '@/shared/types.js';

import { each, countSince, field, flagSince, isCount, isCountOrNull, isFlag, isRecord, isText, isTextOrNull, modelSince, names, need, oneOf, textSince } from './dispatcher-state.transport.js';
import { plannerSince } from './dispatcher-planner.reader.js';

/**
 * One plan of the dispatcher's document, read field by field into the types the card draws.
 *
 * The plan is the one big shape in that document — its approval, its armed hour, thirteen of its own
 * keys, and its phases with their stages and its own log — so it is read here, beside the transport
 * vocabulary, rather than in `dispatcher-state.service.ts`, which reads the picture AROUND a plan
 * (the route, the daemon, the home) and this server's two acts on the whole. Both halves refuse a
 * field they cannot read, for the reason the service states once: this document is printed whole by
 * a process that has exited, so a field that does not match is a DIFFERENT BUILD of the dispatcher,
 * never a torn write, and a made-up plan on the operator's screen is worse than a stale one.
 *
 * REFERENCES ARE KEYS, never ids (INV-183): an event names its phase by KEY and `null` when it
 * names none, and `waits_on` is a list of plan names. Nothing here resolves one to the other — the
 * store's own report did that, and two resolutions would be two answers.
 */

/**
 * The document's plan as it validates: every key `report.py` writes, which is every key of
 * `DispatcherPlan` but the one this server adds (`session_app_id`, resolved in the service).
 */
export type DocumentPlan = Omit<DispatcherPlan, 'session_app_id'>;

/** The seven words a plan's status may be (`report.status_word`'s one precedence). Anything else is a build this lane cannot draw. */
export const PLAN_STATUSES: readonly DispatcherPlan['status'][] = ['idle', 'parked', 'queued', 'scheduled', 'paused', 'live', 'complete'];

/** The three words a phase's status may be (`phase_chain`'s own column). */
export const PHASE_STATUSES: readonly DispatcherPhase['status'][] = ['not started', 'running', 'done'];

/** `plan.approved`: the two keys of an approval, or `null` on a plan nobody has approved. */
function approvedOf(value: unknown): DispatcherPlan['approved'] {
  if (value === null) return null;
  const approved = need(value, isRecord, 'plan.approved');
  return {
    at: need(field(approved, 'at'), isText, 'plan.approved.at'),
    by: need(field(approved, 'by'), isText, 'plan.approved.by'),
  };
}

/** `plan.schedule`: the armed hour read back out of systemd at the instant of the read (`schedule.armed`), or `null` when none is armed. */
function scheduleOf(value: unknown): DispatcherPlan['schedule'] {
  if (value === null) return null;
  const hour = need(value, isRecord, 'plan.schedule');
  return {
    start_at: need(field(hour, 'start_at'), isText, 'plan.schedule.start_at'),
    unit: need(field(hour, 'unit'), isText, 'plan.schedule.unit'),
  };
}

/**
 * One `stages` row: the ten columns `phase_chain` projects out of the chain record. `verdict` is the
 * soul's own outcome word and is free text — the card draws it as written.
 */
function stageOf(raw: unknown): DispatcherStage {
  const stage = need(raw, isRecord, 'stage');
  return {
    name: need(field(stage, 'name'), isText, 'stage.name'),
    soul: need(field(stage, 'soul'), isTextOrNull, 'stage.soul'),
    launch_id: need(field(stage, 'launch_id'), isTextOrNull, 'stage.launch_id'),
    session_id: need(field(stage, 'session_id'), isTextOrNull, 'stage.session_id'),
    resumed_sid: need(field(stage, 'resumed_sid'), isTextOrNull, 'stage.resumed_sid'),
    launched_at: need(field(stage, 'launched_at'), isTextOrNull, 'stage.launched_at'),
    returned_at: need(field(stage, 'returned_at'), isTextOrNull, 'stage.returned_at'),
    output_path: need(field(stage, 'output_path'), isTextOrNull, 'stage.output_path'),
    verdict: need(field(stage, 'verdict'), isTextOrNull, 'stage.verdict'),
    cost_usd: need(field(stage, 'cost_usd'), isCount, 'stage.cost_usd'),
    // The stage's tokens, read at the dispatcher's own report time off the launch's `result.json`
    // (`report._usage_of` — the store holds no token column and is not getting one). Absent from a
    // build older than the fields, which is what `countSince` is for.
    tokens: countSince(field(stage, 'tokens'), 'stage.tokens'),
    tokens_in: countSince(field(stage, 'tokens_in'), 'stage.tokens_in'),
    tokens_out: countSince(field(stage, 'tokens_out'), 'stage.tokens_out'),
  };
}

/**
 * One phase, addressed by its key (INV-183). `busy` is the walker's liveness, read from its chain —
 * never the status column, which says what the phase has ACHIEVED and not whether anything holds it
 * (INV-186).
 */
function phaseOf(raw: unknown): DispatcherPhase {
  const phase = need(raw, isRecord, 'phase');
  return {
    key: need(field(phase, 'key'), isText, 'phase.key'),
    position: need(field(phase, 'position'), isCount, 'phase.position'),
    title: need(field(phase, 'title'), isText, 'phase.title'),
    assignee: need(field(phase, 'assignee'), isText, 'phase.assignee'),
    status: oneOf(field(phase, 'status'), PHASE_STATUSES, 'phase.status'),
    chain_id: need(field(phase, 'chain_id'), isTextOrNull, 'phase.chain_id'),
    done_at: need(field(phase, 'done_at'), isTextOrNull, 'phase.done_at'),
    waits_on: names(field(phase, 'waits_on'), 'phase.waits_on'),
    busy: need(field(phase, 'busy'), isFlag, 'phase.busy'),
    rounds: need(field(phase, 'rounds'), isCount, 'phase.rounds'),
    cost_usd: need(field(phase, 'cost_usd'), isCount, 'phase.cost_usd'),
    tokens: countSince(field(phase, 'tokens'), 'phase.tokens'),
    tokens_in: countSince(field(phase, 'tokens_in'), 'phase.tokens_in'),
    tokens_out: countSince(field(phase, 'tokens_out'), 'phase.tokens_out'),
    start_here: names(field(phase, 'start_here'), 'phase.start_here'),
    stages: each(field(phase, 'stages'), 'phase.stages', stageOf),
  };
}

/** One line of a plan's log. Its `id` must be a number: the endings watermark counts it (`dispatcher-endings.service.ts`). */
function eventOf(raw: unknown): DispatcherEvent {
  const event = need(raw, isRecord, 'event');
  return {
    id: need(field(event, 'id'), isCount, 'event.id'),
    at: need(field(event, 'at'), isText, 'event.at'),
    phase: need(field(event, 'phase'), isTextOrNull, 'event.phase'),
    kind: need(field(event, 'kind'), isText, 'event.kind'),
    detail: need(field(event, 'detail'), isTextOrNull, 'event.detail'),
  };
}

/** One plan whole. Its `name` is read first, so every later refusal can name the plan it came from. */
export function planOf(raw: unknown): DocumentPlan {
  const plan = need(raw, isRecord, 'plan');
  const name = need(field(plan, 'name'), isText, 'plan.name');
  return {
    name,
    state: need(field(plan, 'state'), isText, 'plan.state'),
    status: oneOf(field(plan, 'status'), PLAN_STATUSES, `status of ${name}`),
    repo: need(field(plan, 'repo'), isText, 'plan.repo'),
    goal: need(field(plan, 'goal'), isTextOrNull, 'plan.goal'),
    delivers: need(field(plan, 'delivers'), isTextOrNull, 'plan.delivers'),
    session: need(field(plan, 'session'), isTextOrNull, 'plan.session'),
    author: need(field(plan, 'author'), isTextOrNull, 'plan.author'),
    // The arc this plan belongs to, by NAME — the join a card makes against the document's own `arcs`
    // list. Read tolerantly (`textSince`), because a dispatcher build older than the field writes no
    // key at all and a plan of no arc writes `null`: both mean the same thing here, and neither is a
    // reason to blank every card on the screen.
    arc: textSince(field(plan, 'arc'), 'plan.arc'),
    // The ONE planner outing this plan is owed — its own, else its arc's when it has none of its own
    // (`report_planners.of_plan`: the plan's name is the first scope and the arc's the second). So a
    // plan of an arc being designed whole reports the arc's design, and the deck's header reports the
    // same row — one outing, two places it is true of. Read tolerantly (`plannerSince`), because a
    // dispatcher build older than the field writes no key at all.
    planner: plannerSince(field(plan, 'planner'), `plan.planner of ${name}`),
    // The plan's EFFECTIVE model word — its own, else its arc's, else the store's default. Never
    // derived here: this is the document's own answer, and a second derivation would be a second
    // answer (`dispatcher/model.py:model.of` is the only one).
    model: modelSince(field(plan, 'model'), 'plan.model'),
    created_at: need(field(plan, 'created_at'), isText, 'plan.created_at'),
    updated_at: need(field(plan, 'updated_at'), isText, 'plan.updated_at'),
    completed_at: need(field(plan, 'completed_at'), isTextOrNull, 'plan.completed_at'),
    prompted_at: need(field(plan, 'prompted_at'), isTextOrNull, 'plan.prompted_at'),
    paused: need(field(plan, 'paused'), isFlag, 'plan.paused'),
    // HAS A WALK EVER GONE OUT FOR THIS PLAN (`report.launched`, derived from the plan's own event
    // rows, never stored). It is the one fact that tells a plan STOPPED MID-WALK from one still
    // waiting at the gate — `paused` against `queued` in the status word, and the word on the card's
    // own primary button, which is Resume for the first and Start for the second. Read tolerantly,
    // so a dispatcher build older than the field draws its cards' gate verb rather than blank ones.
    launched: flagSince(field(plan, 'launched'), 'plan.launched'),
    approved: approvedOf(field(plan, 'approved')),
    waits_on: names(field(plan, 'waits_on'), 'plan.waits_on'),
    schedule: scheduleOf(field(plan, 'schedule')),
    cost_usd: need(field(plan, 'cost_usd'), isCount, 'plan.cost_usd'),
    // PAID dollars at `cost_usd`; the plan's tokens beside it, summed by `report.plan_dict` off the
    // phases' launches. A plan that rode the operator's Claude subscription is 0.00 there and these
    // three are the whole of what it spent — which is what the card draws instead of a `$`.
    tokens: countSince(field(plan, 'tokens'), 'plan.tokens'),
    tokens_in: countSince(field(plan, 'tokens_in'), 'plan.tokens_in'),
    tokens_out: countSince(field(plan, 'tokens_out'), 'plan.tokens_out'),
    rounds: need(field(plan, 'rounds'), isCount, 'plan.rounds'),
    phases: each(field(plan, 'phases'), 'plan.phases', phaseOf),
    events: each(field(plan, 'events'), 'plan.events', eventOf),
  };
}
