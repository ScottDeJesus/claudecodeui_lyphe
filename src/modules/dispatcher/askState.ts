import type { DispatcherAsk, DispatcherPlan } from '@/shared/types';

/**
 * The pure vocabulary of an open ask, in one file with no React in it — beside `dispatcherState.ts`,
 * and by the same rule: every function here is a total function of a document the server already
 * sent.
 *
 * AN ASK IS THE STORE'S OWN RECORD, NOT THIS APP'S. `DispatcherAsk` is what `hooks/dispatcher/ask.py`
 * holds and every `dispatcher_state` frame carries per plan; its `asked` event is what makes a prompt
 * one prompt across a restart. The readings below are the ones the card, the deck and the lane's bell
 * all take off that same record, so no two surfaces can disagree about which prompt they are drawing,
 * which answers it offers, or how it reads folded. The server's own name for an ask is `keyOf`, and
 * nothing here computes it.
 */

/** One answer a lock offers, exactly as `intent_lock.OPTIONS` states it: the label the operator's word is sent as, and the description that says what it does. Local to this file: only `lockOptions` hands these out, and nothing names the type. */
type LockOption = { label: string; description: string };

/**
 * The ask's identity on the client: its `asked` record as `<id>-<at>` — the store's own, and the
 * same on every plan one lock names. React keys, the deck's dedupe and the bell's memory read it.
 * The server's name for an ask is `keyOf`; this never computes it.
 *
 * Read by `PlanAsk` for its key, by `DispatchArcDeck` to draw one lock once across the plans it
 * names, and by the lane's bell (`DispatcherAskBell`) as the memory a new ask is heard against.
 */
export function askIdentity(ask: DispatcherAsk): string {
  return `${ask.asked.id}-${ask.asked.at}`;
}

/**
 * A lock's three answers by their contract position — Accept, Queue, Rework (`intent_lock.OPTIONS`)
 * — each `{ label, description }` verbatim.
 *
 * Read by `LockAnswer`, which draws one button per answer: the labels are what the operator presses
 * and what the answer is sent back as, and each description is that button's own `title`.
 */
export function lockOptions(ask: Extract<DispatcherAsk, { kind: 'accept' }>): { accept: LockOption; queue: LockOption; rework: LockOption } {
  return { accept: ask.options[0], queue: ask.options[1], rework: ask.options[2] };
}

/**
 * Whether this plan owes the operator a word — `asking` set. A frame from a server older than that
 * key carries NO `asking` at all, and a plan with none owes nothing: absent and `null` are ONE
 * reading here, the same one `planAsking` (`useDispatcherPlans.ts`) and the lane's bell take.
 *
 * AN OWED WORD IS THE MOST URGENT STATE A CARD CAN BE IN, above every status (`STATUS_ORDER`). Live
 * means the work is moving; queued and parked mean a press is available whenever he wants it; an ask
 * is the one state that is WAITING ON HIM and will not move until he answers — a plan holding one is
 * stuck exactly where the operator can free it. So this is the first key of both the lane's orders
 * (`byUrgencyThenNewest`, `byArc`) and of the widget's lift (`widgetItemsOf`), and a plan that owes a
 * word comes up whatever else it is: done, parked, or older than everything beside it.
 */
export function owesWord(plan: DispatcherPlan): boolean {
  return (plan.asking ?? null) !== null;
}

/**
 * Whether ANY plan of this set owes one — the same reading one level up, for an item that is a group
 * of plans rather than a plan: an arc's deck is asking when a plan of it is, because the deck is the
 * item the operator presses and the arc cannot move while one of its plans waits on him.
 */
export function anyOwesWord(plans: readonly DispatcherPlan[]): boolean {
  return plans.some(owesWord);
}

/**
 * Every distinct open ask across an arc's drawn plans, in the arc's order: the first plan carrying
 * one places it.
 *
 * Read by `DispatchArcDeck`: an arc's one lock names every plan of it still owing an Accept, so the
 * same ask arrives on several plans and must be drawn ONCE — on the deck, above the strip.
 */
export function arcAsks(plans: readonly DispatcherPlan[]): DispatcherAsk[] {
  const asks: DispatcherAsk[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    // The absent key owes nothing, exactly as `owesWord` reads it: a frame from an older server draws
    // a deck with no ask rather than throwing on `askIdentity(undefined)`.
    const ask = plan.asking ?? null;
    if (ask === null) continue;
    const identity = askIdentity(ask);
    if (seen.has(identity)) continue;
    seen.add(identity);
    asks.push(ask);
  }
  return asks;
}

/** The first line of a text with anything on it, trimmed; empty for a null or blank text. Kept here — three lines — so this file carries no value import, only the shared types. */
function firstLineOf(text: string | null): string {
  return (text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/**
 * The one line a folded card's bar reads: a lock's census line, or a round's first question's
 * first line.
 *
 * Read by `PlanAsk`'s folded bar, which shows it truncated to one line: it is the prompt's first
 * non-blank line, trimmed — for a lock, the census `dispatcher question` prints first, so the bar
 * says at a glance what the plan holds.
 */
export function askHeadline(ask: DispatcherAsk): string {
  if (ask.kind === 'accept') return firstLineOf(ask.question);
  return firstLineOf(ask.questions[0]?.text ?? null);
}
