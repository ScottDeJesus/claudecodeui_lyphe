import type { DispatcherPlan, DispatcherStateEvent } from '@/shared/types.js';

/**
 * The raise: a plan that lands owing the OPERATOR's word has its ask recorded and its prompt put up —
 * on the plan's card in the Runner tab and in the Runner widget, and on his phone.
 *
 * WHAT IT IS FOR. A plan's Accept prompt, or its designer's questions, is the operator's to answer —
 * and on 2026-09-28 one sat in `questions` until he asked for it himself ("I didnt get that
 * question until i asked"). So the moment a landing owes his word, this lane asks the dispatcher to
 * record the ask (`dispatcher ask <plan>`, `hooks/dispatcher/ask.py`), and the card draws it at once
 * off the frame — the verb prints the ask it recorded, which every later picture's `asking` key
 * carries too (`dispatcher-asks.service.ts`): the SAME `permission.required` push an `AskUserQuestion`
 * gets, and a card and a phone that need no chat — the chat the plan names may be idle, mid-reply or
 * closed, and the prompt stands. No model is involved in asking, no turn is spent, and nothing is
 * written into the transcript in his name. The ask is recorded in the STORE — `prompted_at` and an
 * `asked` event — so the Stop hold stands down for it (`owed.kind`), and a restart finds it again.
 *
 * ONE MARK PER PLAN, durable across handovers. The store's `events` ids come from one global sequence
 * (`hooks/dispatcher/report.py`), so a mark is a plan's own newest ANSWERED landing id. The endings'
 * single watermark cannot carry this: a landing that cannot be answered yet has to stay DUE while the
 * plans around it are marked, and one number cannot say "everything handled except that one" —
 * anything held behind a global mark is swallowed by the next plan's advance.
 *
 * A LANDING STAYS DUE — and the next picture asks again — in TWO cases:
 *
 * - The writer is still OUT. `store.live_for` refuses what a plan owes while an outing is live, so the
 *   empty answer read now is not the answer that arrives when it ends — and the debt that appears then
 *   has NO event of its own. Every landing the store had written when this was measured had that shape
 *   (16/16: the designer or the cutter loads the file while its own row is live, 10–826 s before it
 *   ends). The picture already carries the outings (`planners`), so this needs no new reading.
 * - The dispatcher did not answer at all. That is not an answer.
 *
 * Every other answer marks the landing: the ask was recorded; nothing is owed; or the debt is one this
 * lane cannot raise — a plan no Eupalinos designed — which is logged once and left where it was.
 *
 * THE MARK IS READ AGAIN JUST BEFORE IT IS WRITTEN, for the reason `dispatcher-endings.service.ts`
 * states: a dev-server handover runs two servers over one store, and an id at or below what the other
 * one stored is left alone rather than written back over a newer mark. The two can both raise one
 * landing, which costs nothing: the dispatcher checks and records an ask in ONE write transaction
 * (`ask.raise_owed`), so the second ask waits on the first, finds the plan asked, and hears `nothing`.
 */

/**
 * What became of one raise: the ask recorded (`raised`), nothing owed right now (`nothing`), or a
 * debt this lane cannot raise and the Stop hold keeps (`refused`, in the dispatcher's own word).
 */
export type RaiseOutcome = 'raised' | 'nothing' | 'refused';

export type DispatcherRaiseDependencies = {
  /** Every plan's mark — the highest landing id already answered for it — or `null` when this database has never raised through the store. */
  readMarks: () => ReadonlyMap<string, number> | null;
  /** Writes the marks back whole: the durable copy is the caller's, and this file keeps no state of its own. */
  writeMarks: (marks: ReadonlyMap<string, number>) => void;
  /** Records `plan`'s owed ask and puts its prompt up, or says why not; THROWS when the dispatcher did not answer. */
  raise: (plan: DispatcherPlan) => Promise<RaiseOutcome>;
  /** Injected by the composition root — this server has no logger (see `polled-lane.service.ts`). */
  log: (message: string) => void;
};

/** The lane's own picture, as `broadcast` hands it over: the plans, and the outings that stand for them. */
export type DispatcherRaisePicture = Pick<DispatcherStateEvent, 'plans' | 'planners'>;

/** The two events a landing is, and the only two that can raise an operator-owed prompt. */
const LANDING_KINDS = new Set(['design-loaded', 'phases-loaded']);

