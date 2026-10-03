import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { operatorWords } from '@/modules/dispatcher/operatorWords';
import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { DispatcherAsk, DispatcherModelChoice, DispatcherSwarmChoice, DispatcherVerb } from '@/shared/types';

/** The dispatcher's answer, as much of it as this hook reads. Both fields are free text it wrote. */
type VerbBody = { stdout?: unknown; stderr?: unknown };

/** The two doors a press can be relayed through: one plan's, or one dispatch arc's. */
export type DispatcherVerbScope = 'plan' | 'arc';

/**
 * The dispatcher's own first sentence, or nothing. Blank lines are stepped over rather than
 * returned: a refusal that began with a newline would otherwise raise an empty toast.
 */
function firstLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/** A verdict is the dispatcher's own body, so it is read BEFORE the status is judged — a 409 carries it too. */
async function readBody(response: Response): Promise<VerbBody | null> {
  try {
    return (await response.json()) as VerbBody;
  } catch {
    return null;
  }
}

/**
 * The verb a press is relaying: the dispatcher's own nine, plus the card's `answer`. The answer is
 * a door of its own (`POST /api/dispatcher/answer`, never one of the verb routes), and the union
 * stays LOCAL to this hook — `DispatcherVerb` remains exactly the set the server spawns, so no
 * route or service is ever read against a word the dispatcher's binary does not know.
 */
type DispatcherPress = DispatcherVerb | 'answer';

/** What a plan card may press. */
export type DispatcherPlanVerbs = {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  park(): Promise<void>;
  unpark(): Promise<void>;
  drop(): Promise<void>;
  /** The plan's stalled planner outing put back to work — the dispatcher picks the door (`cut`, `judge`, or a `tell` of `continue`). */
  plannerResume(): Promise<void>;
  setModel(choice: DispatcherModelChoice): Promise<void>;
  setSwarm(choice: DispatcherSwarmChoice): Promise<void>;
  /**
   * The operator's word on the prompt this plan's card is drawing: the chosen label (or typed
   * words) by question, and a Rework's notes by question. The one press here that REPORTS BACK —
   * `true` exactly when the lane took it (2xx) — because the card draws its answered state from it.
   */
  answer(ask: DispatcherAsk, answers: Record<string, string>, notes?: Record<string, string>): Promise<boolean>;
  busy: DispatcherPress | null;
};

/**
 * What an arc header may press — the four verbs the dispatcher's own arc door opens on. `park`,
 * `unpark`, `drop` and `swarm` are the plan card's own and no arc header draws them, so no arc
 * callback exists for them rather than one that would have no route to reach.
 */
export type DispatcherArcVerbs = {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  setModel(choice: DispatcherModelChoice): Promise<void>;
  busy: DispatcherPress | null;
};

/**
 * Stop, Resume, Schedule, Park, Unpark, Model, Swarm, Drop, Resume planner and Answer for one plan — or Stop, Resume,
 * Schedule and Model for one dispatch ARC — and what to say about each.
 *
 * ONE HOOK, TWO DOORS, because the two are the same act on the same store through the same verbs:
 * `scope` decides which route a press is relayed through (`POST /api/dispatcher/plans/:name/…` or
 * `POST /api/dispatcher/arcs/:name/…`) and how much of the surface it gets back, and nothing else.
 * The arc arm is what the header's four controls press, and it is deliberately the same `stop`,
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
 * nothing (design doctrine :145).
 *
 * `resumeWord` IS THE WORD ON THE BUTTON THAT PRESSED IT, and a refusal answers in that word: a
 * queued or scheduled plan's button says Start, a stopped plan's says Resume, and a refusal headed
 * with the other would name a verb the operator never saw. It is `resume` that runs either way.
 *
 * ANSWER IS THE ONE PRESS THAT REPORTS BACK, and the only one whose outcome a control reads: the
 * card draws its answered state from a `true`, so `send` resolves whether the lane took the word
 * (2xx) and the other nine resolve `void`, their outcome nobody's but the next frame's. It travels
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
 * rather than about a walk. `swarm` is its sibling on the plan card alone (`SWARM <name> swarm=…`):
 * it too moves no walk, and the dispatcher kicks its own daemon when the word changed, since a wider
 * word can free a phase the old one held.
 */
