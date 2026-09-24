import type { DispatcherPhase, DispatcherPlan, DispatcherPlanStatus, Tone } from '@/shared/types';

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
