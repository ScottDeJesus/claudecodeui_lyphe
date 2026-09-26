import { DISPATCHER_ENDING_PREFIX, dismissRun } from '@/modules/plan-runner';
import type { DispatcherArc, DispatcherPhase, DispatcherPlan, DispatcherPlanStatus, DispatcherPlanner, Tone } from '@/shared/types';

/**
 * The pure vocabulary of a v3 plan, in one file with no React in it.
 *
 * Everything here is a total function of a document the server already sent. Nothing polls, nothing
 * fetches and nothing remembers: a card that needs a fact about a plan asks one of these, so two
 * screens reading the same plan can never disagree about what colour it is or how far it has got.
 *
 * THE ONE EDGE WHERE THIS DOCUMENT'S STRINGS BECOME NUMBERS IS {@link epochOf}. Every time in the
 * document is the store's own `YYYY-MM-DDTHH:MM:SSZ` UTC string, never a number, and everything the
 * card draws from one — a scheduled start, an ended plan's age, the order two plans sit in — wants
 * seconds. Converting in one function rather than at each call site is what keeps a half-converted
 * card from existing at all.
 */

/** A scheduled moment's rendering is the runner lane's own (`scheduleClock`), never a second copy: one clock, two cards. */
export { scheduleClock } from '@/modules/plan-runner';

/**
 * One of the document's ISO stamps as epoch SECONDS, or `null` when there is nothing to convert —
 * a null field, or a string that is not a time at all (`offpeak_at` is the literal `none` on a
 * clock that could not answer, and the store writes `null` for a moment that never happened).
 *
 * `Date.parse` rather than a hand-rolled parser: the stamp is always the store's own UTC shape, and
 * a format this function had to understand would be a second place for that shape to drift.
 */
export function epochOf(iso: string | null): number | null {
  if (iso === null) return null;
  const milliseconds = Date.parse(iso);
  return Number.isNaN(milliseconds) ? null : milliseconds / 1000;
}

/**
 * How a plan's word reaches the eye. `live` and `complete` are `positive`: one is walking, the other
 * finished — neither asks for anything. Everything else is `neutral`: `paused`, `queued`,
 * `scheduled`, `parked` and `idle` are all states the operator chose or is waiting on, and amber
 * over a plan they parked themselves would be the card arguing with them (the run lane's rule).
 */
export function planStatusTone(status: DispatcherPlanStatus): Tone {
  return status === 'live' || status === 'complete' ? 'positive' : 'neutral';
}

/**
 * How a planner outing's state reaches the eye: `warn` for an ENDED one, `info` while a soul is out,
 * `neutral` while nothing has started.
 *
 * A WARNING IS FOR THE ONE STATE NOBODY ASKED FOR, and an ended outing the document carries is
 * exactly that: its work is still unfinished and the store is telling the operator a soul died before
 * finishing it (`report_planners.entries` carries no ending that did what it was for). Amber over a
 * queued outing would be the badge arguing with the operator's own press, and `out` is a soul at work
 * — the same `info` a running phase wears.
 */
export function plannerStatusTone(state: DispatcherPlanner['state']): Tone {
  if (state === 'ended') return 'warn';
  return state === 'out' ? 'info' : 'neutral';
}

/**
 * The same for one phase: `done` positive, `running` info, `not started` neutral. A phase that is
 * `running` and not busy is drawn by the card as SETTLING and never reaches here as running — that
 * decision is the card's (`PlanPhaseRow`), because it is a reading of two fields and not of a word.
 */
export function phaseStatusTone(phase: DispatcherPhase): Tone {
  if (phase.status === 'done') return 'positive';
  if (phase.status === 'running') return 'info';
  return 'neutral';
}

/**
 * The dispatcher's own three phase marks, so a state never reaches a reader as colour alone (design
 * doctrine :147-149). The store's vocabulary, spelled exactly as `report.phase_dict` writes it.
 */
export const PHASE_GLYPH: Record<DispatcherPhase['status'], string> = {
  done: '✅',
  running: '▶',
  'not started': '·',
};

/**
 * How much of the plan is behind it: `done` phases over all of them. A plan with no phases yet is
 * `0` rather than `NaN` — a designed plan whose phases are not cut is a real state and draws an
 * empty meter, not a broken one.
 */
