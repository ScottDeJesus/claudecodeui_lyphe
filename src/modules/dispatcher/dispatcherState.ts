import { inCardOrder } from '@/modules/dispatcher/cardOrder';
import type { DispatcherArc, DispatcherArcSplit, DispatcherPhase, DispatcherPlan, DispatcherPlanStatus, DispatcherPlanner, LaneCard, Tone } from '@/shared/types';

/**
 * The pure vocabulary of a plan, in one file with no React in it.
 *
 * Everything here is a total function of a document the server already sent. Nothing polls, nothing
 * fetches and nothing remembers: a card that needs a fact about a plan asks one of these, so two
 * screens reading the same plan can never disagree about what colour it is or how far it has got.
 *
 * THE ONE EDGE WHERE THIS DOCUMENT'S STRINGS BECOME NUMBERS IS {@link epochOf}. Every time in the
 * document is the store's own `YYYY-MM-DDTHH:MM:SSZ` UTC string, never a number, and everything the
 * card draws from one — a scheduled start, an ended plan's age — wants seconds. Converting in one function rather than at each call site is what keeps a half-converted
 * card from existing at all.
 */

/**
 * A scheduled moment in the reader's own clock: `3:00 AM` today, `Sep 23, 3:00 AM` any other day. The
 * date rides whenever the moment is not today, because DeepSeek's off-peak lifts at 3 AM Pacific — past
 * the operator's midnight — and a bare `3:00 AM` read in the evening names a time that has already
 * passed. One clock, three call sites: a plan card's own clock (`PlanFace.PlanClock`), an arc's armed
 * hour (`DispatchArcControls`) and `ScheduleControl`'s `Start at …` all name one moment one way.
 */
export function scheduleClock(epochSeconds: number, now: number = Date.now()): string {
  const moment = new Date(epochSeconds * 1000);
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (moment.toDateString() === new Date(now).toDateString()) return moment.toLocaleTimeString([], time);
  return moment.toLocaleString([], { month: 'short', day: 'numeric', ...time });
}

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
 * over a plan they parked themselves would be the card arguing with them.
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
 * How much of the plan is behind it: `done` phases, and all of them. A plan with no phases yet is
 * `0 of 0` — a designed plan whose phases are not cut is a real state, and its card draws no track
 * rather than a broken one.
 */
export function phaseProgress(plan: DispatcherPlan): { done: number; total: number } {
  const phases = plan.phases ?? [];
  return { done: phases.filter((phase) => phase.status === 'done').length, total: phases.length };
}

/**
 * The lane split by `plan.arc`, every card in the operator's order — the one split the Runner tab and
 * the chat gutter's widget both read.
 *
 * ONE FUNCTION, TWO HOMES, AND NO THIRD READING. The tab and the widget draw the same lane, and a home
 * that grouped or ordered for itself is how the two would come to disagree about which card sits under
 * which arc and which stands first — so the split is here, a total function of the frame and of the
 * operator's saved ranks (`cardOrderEntries.ts`), and both homes read it. `cards` is every top-level
 * card in the ONE order (`cardOrder.ts`: rank, higher first, ties by name — the widget's column);
 * `groups` and `rest` are its decks and its plans of no arc, each keeping that order among its own
 * kind (the tab's decks above, its wall below).
 *
 * NOTHING BUT THE OPERATOR'S ARRANGEMENT MOVES A CARD. Status, `updated_at`, an owed word, a swarm
 * press and the open chat all change a plan every few seconds; a card that stood by any of them would
 * jump under the reader's hand. A plan that asks keeps its place and its band.
 *
 * AN ARC'S OWN ORDER IS THE STORE'S. `arc.plans` is the arc file's walk order (`store.arc_plans`), and
 * it is what the arc's deck draws: the reader is looking at a sequence of thirteen plans that depend
 * on each other, and re-sorting that would undo the sequence the operator designed. A plan the arc's
 * list does not name (a member that pre-dated its arc, or a frame an older server built) still
 * belongs to its arc and is drawn after those, in the order it was created.
 *
 * NOTHING IS DROPPED EITHER WAY, which is the property the whole screen rests on: every plan given
 * comes back exactly once — under its arc when the lane carries that arc, in `rest` when it belongs
 * to no arc or names one the lane does not carry (a frame whose arc list was refused, or an arc row
 * the server dropped). A split that could lose a card would be a list that silently hides a plan.
 */
export function byArc(plans: DispatcherPlan[], arcs: DispatcherArc[], ranks: ReadonlyMap<string, number>): DispatcherArcSplit {
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

  const created = (plan: DispatcherPlan) => epochOf(plan.created_at) ?? 0;
  const groups = arcs.map((arc) => {
    const position = new Map(arc.plans.map((name, at) => [name, at]));
    const mine = [...(held.get(arc.name) ?? [])].sort((a, b) =>
      (position.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.name) ?? Number.MAX_SAFE_INTEGER)
      || created(a) - created(b)
      || (a.name < b.name ? -1 : 1));
    return { arc, plans: mine };
  });

  const cards = inCardOrder<LaneCard>(
    [...groups.map((group): LaneCard => ({ kind: 'arc', group })), ...rest.map((plan): LaneCard => ({ kind: 'plan', plan }))],
    (card) => (card.kind === 'arc' ? card.group.arc : card.plan),
    ranks,
  );
  return {
    cards,
    groups: cards.flatMap((card) => (card.kind === 'arc' ? [card.group] : [])),
    rest: cards.flatMap((card) => (card.kind === 'plan' ? [card.plan] : [])),
  };
}

