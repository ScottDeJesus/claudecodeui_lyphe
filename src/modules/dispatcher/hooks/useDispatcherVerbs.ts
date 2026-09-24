import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { DispatcherVerb } from '@/shared/types';

/** The dispatcher's answer, as much of it as this hook reads. Both fields are free text it wrote. */
type VerbBody = { stdout?: unknown; stderr?: unknown };

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
 * Stop, Resume, Schedule, Park and Unpark for one v3 plan, and what to say about each.
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
 * queued or scheduled plan's button says Start, and a refusal headed "Resume" would name a verb the
 * operator never saw. It is `resume` that runs either way.
 *
 * NOTHING OPTIMISTIC: the control re-draws from the next `dispatcher_state` frame, which is the
 * store read back — the armed hour, the pause flag and the state word are the dispatcher's, never
 * this hook's.
 */
export function useDispatcherVerbs(name: string, resumeWord?: string): {
  stop(): Promise<void>;
  resume(): Promise<void>;
  schedule(when: string): Promise<void>;
  park(): Promise<void>;
  unpark(): Promise<void>;
  busy: DispatcherVerb | null;
} {
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
      return resumeWord ?? t('runner.resume');
    },
    [resumeWord, t],
  );

  const send = useCallback(
    async (verb: DispatcherVerb, when?: string): Promise<void> => {
      if (!mountedRef.current) return;
      setBusy(verb);

      try {
        const response = verb === 'stop' ? await api.dispatcher.stop(name)
          : verb === 'park' ? await api.dispatcher.park(name)
            : verb === 'unpark' ? await api.dispatcher.unpark(name)
              : verb === 'schedule' ? await api.dispatcher.schedule(name, when ?? 'none')
                : await api.dispatcher.resume(name);
        const body = await readBody(response);
        if (!mountedRef.current) return;

        // Read before the status, because a 409 carries the very same shape — and because the
        // dispatcher's successes are sentences too (`PARKED dispatcher-ready.v3`), not empty bodies.
        const said = firstLine(body?.stdout) || firstLine(body?.stderr);

        if (response.ok) {
          toast({ tone: 'positive', title: said || word(verb) });
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
    [name, t, toast, word],
  );

  const stop = useCallback(() => send('stop'), [send]);
  const resume = useCallback(() => send('resume'), [send]);
  const schedule = useCallback((when: string) => send('schedule', when), [send]);
  const park = useCallback(() => send('park'), [send]);
  const unpark = useCallback(() => send('unpark'), [send]);

  return { stop, resume, schedule, park, unpark, busy };
}
