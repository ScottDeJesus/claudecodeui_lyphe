import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { DispatcherVerbResult, RunnerModelChoice } from '@/shared/types';

/** The dispatcher's own first non-blank line, or nothing. Blank lines are stepped over — `useDispatcherVerbs` reads a verdict the same way, and for the same reason. */
function firstLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * The dispatch arc header's ONE DeepSeek / Claude word: `dispatcher model <arc> <word>`, relayed.
 *
 * IT IS THE `model` VERB AND NOT AN ARC-SHAPED ONE. The dispatcher resolves a name plan-first and
 * then arc (`cmd/model.py`), takes the word on the arc's own row, and HANDS IT TO EVERY PLAN OF THE
 * ARC in the same transaction (`store.set_arc_model`, the runner's own rule for its minted cards) —
 * so one press re-words every plan the arc has, which is what the header's sentence promises. Nothing
 * is optimistic here: the header and its plans both redraw from the next `dispatcher_state` frame.
 *
 * THE DISPATCHER PRINTS ITS REFUSALS ON STDOUT, unlike almost every command on this host — the rule
 * `useDispatcherVerbs` states once — so `stdout` is read FIRST and `stderr` only as the fallback, and
 * a 409's body carries the dispatcher's own sentence whole.
 *
 * The toast is amber on a refusal: a refused word denied nothing and destroyed nothing, and the
 * arc's own row is exactly as it was.
 */
export function useDispatcherArcModel(arcName: string): {
  setModel(choice: RunnerModelChoice): Promise<void>;
  busy: boolean;
} {
  const { t } = useTranslation();
  const toast = useToast();

  // The press in flight, so the control refuses a second one while it is out: two `dispatcher model`
  // processes would write the arc and every plan of it twice, in an order nobody chose.
  const [busy, setBusy] = useState(false);

  // An answer that lands after the header is gone must not set state or raise a toast about it.
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
        const response = await api.dispatcher.arcModel(arcName, choice);
        const body = (await response.json().catch(() => null)) as Partial<DispatcherVerbResult> | null;
        if (!mountedRef.current) return;

        const said = firstLine(body?.stdout) || firstLine(body?.stderr);
        if (response.ok) {
          toast({ tone: 'positive', title: said || t('runner.toast.model') });
          return;
        }
        toast({ tone: 'warn', title: t('runner.model.refused'), message: said || t('messages.operationFailed') });
      } catch (error) {
        console.warn(`[useDispatcherArcModel] arc ${arcName}: the model request did not complete:`, error);
        if (mountedRef.current) toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [arcName, t, toast],
  );

  return { setModel, busy };
}
