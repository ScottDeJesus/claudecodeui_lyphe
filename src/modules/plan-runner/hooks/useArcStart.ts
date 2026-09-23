import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { ArcVerbResult } from '@/shared/types';

/** The runner's own first non-blank line, or nothing — `useArcModel` reads a refusal the same way. */
function firstLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/**
 * The arc deck header's Start and scheduled Start: `plan-runner arc start <name>` and `plan-runner arc schedule
 * <name> offpeak|none`, relayed. Used by `ArcDeck` for an arc that has not started.
 *
 * A REFUSAL IS SHOWN, NOT SWALLOWED: the runner's own sentence (a lint, the switch, an intent lock, a plan not on
 * disk) in an amber toast under the button's own word, exactly as `useArcModel` shows a refused model word — a
 * refused press changed nothing, so the deck already tells the truth. NOTHING OPTIMISTIC: the next `arc_state`
 * frame redraws the header from `arc.json`.
 */
export function useArcStart(arcName: string): {
  start(): Promise<void>;
  schedule(when: 'offpeak' | 'none'): Promise<void>;
  busy: boolean;
} {
  const { t } = useTranslation();
  const toast = useToast();
  // One press in flight: two `arc start` processes would queue on the arc's lock.
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const send = useCallback(
    async (press: () => Promise<Response>, done: string, refusedTitle: string): Promise<void> => {
      if (!mountedRef.current) return;
      setBusy(true);
      try {
        const response = await press();
        if (!mountedRef.current) return;
        if (response.ok) {
          toast({ tone: 'positive', title: t(done) });
          return;
        }
        const body = (await response.json().catch(() => null)) as Partial<ArcVerbResult> | null;
        const said = firstLine(body?.stderr) || firstLine(body?.stdout) || t('messages.operationFailed');
        toast({ tone: 'warn', title: refusedTitle, message: said });
      } catch (error) {
        console.warn(`[useArcStart] arc ${arcName}: the request did not complete:`, error);
        if (mountedRef.current) toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [arcName, t, toast],
  );

  const start = useCallback(
    () => send(() => api.planRunner.arcStart(arcName), 'runner.toast.arcStarted', t('runner.start')),
    [arcName, send, t],
  );
  const schedule = useCallback(
    (when: 'offpeak' | 'none') => send(() => api.planRunner.arcSchedule(arcName, when),
      when === 'none' ? 'runner.toast.unscheduled' : 'runner.toast.scheduled', t('runner.schedule.refused')),
    [arcName, send, t],
  );

  return { start, schedule, busy };
}
