import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { ArcVerbResult, RunnerModelChoice } from '@/shared/types';

/** The runner's own first non-blank line, or nothing — `useRunnerVerbs` reads a refusal the same way. */
function firstLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/**
 * The arc deck header's ONE DeepSeek / Claude word: `plan-runner arc model <name> <word>`, relayed.
 *
 * The runner records the word in `arc.json`, hands it to every card it mints, and re-pins the cards already
 * minted and unfinished, so the card walking now follows it from its next phase. NOTHING OPTIMISTIC: the deck
 * redraws from the next `arc_state` frame. A refusal is the runner's own sentence, in an amber toast, exactly
 * as `useRunnerVerbs` shows a run verb's — a refused word changed nothing, so nothing on the deck is wrong.
 */
export function useArcModel(arcName: string): { setModel(choice: RunnerModelChoice): Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const toast = useToast();

  // The press in flight, so the control refuses a second one: two `arc model` processes would queue on
  // the arc's lock and land in an order the reader never chose.
  const [busy, setBusy] = useState(false);

  // An answer that lands after the deck is gone must not set state or raise a toast about it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setModel = useCallback(
    async (choice: RunnerModelChoice): Promise<void> => {
      if (!mountedRef.current) return;
      setBusy(true);
      try {
        const response = await api.planRunner.arcModel(arcName, choice);
        if (!mountedRef.current) return;
        if (response.ok) {
          toast({ tone: 'positive', title: t('runner.toast.model') });
          return;
        }
        const body = (await response.json().catch(() => null)) as Partial<ArcVerbResult> | null;
        const said = firstLine(body?.stderr) || firstLine(body?.stdout) || t('messages.operationFailed');
        toast({ tone: 'warn', title: t('runner.model.refused'), message: said });
      } catch (error) {
        console.warn(`[useArcModel] arc ${arcName}: the model request did not complete:`, error);
        if (mountedRef.current) toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [arcName, t, toast],
  );

  return { setModel, busy };
}