/** The layer a plan's card wears in the arc's strip: three words, over a plan's status. */
export type DispatchDeckLayer = 'done' | 'top' | 'beneath';

/**
 * Which layer of the arc's strip a plan is on — `done` for one that has finished, `top` for the one
 * being walked, `beneath` for everything else. Read by the card for the dimming a finished card wears
 * and written on the row as the harness's handle, so the strip can be read without measuring pixels.
 */
export function planLayer(plan: DispatcherPlan): DispatchDeckLayer {
  if (plan.status === 'complete') return 'done';
  return plan.status === 'live' ? 'top' : 'beneath';
}

/**
 * The plan a dispatch arc's strip opens on: the FIRST plan of the arc that has not finished — the one
 * the arc is walking, or is waiting on next — and the last when every plan of it is complete.
 *
 * Both orders are the ARC's (`arc.plans`), never a status's: an arc is a sequence of plans that depend
 * on each other, so "where this arc stands" is a position in that sequence and not whichever card is
 * busiest. It is what the deck's strip opens on.
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
 * Whether `dispatcher drop` would take this plan, read off the document. It checks `cmd/drop.py`'s two
 * gates. First, nothing of the plan walks: no phase is `busy`, which is the chain layer's own answer.
 * Second, no planner row for the plan or its arc is live: that is `store.live_for`, mirrored over the
 * lane's `planners` (`queued`/`out`, `target` or `plan` naming either). `plan.planner` cannot answer
 * the second gate. `report_planners.of_plan` gives a plan's OWN row first, an ending included, so a
 * plan whose own cut ended short hides its arc's queued cut, and `drop` refuses it. `live` is refused
 * as well, for the window the document cannot see: `phase_chain.launch` forks the walker before the
 * phase carries a `chain_id`, and a plan the rule can launch is exactly a `live` one. Where this is
 * false the card draws no Delete at all.
 */
export function planDroppable(plan: DispatcherPlan, planners: readonly DispatcherPlanner[]): boolean {
  if (plan.status === 'live') return false;
  if ((plan.phases ?? []).some((phase) => phase.busy)) return false;
  const subjects = plan.arc === null ? [plan.name] : [plan.name, plan.arc];
  return !planners.some((row) => row.state !== 'ended'
    && (subjects.includes(row.target) || subjects.includes(row.plan)));
}

/**
 * The plans in `lanePlans` that this plan still holds back, by name, in the order given: the ones
 * whose `waits_on` names it where that wait is not yet met. `rule.eligible` re-asks every wait on
 * every pass and passes a wait once the plan waited on is complete. So an edge holds anything only
 * while this plan is NOT complete and the waiter is not complete either. A drop deletes the edge with
 * the plan (`store_drop.drop_plan`), and exactly these waiters may then start sooner. A met wait's
 * edge goes too, but it releases nothing, so it is not listed. A self-wait is not listed either.
 */
export function planWaiters(plan: DispatcherPlan, lanePlans: readonly DispatcherPlan[]): string[] {
  if (plan.status === 'complete') return [];
  return lanePlans
    .filter((other) => other.name !== plan.name && other.status !== 'complete' && other.waits_on.includes(plan.name))
    .map((other) => other.name);
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

/** The first line of a text with anything on it, trimmed; empty for a null or blank text. */
function firstLineOf(text: string | null): string {
  return (text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/** A whole code span (its backtick fence, its contents, the same fence), else a bare `**`, `__` or stray backtick. */
const INLINE_MARK = /(`+)([\s\S]*?)\1|\*\*|__|`/g;

/**
 * The line a lane card leads with under its title: what the plan or arc DELIVERS, in its designer's
 * words, not the request it was opened with (operator, 2026-09-28: "can we put the feature/plan
 * description as the plan description instead of my words verbatim"). It is the first non-empty line
 * of `delivers` read as plain text: a code span keeps its contents and loses its fence, so a
 * `__init__.py` in one survives, while `**` and `__` outside one go; whitespace is collapsed.
 *
 * THE GOAL'S FIRST LINE STANDS IN, AS WRITTEN, only where `delivers` yields nothing: an arc's judgment
 * plan before its own design loads (it carries the arc's goal), or a first line of markers alone. A
 * plan being designed carries neither, so it draws no lead. Used by `PlanCard` and `DispatchArcDeck`.
 */
export function cardDescription(delivers: string | null, goal: string | null): string {
  const described = firstLineOf(delivers)
    .replace(INLINE_MARK, (_mark: string, _fence?: string, code?: string) => code ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return described || firstLineOf(goal);
}
