import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { alreadyArmed, useArmAcceptVerbs, type ArmAcceptArcVerbs, type ArmAcceptPlanVerbs } from '@/modules/dispatcher/hooks/useArmAcceptVerbs';
import { useVerbSend } from '@/modules/dispatcher/hooks/useVerbSend';
import { api } from '@/shared/api';
import type { DispatcherAsk, DispatcherModelChoice, DispatcherVerb, DispatcherWipChoice, DispatcherWipLimit } from '@/shared/types';

/** The two doors a press can be relayed through: one plan's, or one dispatch arc's. */
export type DispatcherVerbScope = 'plan' | 'arc';

/**
 * The verb a press is relaying: the dispatcher's own verbs, plus the card's `answer`. The answer is
 * a door of its own (`POST /api/dispatcher/answer`, never one of the verb routes), and the union
 * stays LOCAL to this hook — `DispatcherVerb` remains exactly the set the server spawns, so no
 * route or service is ever read against a word the dispatcher's binary does not know.
 */
type DispatcherPress = DispatcherVerb | 'answer';

/** What a plan card may press. */
export type DispatcherPlanVerbs = ArmAcceptPlanVerbs & {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  park(): Promise<void>;
  unpark(): Promise<void>;
  drop(): Promise<void>;
  /** The plan's stalled planner outing put back to work — the dispatcher picks the door (`cut`, `judge`, or a `tell` of `continue`). */
  plannerResume(): Promise<void>;
  setModel(choice: DispatcherModelChoice): Promise<void>;
  /**
   * The operator's word on the prompt this plan's card is drawing: the chosen label (or typed
   * words) by question, and a Rework's notes by question. The one press here that REPORTS BACK —
   * `true` exactly when the lane took it (2xx) — because the card draws its answered state from it.
   */
  answer(ask: DispatcherAsk, answers: Record<string, string>, notes?: Record<string, string>): Promise<boolean>;
  busy: DispatcherPress | null;
};

/**
 * What an arc header may press — the four verbs the dispatcher's own arc door opens on, and the
 * epic's own `wip`. `park`, `unpark` and `drop` are the plan card's own and no arc header draws them,
 * so no arc callback exists for them rather than one that would have no route to reach.
 */
export type DispatcherArcVerbs = ArmAcceptArcVerbs & {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  setModel(choice: DispatcherModelChoice): Promise<void>;
  /** One of the epic's two WIP limits set to a count, `all`, or `default` (follow Settings again). */
  setWip(limit: DispatcherWipLimit, choice: DispatcherWipChoice): Promise<void>;
  busy: DispatcherPress | null;
};

