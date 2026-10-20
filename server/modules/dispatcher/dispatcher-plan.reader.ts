import type { DispatcherEvent, DispatcherPhase, DispatcherPlan, DispatcherStage } from '@/shared/types.js';

import { each, countOrNullSince, countSince, field, flagSince, isCount, isCountOrNull, isFlag, isRecord, isText, isTextOrNull, modelSince, names, need, oneOf, stallSince, textSince } from './dispatcher-state.transport.js';
import { askingSince } from './dispatcher-ask.reader.js';
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

/** The nine words a plan's status may be (`report.status_word`'s one precedence). Anything else is a build this lane cannot draw. */
export const PLAN_STATUSES: readonly DispatcherPlan['status'][] = ['idle', 'parked', 'queued', 'scheduled', 'paused', 'stalled', 'live', 'hidden', 'complete'];

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

/**
 * `plan.accept_armed`: the operator's "Accept when cut" press (`store_armed`) — the door, the hour and the
 * design stamp it was pressed against — or `null`. Read tolerantly like `asking`: a dispatcher build older
 * than the key writes none, and that reads as nothing armed.
 */
function acceptArmedOf(value: unknown): DispatcherPlan['accept_armed'] {
  if (value === undefined || value === null) return null;
  const press = need(value, isRecord, 'plan.accept_armed');
  return {
    at: need(field(press, 'at'), isText, 'plan.accept_armed.at'),
    by: need(field(press, 'by'), isText, 'plan.accept_armed.by'),
    design: need(field(press, 'design'), isText, 'plan.accept_armed.design'),
  };
}

/**
 * `plan.hidden`: since when the operator has had the plan hidden (`store_hidden`), and the epic whose press it
 * was, or `null` while it is shown. Read tolerantly like `accept_armed`: a dispatcher build older than the
 * key writes none, and that reads as shown — the card then draws nothing it cannot answer.
 */