// Used by `dispatcher.module.ts`, which hands it every picture the lane broadcasts.
export function createDispatcherRaiser(dependencies: DispatcherRaiseDependencies): { observe(picture: DispatcherRaisePicture): void } {
  /** A pass in flight, and the newest picture that arrived under it. */
  let running = false;
  let pending: DispatcherRaisePicture | null = null;

  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  /**
   * Whether the work is still OUT for this plan — the rows `store.live_for` refuses what a plan owes
   * over, read off the picture's own outing list: a row that is not `ended`, scoped to the plan or to
   * the arc it belongs to (`report_planners._scope`, the same two names `live_for` asks for). Read
   * from the frame's list rather than the plan's own `planner` field on purpose: that field prefers a
   * plan's OWN row, so a plan whose own cut died short reports an ending even while its arc's re-cut
   * is out — and the plan owes nothing while that row is live.
   */
  const liveOuting = (picture: DispatcherRaisePicture, plan: DispatcherPlan): boolean => {
    const names = plan.arc === null || plan.arc === plan.name ? [plan.name] : [plan.name, plan.arc];
    return picture.planners.some((outing) => outing.state !== 'ended'
      && (names.includes(outing.target) || names.includes(outing.plan)));
  };

  /** The plan's newest landing, or 0 — the id its mark is set at when its log is declared history. */
  const newestLanding = (plan: DispatcherPlan): number => {
    let newest = 0;
    for (const event of plan.events) {
      if (LANDING_KINDS.has(event.kind) && event.id > newest) newest = event.id;
    }
    return newest;
  };

  /**
   * Every plan with a landing past ITS mark, with its newest such landing — oldest id first. One
   * entry per plan: what a plan owes is read off its CURRENT state, so two landings past its mark are
   * one question about that plan, and the mark advances past both at once.
   */
  const landings = (plans: DispatcherPlan[], marks: ReadonlyMap<string, number>): Array<[DispatcherPlan, number]> => {
    const due = new Map<DispatcherPlan, number>();
    for (const plan of plans) {
      const mark = marks.get(plan.name) ?? 0;
      for (const event of plan.events) {
        if (!LANDING_KINDS.has(event.kind) || event.id <= mark) continue;
        if (event.id > (due.get(plan) ?? 0)) due.set(plan, event.id);
      }
    }
    return [...due.entries()].sort((left, right) => left[1] - right[1]);
  };

  /**
   * One raise, or `null` when the dispatcher did not answer — which is not an answer, so the caller
   * leaves the landing due. `nothing` while the writer is still out is the other answer that is still
   * coming: it is read as `null` too.
   */
  const raiseFor = async (picture: DispatcherRaisePicture, plan: DispatcherPlan): Promise<RaiseOutcome | null> => {
    let outcome: RaiseOutcome;
    try {
      outcome = await dependencies.raise(plan);
    } catch (error) {
      dependencies.log(`[Dispatcher] could not raise what ${plan.name} owes: ${messageOf(error)}`);
      return null;
    }
    return outcome === 'nothing' && liveOuting(picture, plan) ? null : outcome;
  };

  /** Records one landing as answered, re-reading first so a newer id from a handover is never written back over. */
  const markHandled = (plan: string, eventId: number): void => {
    const marks = new Map(dependencies.readMarks() ?? []);
    if (eventId <= (marks.get(plan) ?? 0)) return;
    marks.set(plan, eventId);
    dependencies.writeMarks(marks);
  };

  /**
   * The first sight of a store this database has never raised through.
   *
   * The events already in the log are HISTORY, as they are for the endings — with ONE exception, and
   * it is the operator who pays for it: a plan that owes his word RIGHT NOW has never been asked, and
   * no landing of its will come again to raise it. So every plan that may owe a prompt is raised once
   * — a `questions` plan, and a `loaded` one whose Accept prompt was never asked (a superset: the
   * dispatcher's `ask` is what decides) — and every plan is then marked at its own newest landing,
   * leaving everything written after this moment due. A plan whose answer is still coming is left off
   * the map, the pass's own rule. The marks are written AFTER the raises: a crash mid-bootstrap costs
   * a repeated `ask`, which the store answers with `nothing`.
   */
  const bootstrap = async (picture: DispatcherRaisePicture): Promise<void> => {
    const marks = new Map<string, number>();
    for (const plan of picture.plans) {
      const landing = newestLanding(plan);
      if (landing === 0) continue;
      const mayOwe = plan.state === 'questions' || (plan.state === 'loaded' && plan.prompted_at === null);
      if (mayOwe && (await raiseFor(picture, plan)) === null) continue;
      marks.set(plan.name, landing);
    }
    dependencies.writeMarks(marks);
  };

  const pass = async (picture: DispatcherRaisePicture): Promise<void> => {
    const marks = dependencies.readMarks();
    if (marks === null) return bootstrap(picture);
    for (const [plan, eventId] of landings(picture.plans, marks)) {
      if ((await raiseFor(picture, plan)) === null) continue;
      markHandled(plan.name, eventId);
    }
  };

  /**
   * One picture, handled off the poll's own beat: the pass is a subprocess per due landing, so it runs
   * on a promise and the frame goes out without waiting for it. A picture arriving under a pass in
   * flight REPLACES the one waiting — the newest picture carries every landing the older one did — so
   * a busy server never queues a backlog of passes.
   */
  const observe = (picture: DispatcherRaisePicture): void => {
    if (running) {
      pending = picture;
      return;
    }
    running = true;
    void pass(picture)
      .catch((error) => dependencies.log(`[Dispatcher] could not raise a plan's prompt: ${messageOf(error)}`))
      .finally(() => {
        running = false;
        const next = pending;
        pending = null;
        if (next) observe(next);
      });
  };

  return { observe };
}
