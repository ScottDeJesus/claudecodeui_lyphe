import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { DispatcherVerb, RunnerModelChoice } from '@/shared/types';

/** The dispatcher's answer, as much of it as this hook reads. Both fields are free text it wrote. */
type VerbBody = { stdout?: unknown; stderr?: unknown };

/** The two doors a press can be relayed through: one v3 plan's, or one dispatch arc's. */
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

/** What a plan card may press. */
export type DispatcherPlanVerbs = {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  park(): Promise<void>;
  unpark(): Promise<void>;
  setModel(choice: RunnerModelChoice): Promise<void>;
  busy: DispatcherVerb | null;
};

/**
 * What an arc header may press — the four verbs the dispatcher's own arc door opens on. `park` and
 * `unpark` are the plan card's own and no arc header draws them, so no arc callback exists for them
 * rather than one that would have no route to reach.
 */
export type DispatcherArcVerbs = {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  setModel(choice: RunnerModelChoice): Promise<void>;
  busy: DispatcherVerb | null;
};

/**
 * Stop, Resume, Schedule, Park, Unpark and Model for one v3 plan — or Stop, Resume, Schedule and
 * Model for one dispatch ARC — and what to say about each.
 *
 * ONE HOOK, TWO DOORS, because the two are the same act on the same store through the same six verbs:
 * `scope` decides which route a press is relayed through (`POST /api/dispatcher/plans/:name/…` or
 * `POST /api/dispatcher/arcs/:name/…`) and how much of the surface it gets back, and nothing else.
 * The arc arm is what the header's four controls press, and it is deliberately the same `stop`,
 * `resume`, `schedule` and `model` a plan card presses: the dispatcher resolves an arc's name to the
 * PLAN verb applied to its plans in one step, so the card and the terminal say the same thing because
 * they say it with the same verb.
 *
 * NO CONFIRMATION DIALOG GUARDS STOP, for the run lane's reason: Stop is a PAUSE — a stopped plan
 * keeps its walk and `resume` picks it up — so the press is reversible by the button that replaces
 * it, and a dialog in front of a reversible act is what trains a reader to dismiss the one that is
 * not.
 *
 * THE DISPATCHER'S OWN SENTENCE IS THE ANSWER, ON BOTH PATHS. Unlike the runner, which refuses on
 * stderr, every dispatcher verb speaks on STDOUT — `UNSCHEDULED dispatcher-ready.v3` when it worked,
 * `REFUSED schedule dispatcher-ready.v3: is live — stop it first` when it did not — so `stdout` is
 * read FIRST and `stderr` only as the fallback. The lane carries that body whole on a 409 for the
 * same reason the run lane does: the dispatcher's refusal names the one rule the plan met, and a
 * generic "something went wrong" would throw away the only useful thing in the answer. 503 and 504
 * are the two cases where the dispatcher never spoke and the server's own sentence stands in; they
 * travel the same field and need no branch here.
 *
 * The toast is amber rather than red on a refusal: a refused verb denied nothing and destroyed
 * nothing (design doctrine :145).
 *
 * `resumeWord` IS THE WORD ON THE BUTTON THAT PRESSED IT, and a refusal answers in that word: a
 * queued or scheduled plan's button says Start, a stopped plan's says Resume, and a refusal headed
 * with the other would name a verb the operator never saw. It is `resume` that runs either way.
 *
 * NOTHING OPTIMISTIC: the control re-draws from the next `dispatcher_state` frame, which is the
 * store read back — the armed hour, the pause flag and the state word are the dispatcher's, never
 * this hook's.
 *
 * `model` IS THE ONE VERB HERE THAT TOUCHES NO WALK AND WAKES NOBODY. A plan's word is read when a
 * chain is LAUNCHED (`dispatcher/phase_chain.py:launch_env`), and an arc's is handed to every plan
 * of it in one transaction (`store.set_arc_model`), so a press takes the NEXT phase and never
 * disturbs one already out — which is also why the dispatcher never refuses it for the state a plan
 * or an arc is in, and why its answer is a sentence about the STORE (`MODEL <name>.v3 model=…`)
 * rather than about a walk.
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
  // two dispatcher processes at the same store.
  const [busy, setBusy] = useState<DispatcherVerb | null>(null);

  // A verb that resolves after the card is gone must not set state or raise a toast about a plan
  // nobody is looking at any more.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The word a toast is headed with when the dispatcher said nothing this hook can show. The two
  // park words are the card's own (`dispatcher.park` / `dispatcher.unpark`), so the button and the
  // toast that names it cannot drift.
  const word = useCallback(
    (verb: DispatcherVerb): string => {
      if (verb === 'stop') return t('runner.stop');
      if (verb === 'park') return t('dispatcher.park');
      if (verb === 'unpark') return t('dispatcher.unpark');
      if (verb === 'schedule') return t('runner.schedule.refused');
      if (verb === 'model') return t('runner.model.refused');
      return resumeWord ?? t('runner.resume');
    },
    [resumeWord, t],
  );

  /**
   * The word a SUCCESS is headed with when the dispatcher's body arrived empty. Every verb but
   * `model` is headed by its own name either way (`Stop`, `Resume`, `Park`); a model press that
   * worked is not headed "Model not set", which is what its refusal word says.
   */
  const doneWord = useCallback(
    (verb: DispatcherVerb): string =>
      verb === 'model' ? t('runner.toast.model') : word(verb),
    [t, word],
  );

  /**
   * Relay one press. `call` is the whole of what `scope` decides — which door of the API this verb
   * goes through — written at each callback below rather than in a table, so the route a given
   * button presses is readable at the button.
   */
  const send = useCallback(
    async (verb: DispatcherVerb, call: () => Promise<Response>): Promise<void> => {
      if (!mountedRef.current) return;
      setBusy(verb);

      try {
        const response = await call();
        const body = await readBody(response);
        if (!mountedRef.current) return;

        // Read before the status, because a 409 carries the very same shape — and because the
        // dispatcher's successes are sentences too (`PARKED dispatcher-ready.v3`), not empty bodies.
        const said = firstLine(body?.stdout) || firstLine(body?.stderr);

        if (response.ok) {
          // The dispatcher's own sentence IS the answer, and every one of its verbs answers with one
          // (`MODEL <name>.v3 model=claude`, `RESUMED dr-arc.arc — 2 plan(s)`). `doneWord` is the
          // fallback for a dispatcher build that answered with an empty body.
          toast({ tone: 'positive', title: said || doneWord(verb) });
          return;
        }

        toast({ tone: 'warn', title: word(verb), message: said || t('messages.operationFailed') });
      } catch (error) {
        // The request never completed — the API is down, or the deadline passed. That is the
        // network's word, not the dispatcher's, and it is said as such.
        console.warn(`[useDispatcherVerbs] the ${verb} request did not complete:`, error);
        if (mountedRef.current) toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [doneWord, t, toast, word],
  );

  const stop = useCallback(
    () => send('stop', () => (scope === 'arc' ? api.dispatcher.arcStop(name) : api.dispatcher.stop(name))),
    [name, scope, send],
  );
  const resume = useCallback(
    () => send('resume', () => (scope === 'arc' ? api.dispatcher.arcResume(name) : api.dispatcher.resume(name))),
    [name, scope, send],
  );
  const schedule = useCallback(
    (when: string) => send('schedule', () => (scope === 'arc'
      ? api.dispatcher.arcSchedule(name, when)
      : api.dispatcher.schedule(name, when))),
    [name, scope, send],
  );
  const setModel = useCallback(
    (choice: RunnerModelChoice) => send('model', () => (scope === 'arc'
      ? api.dispatcher.arcModel(name, choice)
      : api.dispatcher.model(name, choice))),
    [name, scope, send],
  );

  // The plan card's own two, which no arc header draws and no arc route exists for.
  const park = useCallback(() => send('park', () => api.dispatcher.park(name)), [name, send]);
  const unpark = useCallback(() => send('unpark', () => api.dispatcher.unpark(name)), [name, send]);

  if (scope === 'arc') return { stop, resume, schedule, setModel, busy };
  return { stop, resume, schedule, park, unpark, setModel, busy };
}
