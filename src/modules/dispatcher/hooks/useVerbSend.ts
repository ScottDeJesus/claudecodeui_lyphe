import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { operatorWords } from '@/modules/dispatcher/operatorWords';
import { useToast } from '@/shared/context/ToastContext';
import { firstLine } from '@/shared/utils';

/** The dispatcher's answer, as much of it as a press reads. Both text fields are free text it wrote. */
type VerbBody = { stdout?: unknown; stderr?: unknown; exit?: unknown };

/** A verdict is the dispatcher's own body, so it is read BEFORE the status is judged — a 409 carries it too. */
async function readBody(response: Response): Promise<VerbBody | null> {
  try {
    return (await response.json()) as VerbBody;
  } catch {
    return null;
  }
}

/** What a caller of {@link useVerbSend} says about its own verbs. Read when a press STARTS, so a toast names what was pressed — a word that changes while the request is out never re-heads it — and a caller may hand a fresh object on every render. */
type VerbSendOptions<Verb extends string> = {
  /** The names every sentence of this caller is about — a feature literally called `plan` — which `operatorWords` never reads as the word. */
  keep: readonly string[];
  /** What a toast is headed with when the dispatcher said nothing it can show: `refused` over a refusal, `done` over a success whose body arrived empty. */
  titles: { refused(verb: Verb): string; done(verb: Verb): string };
  /** Is this refusal an answer that arrived second — the state asked for? Then the toast is calm, not a warning. */
  alreadyDone?(verb: Verb, body: VerbBody | null): boolean;
  /** Verbs whose sentence is still spoken once the caller has left the screen: a `drop` whose card leaving IS what a drop that worked does. */
  speaksAfterUnmount?: readonly Verb[];
};

/** What {@link useVerbSend} hands back: the verb in flight, and the one way to relay a press. */
type VerbSend<Verb extends string> = {
  busy: Verb | null;
  send(verb: Verb, call: () => Promise<Response>, keep?: readonly string[]): Promise<boolean>;
};

/**
 * Relay one press to the dispatcher and say what it answered — the one path every press of the lane takes:
 * the plan card's and the arc deck's verbs (`useDispatcherVerbs`), the epic dial (`useEpicDialVerbs`) and the
 * queue's moves (`useEpicQueueVerbs`). `call` is the whole of what differs between presses — which door of
 * the API this verb goes through — written at each press so the route a button presses is readable at the button.
 *
 * It resolves `true` exactly when the response was 2xx and `false` on a refusal or a request that never
 * completed. A caller that needs the outcome reads it (`answer`, a queue move whose drop is held until the
 * store answers); the rest discard it, and the toast is what a human reads.
 *
 * THE DISPATCHER'S OWN SENTENCE IS THE ANSWER, IN THE OPERATOR'S WORDS (`operatorWords`): `stdout` is read
 * FIRST and `stderr` only as the fallback, because every dispatcher verb speaks on stdout — `MOVED a.arc — 2
 * of 3` when it worked, `REFUSED queue a.arc: it is not in the queue — …` when it did not — and the lane
 * carries that body whole on a 409. 503 and 504 are the two cases where the dispatcher never spoke and the
 * server's own sentence stands in; they travel the same field and need no branch here. The toast is amber
 * rather than red on a refusal: a refused verb denied nothing and destroyed nothing.
 *
 * ONE PRESS AT A TIME PER CALLER: `busy` is the verb in flight, so a control refuses a second press while one
 * is out. Essential, not derivable — several of these verbs arm and disarm timers or move the dial's file, and
 * a double press would race two dispatcher processes at the same store.
 *
 * Used by `useDispatcherVerbs`, `useEpicDialVerbs` and `useEpicQueueVerbs` (this module).
 */
export function useVerbSend<Verb extends string>(options: VerbSendOptions<Verb>): VerbSend<Verb> {
  const { t } = useTranslation();
  const toast = useToast();

  // The verb in flight, so every control refuses a second press while one is out.
  const [busy, setBusy] = useState<Verb | null>(null);

  // A verb that resolves after its caller is gone must not set state or raise a toast about a screen
  // nobody is looking at any more (`speaksAfterUnmount` names the exception).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The caller's latest words, read when a press starts — written in an effect, never during render — so
  // `send` keeps one identity however the caller rebuilds its options, and the callbacks built on it stay put.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const send = useCallback(
    async (verb: Verb, call: () => Promise<Response>, keep: readonly string[] = []): Promise<boolean> => {
      if (!mountedRef.current) return false;
      setBusy(verb);
      const { keep: always, titles, alreadyDone, speaksAfterUnmount } = latest.current;
      const speaks = () => mountedRef.current || (speaksAfterUnmount?.includes(verb) ?? false);

      try {
        const response = await call();
        const body = await readBody(response);
        if (!speaks()) return response.ok;

        // Read before the status, because a 409 carries the very same shape — and because the
        // dispatcher's successes are sentences too (`PARKED dispatcher-ready`), not empty bodies.
        const said = operatorWords(firstLine(body?.stdout) || firstLine(body?.stderr), [...always, ...keep]);

        if (response.ok) {
          // The dispatcher's own sentence IS the answer, and every one of its verbs answers with one, shown in
          // the operator's words: `RESUMED dr-arc.arc — 2 plan(s)` is its stdout, the toast reads
          // `RESUMED dr-arc — 2 feature(s)`. `titles.done` is the fallback for an empty body.
          toast({ tone: 'positive', title: said || titles.done(verb) });
          return true;
        }

        if (alreadyDone?.(verb, body) === true) {      // an answer that arrived second is the state asked for: no warning
          toast({ tone: 'info', title: titles.refused(verb), message: said });
          return true;
        }
        toast({ tone: 'warn', title: titles.refused(verb), message: said || t('messages.operationFailed') });
        return false;
      } catch (error) {
        // The request never completed — the API is down, or the deadline passed. That is the
        // network's word, not the dispatcher's, and it is said as such.
        console.warn(`[useVerbSend] the ${verb} request did not complete:`, error);
        if (speaks()) toast({ tone: 'warn', title: t('messages.networkError') });
        return false;
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [t, toast],
  );

  return { busy, send };
}