/**
 * Stop, Resume, Schedule, Park, Unpark, Model, Drop, Resume planner and Answer for one plan — or Stop, Resume,
 * Schedule, Model and WIP for one dispatch ARC — and what to say about each.
 *
 * ONE HOOK, TWO DOORS, because the two are the same act on the same store through the same verbs:
 * `scope` decides which route a press is relayed through (`POST /api/dispatcher/plans/:name/…` or
 * `POST /api/dispatcher/arcs/:name/…`) and how much of the surface it gets back, and nothing else.
 * The arc arm is what the header's controls press, and its first four are deliberately the same `stop`,
 * `resume`, `schedule` and `model` a plan card presses: the dispatcher resolves an arc's name to the
 * PLAN verb applied to its plans in one step, so the card and the terminal say the same thing because
 * they say it with the same verb.
 *
 * NO CONFIRMATION DIALOG GUARDS STOP: Stop is a PAUSE — a stopped plan
 * keeps its walk and `resume` picks it up — so the press is reversible by the button that replaces
 * it, and a dialog in front of a reversible act is what trains a reader to dismiss the one that is
 * not. `drop` IS that one: it takes the plan and everything the store holds of it, no press undoes
 * it, and so it is the one verb a card guards with a dialog — the card's (`DeletePlanDialog`), not
 * this hook's, which relays the press it is handed like any other.
 *
 * THE DISPATCHER'S OWN SENTENCE IS THE ANSWER, ON BOTH PATHS, AND THE TOAST SHOWS IT IN THE OPERATOR'S
 * WORDS (`operatorWords`). Every dispatcher verb speaks on STDOUT — `UNSCHEDULED dispatcher-ready` when
 * it worked, `REFUSED schedule dispatcher-ready: is live — stop it first` when it did not — so `stdout`
 * is read FIRST and `stderr` only as the fallback. The lane carries that body whole on a 409: the
 * dispatcher's refusal names the one rule the plan met, and a generic "something went wrong" would
 * throw away the only useful thing in the answer. 503 and 504 are the two cases where the dispatcher
 * never spoke and the server's own sentence stands in; they travel the same field and need no branch here.
 *
 * The toast is amber rather than red on a refusal: a refused verb denied nothing and destroyed
 * nothing (design doctrine :145). The relay itself — the busy flag, the toast, the refusal's wording — is
 * `useVerbSend`'s, shared with the board's own presses (`useEpicDialVerbs`, `useEpicQueueVerbs`), which
 * name no plan and no arc of their own.
 *
 * `resumeWord` IS THE WORD ON THE BUTTON THAT PRESSED IT, and a refusal answers in that word: a
 * queued or scheduled plan's button says Start, a stopped plan's says Resume, and a refusal headed
 * with the other would name a verb the operator never saw. It is `resume` that runs either way.
 *
 * ANSWER IS THE ONE PRESS THAT REPORTS BACK, and the only one whose outcome a control reads: the
 * card draws its answered state from a `true`, so `send` resolves whether the lane took the word
 * (2xx) and the others resolve `void`, their outcome nobody's but the next frame's. It travels
 * the plan door alone (`POST /api/dispatcher/answer`, never one of the verb routes) and is not a
 * `DispatcherVerb` — that set is exactly what the server spawns.
 *
 * NOTHING OPTIMISTIC: the control re-draws from the next `dispatcher_state` frame, which is the
 * store read back — the armed hour, the pause flag and the state word are the dispatcher's, never
 * this hook's.
 *
 * `model` IS THE ONE VERB HERE THAT TOUCHES NO WALK AND WAKES NOBODY. A plan's word is read when a
 * chain is LAUNCHED (`dispatcher/phase_chain.py:launch_env`), and an arc's is handed to every plan
 * of it in one transaction (`store.set_arc_model`), so a press takes the NEXT phase and never
 * disturbs one already out — which is also why the dispatcher never refuses it for the state a plan
 * or an arc is in, and why its answer is a sentence about the STORE (`MODEL <name> model=…`)
 * rather than about a walk. `wip` is its sibling on the arc alone (`WIP arc=<name> features=…`): it too
 * moves no walk, and the dispatcher kicks its own daemon when the word changed, since a wider limit can
 * free a feature the old one held.
 */
