import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerbSend } from '@/modules/dispatcher/hooks/useVerbSend';
import { api } from '@/shared/api';
import type { DispatcherEpicsWord } from '@/shared/types';

/**
 * The verbs of the board: the epic dial's Pause all word, the dial's planning word, and the one Start. The dial's two kinds of word
 * are named apart so a toast over a planning press is headed `Planning` and not `Epics`; they are the same dispatcher verb, `epics`.
 */
type BoardVerb = 'epics' | 'planning' | 'start';

/** The words headed a toast over a refused press, by verb: a total table, so a verb added above cannot go unheaded. */
const REFUSED_KEYS: Record<BoardVerb, string> = {
  epics: 'dispatcher.epics.refused',
  planning: 'dispatcher.planningDial.refused',
  start: 'dispatcher.master.startRefused',
};

/** The words headed a toast over a press that worked but whose answer arrived empty, by verb. */
const DONE_KEYS: Record<BoardVerb, string> = {
  epics: 'dispatcher.epics.done',
  planning: 'dispatcher.planningDial.done',
  start: 'runner.start',
};

/** The dial's two words that let planning through Pause all and hold it again (`hooks/dispatcher/epic_dial.py:PLANNING_WORDS`). */
const PLANNING_WORDS: readonly DispatcherEpicsWord[] = ['run-planning', 'hold-planning'];

/**
 * The BOARD's presses — verbs that name no plan and no arc, so neither has a hook of a plan's or an arc's:
 *
 * - `setDial` (`dispatcher epics <word>`, relayed through `POST /api/dispatcher/epics`): `pause` or `resume` — Pause all and
 *   Resume all — or `run-planning` / `hold-planning`, which let planning run under Pause all and hold it again (the Planning
 *   card's `PlanningDialPress`; the route spells their `--by app:card`).
 * - `start` (`dispatcher start`, `POST /api/dispatcher/start`): every plan held for its first Start let go at
 *   once. The queue's order and Pause all then decide what runs: each epic starts in turn.
 *
 * The toast is the dispatcher's own first line (`EPICS paused=no`, `STARTED 3 plan(s)`) in the
 * operator's words (`operatorWords`, through `useVerbSend`), headed `Epics`, `Planning` or `Start` when the dispatcher said
 * nothing, and `Epics not changed` / `Planning not changed` / `Nothing started` over a refusal.
 *
 * NOTHING OPTIMISTIC: the controller redraws from the next `dispatcher_state` frame, which reads the file the
 * word was written to and the store the Start wrote. `busy` is true while a press is out, so the controller
 * refuses a second one and two words never race to the flag. `setDial` REPORTS BACK, as the planning pair of
 * `useDispatcherVerbs` does — `true` exactly when the lane took the press (2xx) — because the Planning card's press
 * holds itself disabled from a press the lane took until the card shows it; the master controller discards it.
 *
 * Used by `MasterController` (this module), the Roadmap tab's In flight header, and by `PlanningDialPress` (this module).
 */
export function useBoardVerbs(): { setDial(word: DispatcherEpicsWord): Promise<boolean>; start(): Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const { busy, send } = useVerbSend<BoardVerb>({
    keep: [],
    titles: {
      refused: (verb) => t(REFUSED_KEYS[verb]),
      done: (verb) => t(DONE_KEYS[verb]),
    },
  });
  const setDial = useCallback(
    (word: DispatcherEpicsWord) => send(PLANNING_WORDS.includes(word) ? 'planning' : 'epics', () => api.dispatcher.epics(word)),
    [send],
  );
  const start = useCallback(async () => {
    await send('start', () => api.dispatcher.start());
  }, [send]);
  return { setDial, start, busy: busy !== null };
}
