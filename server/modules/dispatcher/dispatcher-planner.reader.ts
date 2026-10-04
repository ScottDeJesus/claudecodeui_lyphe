import type { DispatcherPlanner } from '@/shared/types.js';

import { each, field, isCount, isFlag, isRecord, isText, isTextOrNull, need, oneOf } from './dispatcher-state.transport.js';

/**
 * One planner outing of the dispatcher's document, read field by field into the type the badges draw.
 *
 * It is the plan reader's and the arc reader's sibling and follows their every rule: this document is
 * printed whole by a process that has exited, so a field that does not match is a DIFFERENT BUILD of
 * the dispatcher rather than a torn write, and it is refused BY NAME (`dispatcher-plan.reader.ts`
 * states it once). A made-up outing on the operator's screen is worse than a stale one.
 *
 * ONE READER FOR THREE KEYS, which is why this is a file of its own. An outing is the one shape in
 * this document that is not a row of the store's own hierarchy — no phases, no events, no plans — and
 * it reaches a reader through three: the store's own `planners` list, a plan's `planner` and an arc's
 * `planner`. All three are picked out of that ONE list by `report_planners`, so the three can never
 * disagree about which outing a name is owed; one reader for all three is what keeps them one shape.
 *
 * THE TWO TOLERANT READS BELOW ARE THE POINT of the pair of functions under it. `planners`, a plan's
 * `planner` and an arc's `planner` are keys a dispatcher build OLDER than them never wrote, so their
 * absence is that build talking and not a malformed field — read as "no outing", exactly as an
 * absent `plan.arc` is read as "no arc". A key that IS there and does not read is still refused.
 */

/** The four works a planner may be out on (`hooks/dispatcher/cmd/planner.py`'s own verbs). Anything else is a build whose badge this lane cannot draw. */
const PLANNER_VERBS: readonly DispatcherPlanner['verb'][] = ['design', 'judge', 'tell', 'cut'];

/** The three states of one outing (`store_planners.LIVE_STATES` and the ending that closes it). Read against a list for the verb's reason: a badge's tone and its work word both switch on it. */
const PLANNER_STATES: readonly DispatcherPlanner['state'][] = ['queued', 'out', 'ended'];

/** One outing whole. Its `target` is read first, so every later refusal can name the work it came from. */
export function plannerOf(raw: unknown): DispatcherPlanner {
  const planner = need(raw, isRecord, 'planner');
  const target = need(field(planner, 'target'), isText, 'planner.target');
  return {
    id: need(field(planner, 'id'), isCount, 'planner.id'),
    target,
    // The two names, bare, as the store holds them (`store_planners.queue_planner` strips both
    // adornments): `target` is the work the outing is FOR, `plan` the name it lands in.
    plan: need(field(planner, 'plan'), isText, 'planner.plan'),
    // THE SOUL AND THE MODEL ARE FREE TEXT, unlike the verb and the state below, and the difference is
    // deliberate: `eupalinos` and the model word a launch was handed are NAMES to draw rather than
    // words a card switches on, so a fourth soul or a model this build has never heard of is a badge
    // that says so — not a reason to blank every card on the lane.
    soul: need(field(planner, 'soul'), isText, 'planner.soul'),
    model: need(field(planner, 'model'), isText, 'planner.model'),
    verb: oneOf(field(planner, 'verb'), PLANNER_VERBS, `verb of the planner for ${target}`),
    state: oneOf(field(planner, 'state'), PLANNER_STATES, `state of the planner for ${target}`),
    // The document's one DERIVED word for an outing: true on the endings whose work is still short of a
    // plan, which is every ending it carries at all (`report_planners.entries`). Read as a flag the key
    // must be there with — the document computed it, and a second reading here would be a second answer.
    stalled: need(field(planner, 'stalled'), isFlag, 'planner.stalled'),
    launch_id: need(field(planner, 'launch_id'), isTextOrNull, 'planner.launch_id'),
    created_at: need(field(planner, 'created_at'), isText, 'planner.created_at'),
    launched_at: need(field(planner, 'launched_at'), isTextOrNull, 'planner.launched_at'),
    ended_at: need(field(planner, 'ended_at'), isTextOrNull, 'planner.ended_at'),
    // What the ending left behind — `done`, or the crash the launch's own `result.json` named — and
    // `null` on a row that never ended. The badge draws an ended outing's cause as written.
    outcome: need(field(planner, 'outcome'), isTextOrNull, 'planner.outcome'),
    // THE TWO FIGURES A ROW DOES NOT CARRY. Dollars OR tokens by who was used (INV-4299): a planner
    // rides the operator's Claude subscription, so its dollars are 0.00 and its tokens are the figure.
    // Both are read off the launch's own `result.json` at the dispatcher's report time and never stored
    // (INV-172), exactly as a stage's are.
    tokens: need(field(planner, 'tokens'), isCount, 'planner.tokens'),
    cost_usd: need(field(planner, 'cost_usd'), isCount, 'planner.cost_usd'),
  };
}

/**
 * A plan's or an arc's ONE outing, or `null`.
 *
 * `null` is written by the document on a name no planner is on, and no key at all is written by a
 * dispatcher build older than the field — the two are the same reading here ("this name is owed no
 * outing"), which is what lets an older dispatcher's document draw cards with no badges rather than
 * blanking every card it does carry. `where` names the field for the one case that IS refused: a key
 * that is there and is neither an outing nor `null`.
 */
export function plannerSince(value: unknown, where: string): DispatcherPlanner | null {
  if (value === undefined || value === null) return null;
  return plannerOf(need(value, isRecord, where));
}

/** Every outing of the document, `id` order (the rule's own order), or `[]` for a build older than the key. */
export function plannersOf(value: unknown): DispatcherPlanner[] {
  return value === undefined ? [] : each(value, 'planners', plannerOf);
}