function hiddenOf(value: unknown, name: string): DispatcherPlan['hidden'] {
  if (value === undefined || value === null) return null;
  const hide = need(value, isRecord, `plan.hidden of ${name}`);
  return {
    at: need(field(hide, 'at'), isText, `plan.hidden.at of ${name}`),
    arc: textSince(field(hide, 'arc'), `plan.hidden.arc of ${name}`),
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
    // build older than the fields, which is what `countSince` is for. `tokens_cache_read` is `null`
    // where nothing states it — a record from before the field, or a build older than it.
    tokens: countSince(field(stage, 'tokens'), 'stage.tokens'),
    tokens_in: countSince(field(stage, 'tokens_in'), 'stage.tokens_in'),
    tokens_out: countSince(field(stage, 'tokens_out'), 'stage.tokens_out'),
    tokens_cache_read: countOrNullSince(field(stage, 'tokens_cache_read'), 'stage.tokens_cache_read'),
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
    // Why the phase's run has ended with nothing to record it (`report_stall`), or `null` — the
    // dispatcher's own word, never re-derived from `status` and `busy` here. Read tolerantly, so a
    // build older than the field draws what it always drew.
    stalled: stallSince(field(phase, 'stalled'), 'phase.stalled'),
    rounds: need(field(phase, 'rounds'), isCount, 'phase.rounds'),
    cost_usd: need(field(phase, 'cost_usd'), isCount, 'phase.cost_usd'),
    tokens: countSince(field(phase, 'tokens'), 'phase.tokens'),
    tokens_in: countSince(field(phase, 'tokens_in'), 'phase.tokens_in'),
    tokens_out: countSince(field(phase, 'tokens_out'), 'phase.tokens_out'),
    tokens_cache_read: countOrNullSince(field(phase, 'tokens_cache_read'), 'phase.tokens_cache_read'),
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
    hidden: hiddenOf(field(plan, 'hidden'), name),
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
    // The plan's EFFECTIVE model word — its own, else its arc's, else the house switch's. Never
    // derived here: this is the document's own answer, and a second derivation would be a second
    // answer (`dispatcher/model.py:model.of` is the only one). `model_own` is the plan's OWN word, or
    // null while it follows its epic and the switch: the override a card's fold names.
    model: modelSince(field(plan, 'model'), 'plan.model'),
    model_own: modelSince(field(plan, 'model_own'), `plan.model_own of ${name}`),
    // The plan's posture phrase (`width.word`), read tolerantly like `arc`: a build older than the
    // field writes none.
    posture: textSince(field(plan, 'posture'), 'plan.posture'),
    // Why this plan waits for its EPIC'S turn — the gate's own queue clause for its first ready phase
    // (`line_gate.hold`), or `null`. Read tolerantly like `posture`: a build older than the field
    // writes none, and the card then draws no line.
    queue_hold: textSince(field(plan, 'queue_hold'), 'plan.queue_hold'),
    // The PACER's clause for the same first ready phase (`report.plan_dict.pace_hold`,
    // `pace_report.hold`), with its `pace:` lead — drawn in the same row as the queue's hold, of
    // which the gate sends one at a time. ABSENT reads `""` (a dispatcher build older than the key,
    // which held nothing on the window), so the card's `plan.pace_hold ?? ''` is the whole read.
    pace_hold: textSince(field(plan, 'pace_hold'), `plan.pace_hold of ${name}`) ?? '',
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
    // Why the plan's only running work has ended with nothing to record it (`report_stall`), beside
    // the `stalled` status word: the line the card says it by. Tolerant for a build older than it.
    stalled: stallSince(field(plan, 'stalled'), `plan.stalled of ${name}`),
    approved: approvedOf(field(plan, 'approved')),
    // The operator's "Accept when cut" press on this plan, and the stamp of the design it would bind to
    // (`design_loaded_at`) — the stamp the card sends back with its press. Both tolerant of a build older
    // than the keys, which draws no press.
    accept_armed: acceptArmedOf(field(plan, 'accept_armed')),
    design_loaded_at: textSince(field(plan, 'design_loaded_at'), 'plan.design_loaded_at'),
    // The prompt CloudCLI has put up for this plan and is waiting on — the one key the plan's card is
    // drawn from and the book is raised off (`dispatcher-asks.service.ts`). Tolerant for a build
    // older than it, which asks nothing.
    asking: askingSince(field(plan, 'asking'), `asking of ${name}`),
    waits_on: names(field(plan, 'waits_on'), 'plan.waits_on'),
    schedule: scheduleOf(field(plan, 'schedule')),
    cost_usd: need(field(plan, 'cost_usd'), isCount, 'plan.cost_usd'),
    // PAID dollars at `cost_usd`; the plan's tokens beside it, summed by `report.plan_dict` off the
    // phases' launches. A plan that rode the operator's Claude subscription is 0.00 there and these
    // three are the whole of what it spent — which is what the card draws instead of a `$`.
    tokens: countSince(field(plan, 'tokens'), 'plan.tokens'),
    tokens_in: countSince(field(plan, 'tokens_in'), 'plan.tokens_in'),
    tokens_out: countSince(field(plan, 'tokens_out'), 'plan.tokens_out'),
    tokens_cache_read: countOrNullSince(field(plan, 'tokens_cache_read'), 'plan.tokens_cache_read'),
    // How long at least one agent was out on this plan (`report_runtime`), in whole seconds: derived at
    // the dispatcher's own reading time and never stored. Read tolerantly, for a build older than the key.
    runtime_s: countSince(field(plan, 'runtime_s'), 'plan.runtime_s'),
    rounds: need(field(plan, 'rounds'), isCount, 'plan.rounds'),
    phases: each(field(plan, 'phases'), 'plan.phases', phaseOf),
    events: each(field(plan, 'events'), 'plan.events', eventOf),
  };
}
