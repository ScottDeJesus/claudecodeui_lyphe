import type { DispatcherArc, DispatcherArcStatus } from '@/shared/types.js';

import { countSince, each, field, flagSince, isCount, isRecord, isText, isTextOrNull, modelSince, names, need, oneOf, textSince } from './dispatcher-state.transport.js';

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

/** The five words an arc's derived status may be (`store_arcs.arc_word`'s one precedence). Anything else is a build this lane cannot draw. */
export const ARC_STATUSES: readonly DispatcherArcStatus[] = ['empty', 'judged', 'complete', 'live', 'designing'];

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
    // (`store.set_arc_model`). A build older than the field reads `null` — the runner's default.
    model: modelSince(field(arc, 'model'), 'arc.model'),
    status: oneOf(field(arc, 'status'), ARC_STATUSES, `status of ${name}`),
    // THE ARC'S OWN VERBS, read off its plans' status words by `report_arcs` and drawn by the header
    // here: `walking` is what Stop is drawn for and `stopped` what Resume and Resume at 3:00 AM are.
    // Both are read tolerantly, so a dispatcher build older than the fields draws no control at all
    // rather than a wrong one — which is what that build's arc really is: an arc this lane cannot
    // move. Neither word is the arc's `status` (the module head says why: `designing` is true of a
    // stopped arc and of one that never started, and the two draw different controls).
    walking: flagSince(field(arc, 'walking'), `arc.walking of ${name}`),
    stopped: flagSince(field(arc, 'stopped'), `arc.stopped of ${name}`),
    // The ONE hour an arc's plans are armed for, or null (`report_arcs.hour`: the single distinct
    // armed stamp, null when there is none or when its plans were armed apart). It is the stamp the
    // header's Cancel is drawn over and the note beside it states — never computed here.
    schedule: textSince(field(arc, 'schedule'), `arc.schedule of ${name}`),
    plans: names(field(arc, 'plans'), 'arc.plans'),
    created_at: need(field(arc, 'created_at'), isText, 'arc.created_at'),
    completed_at: need(field(arc, 'completed_at'), isTextOrNull, 'arc.completed_at'),
    // The arc's books are its plans' sums, read by `report_arcs.arc_line` through the plan line's own
    // renderer (INV-4299) — dollars OR tokens, by who was used. They are carried here so the header
    // never has to add up the cards itself, which is how two readers of one figure start to disagree.
    cost_usd: need(field(arc, 'cost_usd'), isCount, 'arc.cost_usd'),
    tokens: countSince(field(arc, 'tokens'), 'arc.tokens'),
    tokens_in: countSince(field(arc, 'tokens_in'), 'arc.tokens_in'),
    tokens_out: countSince(field(arc, 'tokens_out'), 'arc.tokens_out'),
  };
}

/** Every arc of the document, oldest first — the document's own `arcs` list, or `[]` for a build older than the key. */
export function arcsOf(value: unknown): DispatcherArc[] {
  return value === undefined ? [] : each(value, 'arcs', arcOf);
}
