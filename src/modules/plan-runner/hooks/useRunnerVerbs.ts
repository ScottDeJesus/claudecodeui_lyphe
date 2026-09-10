import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { RunnerVerb } from '@/shared/types';

/** The runner's answer, as much of it as this hook reads. Both fields are free text it wrote. */
type VerbBody = { stderr?: unknown; stdout?: unknown };

/**
 * The runner's own first sentence, or nothing. Blank lines are stepped over rather than returned:
 * a refusal that began with a newline would otherwise raise an empty toast.
 */
function firstLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/** A verdict is the runner's own body, so it is read BEFORE the status is judged — 409 carries it too. */
async function readBody(response: Response): Promise<VerbBody | null> {
  try {
    return (await response.json()) as VerbBody;
  } catch {
    return null;
  }
}

/**
 * Stop and Resume for one run, and what to say about each.
 *
 * NO CONFIRMATION DIALOG GUARDS STOP, deliberately. Stop is a PAUSE — it parks the run and
 * `resume` un-parks it, so the press is reversible by the button that replaces it. A dialog in
 * front of a reversible act trains the reader to dismiss dialogs, which is what makes the
 * irreversible one dangerous later.
 *
 * A REFUSAL IS A RESULT, NOT A FAILURE. The runner already knows what a pause means and what a
 * resume may decline, and its own sentence — `no lock names run <id> — nothing to stop` — is the
 * single most useful thing in the answer. The lane carries it whole in a 409 body, so a refusal
 * shows THAT line rather than a generic "something went wrong" that tells the reader nothing
 * about which of the runner's rules they met. 503 and 504 are the two cases where the runner
 * never spoke and the server's own sentence stands in; they travel the same field and need no
 * branch here.
 *
 * The toast is amber rather than red on both: a refused verb denied nothing and destroyed
 * nothing (design doctrine :145).
 */
export function useRunnerVerbs(runId: string): {
  stop(): Promise<void>;
  resume(): Promise<void>;
  busy: RunnerVerb | null;
} {
  const { t } = useTranslation();
  const toast = useToast();

  // The verb in flight, so both buttons refuse a second press while one is out. Essential: the
  // runner takes a lock and a double-press would race two processes at the same run directory.
  const [busy, setBusy] = useState<RunnerVerb | null>(null);

  // A verb that resolves after the card is gone must not set state or raise a toast about a run
  // nobody is looking at any more.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const send = useCallback(
    async (verb: RunnerVerb): Promise<void> => {
      if (!mountedRef.current) return;
      setBusy(verb);

      try {
        const response = verb === 'stop'
          ? await api.planRunner.stop(runId)
          : await api.planRunner.resume(runId);
        const body = await readBody(response);
        if (!mountedRef.current) return;

        if (response.ok) {
          const said = verb === 'stop' ? 'runner.toast.stopping' : 'runner.toast.resumed';
          toast({ tone: 'positive', title: t(said) });
          return;
        }

        // `stdout` is the fallback rather than a second guess: `plan-runner` prints its refusals
        // on stderr, but a verb that exits non-zero having said its piece on stdout is still
        // telling the reader something, and an empty toast tells them nothing at all.
        const said = firstLine(body?.stderr) || firstLine(body?.stdout) || t('messages.operationFailed');
        toast({ tone: 'warn', title: t(verb === 'stop' ? 'runner.stop' : 'runner.resume'), message: said });
      } catch (error) {
        // The request never completed — the API is down, or the deadline passed. That is the
        // network's word, not the runner's, and it is said as such.
        console.warn(`[useRunnerVerbs] the ${verb} request did not complete:`, error);
        if (mountedRef.current) toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [runId, t, toast],
  );

  const stop = useCallback(() => send('stop'), [send]);
  const resume = useCallback(() => send('resume'), [send]);

  return { stop, resume, busy };
}
