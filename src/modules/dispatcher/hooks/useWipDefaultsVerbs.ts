import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { DispatcherWipLimit } from '@/shared/types';

/** Both defaults as the file holds them — each limit's word, `'<N>'` or `'all'`. */
type WipWords = { features: string; tasks: string };

/** One limit's word as the server writes it: `all`, or a whole number from 1 with no leading zero, inside the range both languages hold. */
function wordOf(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:all|[1-9][0-9]*)$/.test(value)) return null;
  return value === 'all' || Number.isSafeInteger(Number(value)) ? value : null;
}

/**
 * The two defaults in a `GET` answer, or `null` when the body is not them.
 *
 * The API's own envelope for a restart, a proxy's 502 or an expired token's 401 is
 * `{success:false,error:{…}}`, which `.json()` parses happily: a body without both words is "could not
 * ask", never a default — a write laid over that would put two and two back over a file that may hold nine.
 */
function wordsOf(body: unknown): WipWords | null {
  if (typeof body !== 'object' || body === null) return null;
  const { features, tasks } = body as { features?: unknown; tasks?: unknown };
  const featuresWord = wordOf(features);
  const tasksWord = wordOf(tasks);
  return featuresWord === null || tasksWord === null ? null : { features: featuresWord, tasks: tasksWord };
}

/**
 * The master controller's two WIP dropdowns' one press: set a default — how many features of an epic are in
 * progress at once, or how many tasks each runs — through `PUT /api/settings/wip`, the file
 * (`~/.claude/state/wip.flag`) the dispatcher re-reads at every take-up. It is the Settings row's old writer,
 * moved to its one consumer: the Settings row left Settings, and the board's frame (`DispatcherRoute.wip`)
 * is what draws the numbers, so this hook reads nothing for display.
 *
 * THE FILE IS WRITTEN WHOLE — both lines at once — so the other limit rides along, and it is RE-READ JUST
 * BEFORE THE WRITE: it may have moved since the last frame (the operator sets defaults from his phone, and a
 * pair written from the frame's copy would silently put the old number back). A read that cannot be trusted
 * writes nothing.
 *
 * NOTHING OPTIMISTIC, as the board's other presses: the dropdown redraws from the next `dispatcher_state`
 * frame, which reads the file back. `busy` is true while a press is out, so the controller refuses a second
 * one; a refusal or a request that never completed is a toast, and the dropdown goes on telling the truth.
 *
 * Used by `MasterController` (this module), the Roadmap tab's In flight header.
 */
export function useWipDefaultsVerbs(): { setLimit(limit: DispatcherWipLimit, word: string): Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const toast = useToast();
  // Held while a press is out so the controller can disable its dropdowns; the ref is what actually
  // refuses a second press in the same tick, before React has re-rendered with the state.
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const setLimit = useCallback(
    async (limit: DispatcherWipLimit, word: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const read = await api.settings.wipDefaults();
        const fresh = read.ok ? wordsOf(await read.json()) : null;
        if (fresh === null) {
          toast({ tone: 'warn', title: t('dispatcher.master.wipRefused'), message: t('dispatcher.master.wipUnreadable') });
          return;
        }
        const wrote = await api.settings.saveWipDefaults({ ...fresh, [limit]: word });
        if (!wrote.ok || wordsOf(await wrote.json()) === null) {
          toast({ tone: 'warn', title: t('dispatcher.master.wipRefused'), message: t('messages.operationFailed') });
          return;
        }
        toast({ tone: 'positive', title: t('dispatcher.master.wipDone', { limit: t(`dispatcher.master.wip.${limit}`), word: word === 'all' ? t('dispatcher.wip.all') : word }) });
      } catch (error) {
        console.error('Error saving the WIP defaults:', error);
        toast({ tone: 'warn', title: t('messages.networkError') });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [t, toast],
  );

  return { setLimit, busy };
}
