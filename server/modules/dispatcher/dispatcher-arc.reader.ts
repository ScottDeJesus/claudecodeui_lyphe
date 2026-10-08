import type { DispatcherArc, DispatcherArcStatus, DispatcherArcWip, DispatcherWipSetting } from '@/shared/types.js';

import { countOrNullSince, countSince, each, field, flagSince, isCount, isRecord, isText, isTextOrNull, modelSince, names, need, oneOf, textSince, wipWord } from './dispatcher-state.transport.js';
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

/**
 * One limit of an arc's `wip` block: the epic's own word (`null` while it follows its default), the
 * word in force, and the default it falls back to (`default`: Settings' word for Claude work, `all`
 * for DeepSeek's — `wip.report`). `default` is absent from a build older than it, where Settings'
 * word is the default.
 */
function wipSettingOf(raw: unknown, where: string): DispatcherWipSetting {
  const setting = need(raw, isRecord, where);
  const own = field(setting, 'own');
  const fallback = setting.default;
  return {
    own: own === null ? null : wipWord(own, `${where}.own`),
    effective: wipWord(field(setting, 'effective'), `${where}.effective`),
    ...(fallback === undefined ? {} : { default: wipWord(fallback, `${where}.default`) }),
  };
}

/**
 * An arc's two WIP limits (`report_arcs.arc_dict.wip`), or `null` for a build OLDER than the field —
 * the control and the line that read it then draw nothing and the board stands, which is the
 * tolerance `modelSince` and its siblings give every field added after a build shipped. A key that IS
 * there and does not read is refused by name, with the arc it came from.
 */
function wipOf(value: unknown, name: string): DispatcherArcWip | null {
  if (value === undefined) return null;
  const wip = need(value, isRecord, `arc.wip of ${name}`);
  return {
    features: wipSettingOf(field(wip, 'features'), `arc.wip.features of ${name}`),
    tasks: wipSettingOf(field(wip, 'tasks'), `arc.wip.tasks of ${name}`),
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
    status: oneOf(field(arc, 'status'), ARC_STATUSES, `status of ${name}`),
    // The epic's two WIP limits, each as its own word and the word in force — what the epic's WIP
    // control draws and presses back (`dispatcher wip`), carried as the document states them.
    wip: wipOf(field(arc, 'wip'), name),
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
    // Whether a plan of the arc has STALLED (`report_arcs.stalled`): released, its only running work
    // ended and nothing to record it. The header draws Resume on it where nothing is stopped, beside
    // the Pause `walking` still draws. Tolerant: a build older than the field has no stalled plan to say.
    stalled: flagSince(field(arc, 'stalled'), `arc.stalled of ${name}`),
    // The ONE hour an arc's plans are armed for, or null (`report_arcs.hour`: the single distinct
    // armed stamp, null when there is none or when its plans were armed apart). It is the stamp the
    // header's Cancel is drawn over and the note beside it states — never computed here.
    schedule: textSince(field(arc, 'schedule'), `arc.schedule of ${name}`),
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
    tokens: countSince(field(arc, 'tokens'), 'arc.tokens'),
    tokens_in: countSince(field(arc, 'tokens_in'), 'arc.tokens_in'),
    tokens_out: countSince(field(arc, 'tokens_out'), 'arc.tokens_out'),
    tokens_cache_read: countOrNullSince(field(arc, 'tokens_cache_read'), 'arc.tokens_cache_read'),
    // How long at least one agent was out on the epic: the UNION over its plans' intervals and its own
    // outings (`report_arcs.arc_dict`), never its plans' figures added. Tolerant, like the plan's.
    runtime_s: countSince(field(arc, 'runtime_s'), 'arc.runtime_s'),
  };
}

/** Every arc of the document, oldest first — the document's own `arcs` list, or `[]` for a build older than the key. */
export function arcsOf(value: unknown): DispatcherArc[] {
  return value === undefined ? [] : each(value, 'arcs', arcOf);
}
