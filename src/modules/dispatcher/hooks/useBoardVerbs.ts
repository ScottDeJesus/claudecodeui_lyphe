import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerbSend } from '@/modules/dispatcher/hooks/useVerbSend';
import { api } from '@/shared/api';
import type { DispatcherEpicsWord } from '@/shared/types';

/** The two verbs of the board: the epic dial's word, and the one Start. */
type BoardVerb = 'epics' | 'start';

/**
 * The BOARD's two presses — verbs that name no plan and no arc, so neither has a hook of a plan's or an arc's:
 *
 * - `setDial` (`dispatcher epics <word>`, relayed through `POST /api/dispatcher/epics`): a limit of `1` to
 *   `5`, or `pause` / `resume` — Epics at once, and Pause all.
 * - `start` (`dispatcher start`, `POST /api/dispatcher/start`): every plan held for its first Start let go at
 *   once. The queue's order and the dial then decide what runs, so at a limit of 1 the top epic runs and the
 *   next waits till it finishes.
 *
 * The toast is the dispatcher's own first line (`EPICS limit=2 paused=no`, `STARTED 3 plan(s)`) in the
 * operator's words (`operatorWords`, through `useVerbSend`), headed `Epics` or `Start` when the dispatcher said
 * nothing, and `Epics not changed` / `Nothing started` over a refusal.
 *
 * NOTHING OPTIMISTIC: the controller redraws from the next `dispatcher_state` frame, which reads the file the
 * word was written to and the store the Start wrote. `busy` is true while a press is out, so the controller
 * refuses a second one and two words never race to the flag.
 *
 * Used by `MasterController` (this module), the Roadmap tab's In flight header.
 */
export function useBoardVerbs(): { setDial(word: DispatcherEpicsWord): Promise<void>; start(): Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const { busy, send } = useVerbSend<BoardVerb>({
    keep: [],
    titles: {
      refused: (verb) => t(verb === 'start' ? 'dispatcher.master.startRefused' : 'dispatcher.epics.refused'),
      done: (verb) => t(verb === 'start' ? 'runner.start' : 'dispatcher.epics.done'),
    },
  });
  const setDial = useCallback(
    async (word: DispatcherEpicsWord) => {
      await send('epics', () => api.dispatcher.epics(word));
    },
    [send],
  );
  const start = useCallback(async () => {
    await send('start', () => api.dispatcher.start());
  }, [send]);
  return { setDial, start, busy: busy !== null };
}
