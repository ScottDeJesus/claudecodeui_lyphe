import type { DispatcherArc, DispatcherArcQueue, DispatcherArcStatus } from '@/shared/types.js';

import { countOrNullSince, countSince, each, field, flagSince, isCount, isRecord, isText, isTextOrNull, isWholeFrom, modelSince, names, need, oneOf, textSince } from './dispatcher-state.transport.js';
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

/** The ten words an arc's derived status may be (`store_arcs.arc_word`'s one precedence). Anything else is a build this lane cannot draw. */
export const ARC_STATUSES: readonly DispatcherArcStatus[] = ['empty', 'complete', 'hidden', 'judging', 'stalled', 'live', 'scheduled', 'paused', 'queued', 'designing'];

/** The four words an epic's turn may be (`line_gate.places`). Anything else is a build this lane cannot draw. */
const QUEUE_TURNS: readonly DispatcherArcQueue['turn'][] = ['now', 'waiting', 'paused', 'hidden'];

/** A place in the queue is counted from 1, so `0` and `1.5` are refused where `isCount` would pass them. */
const isPlace = isWholeFrom(1);

/**
 * An arc's place in the queue (`report_arcs.arc_dict.queue`), or `null` — for an epic not in the queue
 * (`null`, its turn is over) and for a build OLDER than the field (absent). Both read the same on
 * purpose: the deck then draws no note and the board stands, which is the tolerance every field added
 * after a build shipped has. A key that IS there and does not read is refused by name, with the arc it
 * came from, so the journal line says which epic's place this build could not read.
 */
function queueOf(value: unknown, name: string): DispatcherArcQueue | null {
  if (value === undefined || value === null) return null;
  const queue = need(value, isRecord, `arc.queue of ${name}`);
  return {
    position: need(field(queue, 'position'), isPlace, `arc.queue.position of ${name}`),
    turn: oneOf(field(queue, 'turn'), QUEUE_TURNS, `arc.queue.turn of ${name}`),
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
    // (`store.set_arc_model`). `null` while the arc carries none and follows the house switch, and
    // for a build older than the field.
    model: modelSince(field(arc, 'model'), 'arc.model'),
    status: oneOf(field(arc, 'status'), ARC_STATUSES, `status of ${name}`),
    // THE ARC'S OWN VERBS, read off its plans' status words by `report_arcs` and drawn by the deck
    // here: `walking` is what Pause is drawn for, `midwalk` and `stalled` what Resume is, and `stopped`
    // the whole set a terminal's `resume <arc>` reaches (the plans held for their first Start are among
    // it and are the board's Start's). All are read tolerantly, so a dispatcher build older than the
    // fields draws no control at all rather than a wrong one — which is what that build's arc really
    // is: an arc this lane cannot move. None is the arc's `status` (the module head says why: the
    // status does not tell them apart — an arc with one plan at the gate and one still unapproved
    // reads `designing`).
    walking: flagSince(field(arc, 'walking'), `arc.walking of ${name}`),
    stopped: flagSince(field(arc, 'stopped'), `arc.stopped of ${name}`),
    midwalk: flagSince(field(arc, 'midwalk'), `arc.midwalk of ${name}`),
    // Whether a plan of the arc has STALLED (`report_arcs.stalled`): released, its only running work
    // ended and nothing to record it. The deck draws Resume on it beside the Pause `walking` still
    // draws. Tolerant: a build older than the field has no stalled plan to say.
    stalled: flagSince(field(arc, 'stalled'), `arc.stalled of ${name}`),
    // The ONE hour an arc's plans are armed for, or null (`report_arcs.hour`: the single distinct
    // armed stamp, null when there is none or when its plans were armed apart). It is the stamp the
    // deck's note states — never computed here.
    schedule: textSince(field(arc, 'schedule'), `arc.schedule of ${name}`),
    // How many of the arc's plans the "Accept when cut" press reaches now, and how many carry one
    // (`report_arcs.armable`, `armed`): the deck draws the press and its Cancel by them. Counts, so a
    // build older than the keys reads zero and draws neither.
    armable: countSince(field(arc, 'armable'), `arc.armable of ${name}`),
    armed: countSince(field(arc, 'armed'), `arc.armed of ${name}`),
    plans: names(field(arc, 'plans'), 'arc.plans'),
    // The one outing whose `target` IS this arc — its design, its cut, its judgment
    // (`report_planners.of_arc`). A row naming one of the arc's plans is that PLAN's and rides
    // `plan.planner` instead, so the header and the cards under it never state one outing twice.
    planner: plannerSince(field(arc, 'planner'), `arc.planner of ${name}`),
    created_at: need(field(arc, 'created_at'), isText, 'arc.created_at'),
    completed_at: need(field(arc, 'completed_at'), isTextOrNull, 'arc.completed_at'),
    // The arc's books are its plans' sums cut at the moment each feature joined the epic
    // (`report_arcs._books`), read by `report_arcs.arc_line` through the plan line's own renderer
    // (INV-4299) — dollars OR tokens, by who was used. They are carried here so the header never has
    // to add up the cards itself, which would count the past of a feature the epic took in late.
    cost_usd: need(field(arc, 'cost_usd'), isCount, 'arc.cost_usd'),
    // The vendor those dollars were billed by, merged over the same plan cut the figures sum
    // (`report_vendor.merge`): `DeepSeek`, `Claude API`, or `""` for a mix. Tolerant, like the plan's.
    paid_vendor: textSince(field(arc, 'paid_vendor'), `arc.paid_vendor of ${name}`),
    tokens: countSince(field(arc, 'tokens'), 'arc.tokens'),
    tokens_in: countSince(field(arc, 'tokens_in'), 'arc.tokens_in'),
    tokens_out: countSince(field(arc, 'tokens_out'), 'arc.tokens_out'),
    tokens_cache_read: countOrNullSince(field(arc, 'tokens_cache_read'), 'arc.tokens_cache_read'),
    // How long at least one agent was out on the epic: the UNION over its plans' intervals and its own
    // outings (`report_arcs.arc_dict`), never its plans' figures added. Tolerant, like the plan's.
    runtime_s: countSince(field(arc, 'runtime_s'), 'arc.runtime_s'),
    // The epic's place in the queue and what it means now (`report_arcs.arc_dict.queue`, from
    // `line_gate.places`): carried as the document states it, `null` for an epic not in the queue and
    // for a build older than the key. The server never orders epics — the dispatcher's own store does.
    queue: queueOf(field(arc, 'queue'), name),
  };
}

/** Every arc of the document, oldest first — the document's own `arcs` list, or `[]` for a build older than the key. */
export function arcsOf(value: unknown): DispatcherArc[] {
  return value === undefined ? [] : each(value, 'arcs', arcOf);
}