export function phaseProgress(plan: DispatcherPlan): { done: number; total: number; percent: number } {
  const phases = plan.phases ?? [];
  const total = phases.length;
  const done = phases.filter((phase) => phase.status === 'done').length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * Where a plan is ranked in the list, and it is a reading of URGENCY rather than of recency.
 *
 * LIVE first because something is happening to it right now. SCHEDULED next because it is the one
 * plan that will move WITHOUT the operator — the hour is armed and a timer will press Start — so it
 * outranks the two parks below it (the document's own precedence, `DispatcherPlanStatus`). QUEUED
 * above PAUSED for the run lane's reason: a queued plan has not started at all and its Start is the
 * card's whole point, while a paused one was stopped mid-walk and can wait. PARKED and IDLE follow:
 * both were set aside on purpose, and a list that raised the operator's own decision above a plan in
 * motion would be the app arguing with them. COMPLETE last of all — nothing more will happen to it;
 * it is there to be read and dismissed — and within each rank the most recently touched first, since
 * that is the one the operator came to see.
 *
 * Reversible in one place, by design: change these numbers and the order changes, with nothing else
 * to find.
 */
export const STATUS_ORDER: Record<DispatcherPlanStatus, number> = {
  live: 0,
  scheduled: 1,
  queued: 2,
  paused: 3,
  parked: 4,
  idle: 5,
  complete: 6,
};

/** When a plan was last touched, epoch seconds; `0` for a stamp nothing can read, which parks it last inside its rank. */
function touchedAt(plan: DispatcherPlan): number {
  return epochOf(plan.updated_at) ?? 0;
}

/** Status first, then newest first inside each status. */
export function byUrgencyThenNewest(a: DispatcherPlan, b: DispatcherPlan): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || touchedAt(b) - touchedAt(a);
}

/** One arc of the lane with the plans of it, in the arc's own order (`DispatcherArc.plans`) — one card's worth. */
export type DispatcherArcGroup = { arc: DispatcherArc; plans: DispatcherPlan[] };

/** The lane, split: the arcs that hold plans, and the plans no arc holds. */
export type DispatcherArcSplit = { groups: DispatcherArcGroup[]; rest: DispatcherPlan[] };

/**
 * The lane split by `plan.arc` — every arc with the plans of it in the ARC's order, and everything
 * else in the urgency order a flat list has always used.
 *
 * ONE FUNCTION, TWO HOMES, AND NO THIRD READING. The Runner tab and the chat gutter's widget draw
 * the same lane in the same column, and a home that grouped or ordered for itself is how the two
 * would come to disagree about which card sits under which arc — so the split is here, a total
 * function of the frame, and both homes read it.
 *
 * AN ARC'S OWN ORDER IS THE STORE'S, NOT URGENCY'S. `arc.plans` is the arc file's walk order
 * (`store.arc_plans`, oldest first), and it is what the arc's deck draws: the reader is looking at a
 * sequence of thirteen plans that depend on each other, and re-sorting that by status would put the
 * live one at the top and undo the sequence the operator designed. A plan the arc's list does not
 * name (a member that pre-dated its arc, or a frame an older server built) still belongs to its arc
 * and is drawn after those, by urgency, so no plan is ever lost between the two orders.
 *
 * NOTHING IS DROPPED EITHER WAY, which is the property the whole screen rests on: every plan given
 * comes back exactly once — under its arc when the lane carries that arc, in `rest` when it belongs
 * to no arc or names one the lane does not carry (a frame whose arc list was refused, or an arc row
 * the server dropped). A split that could lose a card would be a list that silently hides a plan.
 */
export function byArc(plans: DispatcherPlan[], arcs: DispatcherArc[]): DispatcherArcSplit {
  const carried = new Set(arcs.map((arc) => arc.name));
  const held = new Map<string, DispatcherPlan[]>();
  const rest: DispatcherPlan[] = [];
  for (const plan of plans) {
    if (plan.arc === null || !carried.has(plan.arc)) {
      rest.push(plan);
      continue;
    }
    const bucket = held.get(plan.arc);
    if (bucket === undefined) held.set(plan.arc, [plan]);
    else bucket.push(plan);
  }

  const groups = arcs.map((arc) => {
    const position = new Map(arc.plans.map((name, at) => [name, at]));
    const mine = [...(held.get(arc.name) ?? [])].sort((a, b) =>
      (position.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.name) ?? Number.MAX_SAFE_INTEGER)
      || byUrgencyThenNewest(a, b));
    return { arc, plans: mine };
  });

  return { groups, rest: rest.sort(byUrgencyThenNewest) };
}