export function useDispatcherVerbs(name: string, scope?: 'plan', resumeWord?: string): DispatcherPlanVerbs;
export function useDispatcherVerbs(name: string, scope: 'arc', resumeWord?: string): DispatcherArcVerbs;
export function useDispatcherVerbs(
  name: string,
  scope: DispatcherVerbScope = 'plan',
  resumeWord?: string,
): DispatcherPlanVerbs | DispatcherArcVerbs {
  const { t } = useTranslation();

  // The word a toast is headed with when the dispatcher said nothing this hook can show. The two
  // park words and the delete word are the card's own (`dispatcher.park` / `dispatcher.unpark` /
  // `dispatcher.delete.word`), so the button and the toast that names it cannot drift.
  const word = useCallback(
    (verb: DispatcherPress): string => {
      if (verb === 'stop') return t('runner.stop');
      if (verb === 'park') return t('dispatcher.park');
      if (verb === 'unpark') return t('dispatcher.unpark');
      if (verb === 'drop') return t('dispatcher.delete.word');
      if (verb === 'planner-resume') return t('dispatcher.plannerResume');
      if (verb === 'schedule') return t('runner.schedule.refused');
      if (verb === 'model') return t('runner.model.refused');
      if (verb === 'wip') return t('dispatcher.wip.refused');
      if (verb === 'answer') return t('dispatcher.ask.word');
      if (verb === 'arm-accept' || verb === 'disarm-accept') return t('dispatcher.acceptWhenCutRefused');
      return resumeWord ?? t('runner.resume');
    },
    [resumeWord, t],
  );

  /**
   * The word a SUCCESS is headed with when the dispatcher's body arrived empty. Every verb but
   * `model`, `wip` and `answer` is headed by its own name either way (`Stop`, `Resume`, `Park`);
   * a word press that worked is not headed "Model not set", which is what its refusal word says.
   */
  const doneWord = useCallback(
    (verb: DispatcherPress): string => {
      if (verb === 'model') return t('runner.toast.model');
      if (verb === 'wip') return t('dispatcher.wip.done');
      if (verb === 'answer') return t('dispatcher.ask.word');
      return word(verb);
    },
    [t, word],
  );

  // The one relay every press goes through (`useVerbSend`): the busy flag that refuses a second press while
  // one is out — these verbs arm and disarm systemd timers and move the plan's state, and a double press
  // would race two dispatcher processes at the same store; the answer rides the same flag, its form
  // disables while `answer` is out, so the card cannot carry one word twice — and the toast. `drop` alone
  // still speaks after its card is gone: its card leaving IS what a drop that worked does, and the
  // 2-second poll can deliver that frame before the answer arrives.
  const { busy, send } = useVerbSend<DispatcherPress>({
    keep: [name],
    titles: { refused: word, done: doneWord },
    alreadyDone: alreadyArmed,
    speaksAfterUnmount: ['drop'],
  });

  // The verbs are one-way presses: each awaits `send` and returns `void`, because nothing
  // reads their outcome — the card redraws from the next frame. `answer`, below, is the one that
  // hands the boolean back.
  const stop = useCallback(
    async () => {
      await send('stop', () => (scope === 'arc' ? api.dispatcher.arcStop(name) : api.dispatcher.stop(name)));
    },
    [name, scope, send],
  );
  const resume = useCallback(
    async () => {
      await send('resume', () => (scope === 'arc' ? api.dispatcher.arcResume(name) : api.dispatcher.resume(name)));
    },
    [name, scope, send],
  );
  const schedule = useCallback(
    async (when: string) => {
      await send('schedule', () => (scope === 'arc'
        ? api.dispatcher.arcSchedule(name, when)
        : api.dispatcher.schedule(name, when)));
    },
    [name, scope, send],
  );
  const setModel = useCallback(
    async (choice: DispatcherModelChoice) => {
      await send('model', () => (scope === 'arc'
        ? api.dispatcher.arcModel(name, choice)
        : api.dispatcher.model(name, choice)));
    },
    [name, scope, send],
  );

  // The epic's own press: one of its two WIP limits. No plan route exists for it, so a plan card has none.
  const setWip = useCallback(
    async (limit: DispatcherWipLimit, choice: DispatcherWipChoice) => {
      await send('wip', () => api.dispatcher.arcWip(name, limit, choice));
    },
    [name, send],
  );

  // The plan card's own five, which no arc header draws and no arc route exists for.
  const park = useCallback(async () => { await send('park', () => api.dispatcher.park(name)); }, [name, send]);
  const unpark = useCallback(async () => { await send('unpark', () => api.dispatcher.unpark(name)); }, [name, send]);
  const drop = useCallback(async () => { await send('drop', () => api.dispatcher.drop(name)); }, [name, send]);
  const plannerResume = useCallback(
    async () => { await send('planner-resume', () => api.dispatcher.plannerResume(name)); },
    [name, send],
  );

  // The card's own press: the operator's word on the prompt it is drawing, relayed to the lane's
  // answer door rather than a verb route — and handed on, because the card draws its answered
  // state from it.
  const answer = useCallback(
    (ask: DispatcherAsk, answers: Record<string, string>, notes?: Record<string, string>) =>
      send('answer', () => api.dispatcher.answer(ask, answers, notes)),
    [send],
  );

  // "Accept when cut" and its Cancel: this hook's `send` carries them (`useArmAcceptVerbs`), both doors.
  const armVerbs = useArmAcceptVerbs(name, scope, send);

  if (scope === 'arc') return { stop, resume, schedule, setModel, setWip, ...armVerbs, busy };
  return { stop, resume, schedule, park, unpark, drop, plannerResume, setModel, answer, ...armVerbs, busy };
}
