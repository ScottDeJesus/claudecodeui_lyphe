import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';

/** What a press of the Override hands back: the press itself, and whether one is out. */
type CpuRelease = {
  /** Let THIS agent start now. Resolves when the server has answered and the toast has said how it went. */
  release: () => Promise<void>;
  /** True while a press is out, so the button refuses a second one. */
  busy: boolean;
};

/**
 * The Override of ONE agent the runner is holding back because the box's CPU is full: it starts THAT agent now and leaves the check
 * on, so the next agent is weighed as before (`pacer cpu-release`, through `POST /api/dispatch-souls/launches/:id/cpu-release`).
 *
 * `launchId` is the waiting agent's launch id — what the dispatcher's document carries as `cpu_wait.launch` and the soul lane as the
 * pin's own id. Nothing is optimistic: the row or card re-draws from the next frame, which is the marker the runner clears once the
 * agent has started. A refusal (409) is a calm one — the agent started on its own a moment before the press — and is said in words,
 * never as the door's own sentence, which names a launch id nobody reads.
 *
 * Used by the dispatcher module's `CpuWaitOverride` (a plan card's, an epic deck's and a Planning line's wait) and by the chat
 * module's `SoulLaunchPinRow` (a hand-launched chain's wait): two modules, one press, so it lives here and not in either.
 */
export function useCpuRelease(launchId: string): CpuRelease {
  const { t } = useTranslation();
  const toast = useToast();
  // One press at a time: the door writes to the agent's own fifo, and a second press on an agent that has already started
  // would only be answered with a refusal. Essential, not derivable — it exists only while the request is in flight.
  const [busy, setBusy] = useState(false);

  const release = useCallback(async () => {
    setBusy(true);
    try {
      const response = await api.dispatchSouls.cpuRelease(launchId);
      if (response.ok) {
        toast({ tone: 'positive', title: t('cpuWait.released') });
      } else if (response.status === 409) {
        toast({ tone: 'info', title: t('cpuWait.notWaiting') });
      } else {
        toast({ tone: 'warn', title: t('cpuWait.refused'), message: t('messages.operationFailed') });
      }
    } catch (error) {
      // The request never completed — the API is down, or the deadline passed: the network's word, said as such.
      console.warn('[useCpuRelease] the Override request did not complete:', error);
      toast({ tone: 'warn', title: t('messages.networkError') });
    } finally {
      setBusy(false);
    }
  }, [launchId, t, toast]);

  return { release, busy };
}
