import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerbSend } from '@/modules/dispatcher/hooks/useVerbSend';
import { api } from '@/shared/api';
import type { DispatcherEpicsWord } from '@/shared/types';

/**
 * The epic dial's one press (`dispatcher epics <word>`), relayed through `POST /api/dispatcher/epics`: a
 * limit of `1` to `5` or `all`, or `pause` / `resume`. A BOARD verb — it names no plan and no arc, so it
 * has no hook of a plan's or an arc's, and its toast is the dispatcher's own first line (`EPICS limit=2
 * paused=no`) in the operator's words (`operatorWords`, through `useVerbSend`), headed `Epics` when the
 * dispatcher said nothing and `Epics not changed` over a refusal.
 *
 * NOTHING OPTIMISTIC: the dial redraws from the next `dispatcher_state` frame, which reads the file the
 * word was written to. `busy` is true while a press is out, so the dial refuses a second one and two words
 * never race to the flag.
 *
 * Used by `EpicDial` (this module), the Roadmap tab's In flight header.
 */
export function useEpicDialVerbs(): { setDial(word: DispatcherEpicsWord): Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const { busy, send } = useVerbSend<'epics'>({
    keep: [],
    titles: { refused: () => t('dispatcher.epics.refused'), done: () => t('dispatcher.epics.done') },
  });
  const setDial = useCallback(
    async (word: DispatcherEpicsWord) => {
      await send('epics', () => api.dispatcher.epics(word));
    },
    [send],
  );
  return { setDial, busy: busy !== null };
}