export function useDispatcherVerbs(name: string, scope?: 'plan', resumeWord?: string): DispatcherPlanVerbs;
export function useDispatcherVerbs(name: string, scope: 'arc', resumeWord?: string): DispatcherArcVerbs;
export function useDispatcherVerbs(
  name: string,
  scope: DispatcherVerbScope = 'plan',
  resumeWord?: string,
): DispatcherPlanVerbs | DispatcherArcVerbs {
  const { t } = useTranslation();
  const toast = useToast();

  // The verb in flight, so every control refuses a second press while one is out. Essential: these
  // verbs arm and disarm systemd timers and move the plan's state, and a double-press would race
  // two dispatcher processes at the same store. The answer rides the same flag — its form disables
  // while `answer` is out — so the card cannot carry one word twice.
  const [busy, setBusy] = useState<DispatcherPress | null>(null);

  // A verb that resolves after the card is gone must not set state or raise a toast about a plan
  // nobody is looking at any more. `drop` alone still speaks (`speaks`): its card leaving IS what a
  // drop that worked does, and the 2-second poll can deliver that frame before the answer arrives.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      if (verb === 'swarm') return t('dispatcher.swarm.refused');
      if (verb === 'answer') return t('dispatcher.ask.word');
      return resumeWord ?? t('runner.resume');
    },
    [resumeWord, t],
  );

  /**
   * The word a SUCCESS is headed with when the dispatcher's body arrived empty. Every verb but
   * `model`, `swarm` and `answer` is headed by its own name either way (`Stop`, `Resume`, `Park`);
   * a word press that worked is not headed "Model not set", which is what its refusal word says.
   */
  const doneWord = useCallback(
    (verb: DispatcherPress): string => {
      if (verb === 'model') return t('runner.toast.model');
      if (verb === 'swarm') return t('dispatcher.swarm.done');
      if (verb === 'answer') return t('dispatcher.ask.word');
      return word(verb);
    },
    [t, word],
  );

  /**
   * Relay one press. `call` is the whole of what `scope` decides — which door of the API this verb
   * goes through — written at each callback below rather than in a table, so the route a given
   * button presses is readable at the button.
   *
   * It resolves `true` exactly when the response was 2xx and `false` on a refusal or a request that
   * never completed. Only `answer` hands that back (its card draws its answered state from it); the
   * nine verbs discard it at their callbacks — the toast above is what a human reads.
   */
  const send = useCallback(
    async (verb: DispatcherPress, call: () => Promise<Response>): Promise<boolean> => {
      if (!mountedRef.current) return false;
      setBusy(verb);
      const speaks = () => mountedRef.current || verb === 'drop';

      try {
        const response = await call();
        const body = await readBody(response);
        if (!speaks()) return response.ok;

        // Read before the status, because a 409 carries the very same shape — and because the
        // dispatcher's successes are sentences too (`PARKED dispatcher-ready`), not empty bodies.
        const said = operatorWords(firstLine(body?.stdout) || firstLine(body?.stderr), [name]);

        if (response.ok) {
          // The dispatcher's own sentence IS the answer, and every one of its verbs answers with one, shown in
          // the operator's words: `RESUMED dr-arc.arc — 2 plan(s)` is its stdout, the toast reads
          // `RESUMED dr-arc — 2 feature(s)`. `doneWord` is the fallback for an empty body.
          toast({ tone: 'positive', title: said || doneWord(verb) });
          return true;
        }

        toast({ tone: 'warn', title: word(verb), message: said || t('messages.operationFailed') });
        return false;
      } catch (error) {
        // The request never completed — the API is down, or the deadline passed. That is the
        // network's word, not the dispatcher's, and it is said as such.
        console.warn(`[useDispatcherVerbs] the ${verb} request did not complete:`, error);
        if (speaks()) toast({ tone: 'warn', title: t('messages.networkError') });
        return false;
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [doneWord, name, t, toast, word],
  );

  // The nine verbs are one-way presses: each awaits `send` and returns `void`, because nothing
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

  // The plan card's own five, which no arc header draws and no arc route exists for.
  const park = useCallback(async () => { await send('park', () => api.dispatcher.park(name)); }, [name, send]);
  const unpark = useCallback(async () => { await send('unpark', () => api.dispatcher.unpark(name)); }, [name, send]);
  const drop = useCallback(async () => { await send('drop', () => api.dispatcher.drop(name)); }, [name, send]);
  const plannerResume = useCallback(
    async () => { await send('planner-resume', () => api.dispatcher.plannerResume(name)); },
    [name, send],
  );
  const setSwarm = useCallback(
    async (choice: DispatcherSwarmChoice) => {
      await send('swarm', () => api.dispatcher.swarm(name, choice));
    },
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

  if (scope === 'arc') return { stop, resume, schedule, setModel, busy };
  return { stop, resume, schedule, park, unpark, drop, plannerResume, setModel, setSwarm, answer, busy };
}
