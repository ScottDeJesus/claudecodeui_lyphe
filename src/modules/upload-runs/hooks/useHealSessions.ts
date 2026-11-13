import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

import type { HealSessionsAnswer } from '@/modules/heal';
import { NO_SESSIONS_ANSWER, chunkSessionIds, mergeAnswers, readSessionsAnswer } from '@/modules/upload-runs/utils/healAnswer';
import { api } from '@/shared/api';

/**
 * The heal ledger's answer for a set of Claude sessions. `answer` is null while it is out and when it could not be read, and
 * `failed` tells those two apart: NOT READ IS NEVER NONE, so a failed read never becomes an empty answer, and the view says
 * the ledger could not be read. `retry` is Try again: it clears the failure so the waiting surface shows while the read is out.
 */
type HealRead = { answer: HealSessionsAnswer | null; failed: boolean; retry: () => void };

/** What a read said, and for WHICH ids: an answer is only ever shown for the ids it was read for. */
type ReadState = { idsKey: string; answer: HealSessionsAnswer | null; failed: boolean };

/** What the next read is for, as the newest render wants it. */
type Wanted = { active: boolean; idsKey: string | null };

/** The one reader of a hook: it is told what is wanted, and asked to read it. */
type HealReader = {
  want: (wanted: Wanted) => void;
  ask: () => void;
};

/** The answer for `ids`, in as many reads as the relay's list limit makes, run side by side and made one. */
async function readSessions(ids: string[]): Promise<HealSessionsAnswer> {
  const parts = await Promise.all(chunkSessionIds(ids).map(async (chunk) => {
    const response = await api.heal.sessions(chunk);
    if (!response.ok) throw new Error(`the heal relay answered ${response.status} for ${chunk.length} sessions`);
    return readSessionsAnswer(await response.json());
  }));
  return mergeAnswers(parts);
}

/**
 * Makes the reader that runs the reads ONE AT A TIME. The worker behind the heal relay is a process for each call, so a read
 * asked for while one is out is not started beside it: it is ONE read after it, made for whatever is wanted by then (the
 * newest ids, or nothing if the view was hidden meanwhile). `store` is told each answer with the ids it was read for.
 */
function createHealReader(store: (state: ReadState) => void): HealReader {
  let wanted: Wanted = { active: false, idsKey: null };
  let running = false;
  let askedAgain = false;

  const read = async (): Promise<void> => {
    const { active, idsKey } = wanted;
    if (!active || idsKey === null || idsKey === '') return;
    const sessions = idsKey.split(',');
    try {
      store({ idsKey, answer: await readSessions(sessions), failed: false });
    } catch (failure) {
      console.warn(`The heal ledger could not be read for ${sessions.length} upload run sessions.`, failure);
      store({ idsKey, answer: null, failed: true });
    }
  };

  const ask = (): void => {
    if (running) {
      askedAgain = true;
      return;
    }
    running = true;
    void read().finally(() => {
      running = false;
      if (askedAgain) {
        askedAgain = false;
        ask();
      }
    });
  };

  return {
    want: (next) => {
      wanted = next;
    },
    ask,
  };
}

/**
 * Reads the heal worker's rows and heals for `ids` (the Claude session of each run), and again whenever `trigger` changes or
 * `retry` is pressed. It reads nothing while `active` is false (the view is hidden), and nothing for a null `ids` (the runs
 * are not in hand yet); a list with no session in it needs no read and answers at once with no rows, which is a fact and
 * not a failure.
 *
 * AN ANSWER BELONGS TO ITS IDS. It stays on screen while the same ids are read again (a re-read never blinks the marks out),
 * but it is never handed back for other ids: the sheet of one run must not draw another run's rows and heals, and a window
 * that changed must not count the old window's heals, while the new answer is out. Until it lands the answer is null, which
 * the view draws as "still out".
 *
 * ONE READ IS OUT AT A TIME. Triggers that arrive while a read is out (a burst of frames, a press of Refresh) are one read
 * after it, for the newest ids, so the worker is never run twice at once (`createHealReader`).
 *
 * `trigger` is whatever should make the ledger be read again and is not itself an id: a press or a frame that re-read the
 * overview, a heal that changed, the end of a run. No timer is kept here: the heal context's own minute-long read is the one
 * that notices a heal landing, and the caller turns its change into a new `trigger`.
 *
 * Used by this module's `useUploadsRead` (for the window's runs) and `useRunSheet` (for the open run's one session).
 */
export function useHealSessions(ids: readonly string[] | null, active: boolean, trigger: string): HealRead {
  // The ids as one key, so a new array holding the same ids does not read again.
  const idsKey = ids === null ? null : ids.join(',');
  // The newest answer, or that it failed, for the ids it was read for. Essential and not derivable: the read is asynchronous, and what it last said outlives each render.
  const [state, setState] = useState<ReadState | null>(null);
  // How many times Try again was pressed; the read starts again when it moves.
  const [round, setRound] = useState(0);
  // The one reader, made once: it must outlive every render, and `setState` is the same for all of them.
  const [reader] = useState(() => createHealReader(setState));

  // What the newest render wants read, told in a layout effect (and withdrawn when the caller goes), so a read that starts,
  // possibly after the one before it, reads what is wanted at that moment and never what was wanted when it was asked.
  useLayoutEffect(() => {
    reader.want({ active, idsKey });
    return () => reader.want({ active: false, idsKey: null });
  });

  useEffect(() => {
    reader.ask();
  }, [reader, active, idsKey, trigger, round]);

  const retry = useCallback(() => {
    setState(null);
    setRound((asked) => asked + 1);
  }, []);

  if (ids === null) return { answer: null, failed: false, retry };
  if (ids.length === 0) return { answer: NO_SESSIONS_ANSWER, failed: false, retry };
  const mine = state !== null && state.idsKey === idsKey ? state : null;
  return { answer: mine?.answer ?? null, failed: mine?.failed ?? false, retry };
}
