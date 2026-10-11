import type { DispatcherArc, DispatcherArcStatus, DispatcherArcWip, DispatcherArcWipLimit } from '@/shared/types.js';

import { countOrNullSince, countSince, each, field, flagSince, isCount, isFlag, isRecord, isText, isTextOrNull, isWipWord, isWipWordOrNull, modelSince, names, need, oneOf, textSince } from './dispatcher-state.transport.js';
import { plannerSince } from './dispatcher-planner.reader.js';

/**
 * One arc of the dispatcher's document, read field by field into the type the arc header draws.
 *
 * It is the plan reader's sibling and follows its every rule: this document is printed whole by a
 * process that has exited, so a field that does not match is a DIFFERENT BUILD of the dispatcher
 * rather than a torn write, and it is refused BY NAME (`dispatcher-plan.reader.ts` states it once).
 * The two reads live in two files because they are two shapes — an arc has no phases, no events and
 * no armed hour, a plan has no `plans` — and one reader per shape is what keeps each of them a
 * direct mirror of the row it came from.
 *
 * `plans` carries NAMES and nothing else, in `store.arc_plans` order — the arc file's order, except
 * for a member that pre-dated its arc. It is the list a card joins against `plan.arc`, and it is
 * deliberately not resolved into plan rows here: the store's own report made that join, and a second
 * one would be a second answer.
 */

/** The nine words an arc's derived status may be (`store_arcs.arc_word`'s one precedence). Anything else is a build this lane cannot draw. */
export const ARC_STATUSES: readonly DispatcherArcStatus[] = ['empty', 'complete', 'judging', 'stalled', 'live', 'scheduled', 'paused', 'queued', 'designing'];

/** One of an epic's two limits as `wip.report` prints it: its own word or `null`, the word in force and the default under it. */
function wipLimitOf(raw: unknown, where: string): DispatcherArcWipLimit {
  const limit = need(raw, isRecord, where);
  return {
    own: need(field(limit, 'own'), isWipWordOrNull, `${where}.own`),
    effective: need(field(limit, 'effective'), isWipWord, `${where}.effective`),
    default: need(field(limit, 'default'), isWipWord, `${where}.default`),
  };
}

/**
 * The epic's WIP block (`arc.wip`, `wip.report`): the two limits as the document prints them, passed
 * through and never summed, defaulted or compared here — the dispatcher states the `default` beside
 * each limit so that no reader has to work out which route the epic walks. A build older than the
 * block sends none (MANUAL, MAN-7682), which reads as `null`; a block that IS there and does not read
 * is refused by name.
 */
function wipOf(value: unknown, name: string): DispatcherArcWip | null {
  if (value === undefined) return null;
  const wip = need(value, isRecord, `arc.wip of ${name}`);
  return {
    features: wipLimitOf(field(wip, 'features'), `arc.wip.features of ${name}`),
    tasks: wipLimitOf(field(wip, 'tasks'), `arc.wip.tasks of ${name}`),
  };
}

/** One arc whole. Its `name` is read first, so every later refusal can name the arc it came from. */
export function arcOf(raw: unknown): DispatcherArc {
  const arc = need(raw, isRecord, 'arc');
  const name = need(field(arc, 'name'), isText, 'arc.name');
  return {
    name,
    goal: need(field(arc, 'goal'), isTextOrNull, `arc.goal of ${name}`),
    architecture: need(field(arc, 'architecture'), isTextOrNull, 'arc.architecture'),
    delivers: need(field(arc, 'delivers'), isTextOrNull, 'arc.delivers'),
    // The ARC's OWN word, never one of its plans' effective one: this row is what the arc's control
    // draws and presses, and pressing it hands the word to every plan of the arc
    // (`store.set_arc_model`). A build older than the field reads `null` — the store's default.
    model: modelSince(field(arc, 'model'), 'arc.model'),
    // The epic's two WIP limits — the only concurrency switches for the work under it, and the one
    // place the document says how wide an epic walks. Carried as printed (`wipOf`).
    wip: wipOf(field(arc, 'wip'), name),
    status: oneOf(field(arc, 'status'), ARC_STATUSES, `status of ${name}`),
    // THE ARC'S OWN VERBS, read off its plans' status words by `report_arcs` and drawn by the header
    // here: `walking` is what Pause is drawn for and `stopped` what Start and Schedule start are —
    // and `stopped` is every plan of the arc that is approved, paused and unfinished, so a whole arc
    // the operator accepted with Queue draws a Start. Both are read tolerantly, so a dispatcher build
    // older than the fields draws no control at all rather than a wrong one — which is what that
    // build's arc really is: an arc this lane cannot move. Neither word is the arc's `status` (the
    // module head says why: the two draw different controls, and the status does not tell them apart —
    // an arc with one plan at the gate and one still unapproved reads `designing` and `stopped` at
    // once, and a `designing` header draws no press while `stopped` is what Start is drawn for).
    walking: flagSince(field(arc, 'walking'), `arc.walking of ${name}`),
    stopped: flagSince(field(arc, 'stopped'), `arc.stopped of ${name}`),
    // The ONE hour an arc's plans are armed for, or null (`report_arcs.hour`: the single distinct
    // armed stamp, null when there is none or when its plans were armed apart). It is the stamp the
    // header's Cancel is drawn over and the note beside it states — never computed here.
    schedule: textSince(field(arc, 'schedule'), `arc.schedule of ${name}`),
    plans: names(field(arc, 'plans'), 'arc.plans'),
    // The one outing whose `target` IS this arc — its design, its cut, its judgment
    // (`report_planners.of_arc`). A row naming one of the arc's plans is that PLAN's and rides
    // `plan.planner` instead, so the header and the cards under it never state one outing twice.
    planner: plannerSince(field(arc, 'planner'), `arc.planner of ${name}`),
    // The arc's four remaining own readings, each derived by `report_arcs` off the plan rows the
    // document already holds: how many plans the "Accept when cut" press reaches and how many carry
    // one, whether any plan has stalled, and the epic's working time in whole seconds (the UNION of
    // its plans' intervals, never their sum). Required: today's document always prints them.
    armable: need(field(arc, 'armable'), isCount, `arc.armable of ${name}`),
    armed: need(field(arc, 'armed'), isCount, `arc.armed of ${name}`),
    stalled: need(field(arc, 'stalled'), isFlag, `arc.stalled of ${name}`),
    runtime_s: need(field(arc, 'runtime_s'), isCount, `arc.runtime_s of ${name}`),
    created_at: need(field(arc, 'created_at'), isText, 'arc.created_at'),
    completed_at: need(field(arc, 'completed_at'), isTextOrNull, 'arc.completed_at'),
    // The arc's books are its plans' sums, read by `report_arcs.arc_line` through the plan line's own
    // renderer (INV-4299) — dollars OR tokens, by who was used. They are carried here so the header
    // never has to add up the cards itself, which is how two readers of one figure start to disagree.
    cost_usd: need(field(arc, 'cost_usd'), isCount, 'arc.cost_usd'),
    tokens: countSince(field(arc, 'tokens'), 'arc.tokens'),
    tokens_in: countSince(field(arc, 'tokens_in'), 'arc.tokens_in'),
    tokens_out: countSince(field(arc, 'tokens_out'), 'arc.tokens_out'),
    tokens_cache_read: countOrNullSince(field(arc, 'tokens_cache_read'), 'arc.tokens_cache_read'),
  };
}

/** Every arc of the document, oldest first — the document's own `arcs` list, or `[]` for a build older than the key. */
export function arcsOf(value: unknown): DispatcherArc[] {
  return value === undefined ? [] : each(value, 'arcs', arcOf);
}
