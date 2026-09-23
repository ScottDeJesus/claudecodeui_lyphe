import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { RunnerModelChoice, RunnerVerb } from '@/shared/types';

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
 * Stop, Resume, the model word and the scheduled Start for one run, and what to say about each.
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
 *
 * `resumeWord` is the word ON THE BUTTON that pressed it, and the refusal answers in that word: a
 * queued run's button says Start, and a refusal headed "Resume" names a verb the operator never
 * saw. The runner's own sentence underneath is the same either way — it is `resume` that runs.
 *
 * `setModel` relays `plan-runner model <id> <word>` and `schedule` relays `plan-runner schedule <id>
 * offpeak|none` under the same `busy` guard, so every control on the card refuses a second press together. NOTHING OPTIMISTIC: the
 * control re-draws from the next `runner_state` frame, which reads `run.json:model` back.
 */
export function useRunnerVerbs(runId: string, resumeWord?: string): {
  stop(): Promise<void>;
  resume(): Promise<void>;
  setModel(choice: RunnerModelChoice): Promise<void>;
  schedule(when: 'offpeak' | 'none'): Promise<void>;
  busy: RunnerVerb | null;
} {
  const { t } = useTranslation();
  const toast = useToast();

  // The verb in flight, so every control refuses a second press while one is out. Essential: the
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
    async (verb: RunnerVerb, word?: string): Promise<void> => {
      if (!mountedRef.current) return;
      setBusy(verb);

      try {
        const response = verb === 'stop'
          ? await api.planRunner.stop(runId)
          : verb === 'model'
            ? await api.planRunner.model(runId, (word ?? 'deepseek') as RunnerModelChoice)
            : verb === 'schedule'
              ? await api.planRunner.schedule(runId, word ?? 'none')
              : await api.planRunner.resume(runId);
        const body = await readBody(response);
        if (!mountedRef.current) return;

        if (response.ok) {
          const said = verb === 'stop' ? 'runner.toast.stopping'
            : verb === 'model' ? 'runner.toast.model'
              : verb === 'schedule' ? (word === 'none' ? 'runner.toast.unscheduled' : 'runner.toast.scheduled')
                : 'runner.toast.resumed';
          toast({ tone: 'positive', title: t(said) });
          return;
        }

        // `stdout` is the fallback rather than a second guess: `plan-runner` prints its refusals
        // on stderr, but a verb that exits non-zero having said its piece on stdout is still
        // telling the reader something, and an empty toast tells them nothing at all.
        const said = firstLine(body?.stderr) || firstLine(body?.stdout) || t('messages.operationFailed');
        const title = verb === 'stop' ? t('runner.stop')
          : verb === 'model' ? t('runner.model.refused')
            : verb === 'schedule' ? t('runner.schedule.refused') : (resumeWord ?? t('runner.resume'));
        toast({ tone: 'warn', title, message: said });
      } catch (error) {
        // The request never completed — the API is down, or the deadline passed. That is the
        // network's word, not the runner's, and it is said as such.
        console.warn(`[useRunnerVerbs] the ${verb} request did not complete:`, error);
        if (mountedRef.current) toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [runId, resumeWord, t, toast],
  );

  const stop = useCallback(() => send('stop'), [send]);
  const resume = useCallback(() => send('resume'), [send]);
  const setModel = useCallback((choice: RunnerModelChoice) => send('model', choice), [send]);
  const schedule = useCallback((when: 'offpeak' | 'none') => send('schedule', when), [send]);

  return { stop, resume, setModel, schedule, busy };
}