/** The layer a plan's card wears in the strip: the runner deck's own three words, over a plan's status. */
export type DispatchDeckLayer = 'done' | 'top' | 'beneath';

/**
 * Which layer of the arc's strip a plan is on — `done` for one that has finished, `top` for the one
 * being walked, `beneath` for everything else. Read by the card for the dimming a finished card wears
 * and written on the row as the harness's handle, so a deck's strip reads the same in either lane
 * (`ArcDeck`'s cards wear `ArcCardLayer` the same way).
 */
export function planLayer(plan: DispatcherPlan): DispatchDeckLayer {
  if (plan.status === 'complete') return 'done';
  return plan.status === 'live' ? 'top' : 'beneath';
}

/**
 * The plan a dispatch arc's strip opens on: the FIRST plan of the arc that has not finished — the one
 * the arc is walking, or is waiting on next — and the last when every plan of it is complete.
 *
 * Both orders are the ARC's (`arc.plans`), never urgency's: an arc is a sequence of plans that depend
 * on each other, so "where this arc stands" is a position in that sequence and not the most urgent
 * card in it. The runner's deck asks the same question of its own vocabulary (its live card, or the
 * last once the arc is complete).
 */
export function deckFocusIndex(plans: readonly DispatcherPlan[]): number {
  const next = plans.findIndex((plan) => plan.status !== 'complete');
  return next === -1 ? plans.length - 1 : next;
}

/**
 * The plan's `waits_on`, as far as the arc it belongs to can answer: the entries that name ANOTHER
 * plan of the same arc, in the order the document wrote them, and nothing where none does.
 *
 * THE ENTRIES ARE BARE NAMES — the store holds a plan's `waits_on` as the names it was written
 * with (`restorly--kit`, `report.launched`'s spelling), and the loader refuses an entry that is not
 * another plan of the arc, so a match against a member's own `name` is the whole of it and the entry
 * travels to the eye exactly as the document wrote it, which is the name the card it waits on wears.
 *
 * WHAT IS LEFT OUT IS THE POINT OF PASSING THE ARC IN: a wait on a plan OUTSIDE the arc, or on one
 * this lane no longer carries, is not a fact this card can show — the card it names is not on the
 * screen — and a `waits on` line naming a plan nobody can find reads as a broken link rather than as
 * a wait. A plan waiting on itself is nonsense the store should never write and is dropped too.
 */
export function waitsOnSiblings(plan: DispatcherPlan, members: DispatcherPlan[]): string[] {
  if (plan.waits_on.length === 0) return [];
  const names = new Set<string>();
  for (const member of members) {
    names.add(member.name);
  }
  names.delete(plan.name);
  return plan.waits_on.filter((name) => names.has(name));
}

/**
 * The dismissal a complete plan's card offers, or `undefined` where it offers none — the ONE rule
 * both homes and every nested list read, so three call sites cannot drift apart about when a Dismiss
 * appears or what it prunes.
 *
 * `carriedNames` is the lane's UNFILTERED list of plan ids (`useDispatcherPlans`), because that is
 * what a dismissal prunes the stored list against: pruning against the drawn cards would drop every
 * earlier dismissal the moment a second one was made. A plan whose completion the document cannot
 * date — the field null, or a stamp nothing can parse — has no ending to match and offers nothing.
 */
export function planDismissal(plan: DispatcherPlan, carriedNames: string[]): (() => void) | undefined {
  const endedAt = epochOf(plan.completed_at);
  if (plan.status !== 'complete' || endedAt === null) return undefined;
  return () => dismissRun({ run_id: `${DISPATCHER_ENDING_PREFIX}${plan.name}`, ended_at: endedAt }, carriedNames);
}

/**
 * The time part of the document's ISO stamp (`2026-09-24T10:02:11Z` → `10:02:11Z`). Sliced, not
 * parsed: the stamp is the store's own UTC shape, and the `Z` stays so a reader knows whose clock
 * it is. A stamp with no `T` is shown whole; a missing one is empty. Used by `PlanPhaseRow`'s stage
 * lines and `PlanFace`'s event feed, so one stamp reads one way on the card.
 */
export function clockOf(at: string | null): string {
  if (!at) return '';
  const marker = at.indexOf('T');
  return marker === -1 ? at : at.slice(marker + 1);
}
