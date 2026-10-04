import { PlayIcon, SquareIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHeal } from '@/modules/heal/context/HealContext';
import { api, readApiJson } from '@/shared/api';
import { Badge, Button } from '@/shared/ui';

/** How long a refused press's sentence stands under the button when no later reading retires it first. */
const REFUSAL_MS = 20_000;

/** The worker's one-line answer to a press (`heal-reflex --cycle now|stop`): a refusal is an answer, not an error. */
type CycleAnswer = { cycle: string | null; started: boolean; stage: string | null; why: string };

/**
 * The toolbar's Start/Stop (`HealActions`): THE CYCLE'S DOOR. Start is the primary press — the one
 * a reader arrives for, at the far end of the toolbar — and it opens a cycle: Chiron ranks the live
 * friction, heals walk his list. Stop ends the open cycle: running heals finish, nothing new starts, which the hint says
 * because "End" beside a walking heal reads as a kill unless it is said.
 *
 * THE MASTER STOPS EVERY DOOR, this one included, so with it off Start is disabled and the cell's
 * caption says where the master lives — the master itself is written only by Settings → Agents. End
 * cycle stays pressable: stopping needs no permission.
 *
 * NOTHING HERE IS OPTIMISTIC. Which word the button shows is `cycle_open` off the summary, and every
 * press — landed, refused or failed — ends in `refresh()`, so the button moves only once the worker
 * has been read saying so.
 *
 * A REFUSED PRESS ANSWERS WHERE THE FINGER IS. The worker refuses a press in one sentence ("heal
 * switch off", "a cycle is already open") and that sentence stands under the button at
 * every width — not in the cell's caption, which is hidden under 48rem, so a phone would press and
 * see nothing move. It wraps inside the cell rather than widening it: a sentence must never push the
 * toolbar past a 390px edge.
 */
export function HealStartStopButton({ master, cycleOpen }: { master: boolean; cycleOpen: boolean }) {
  const { t } = useTranslation();
  const { summary, refresh } = useHeal();
  // One press at a time: a second issued before the first has read back would act on a cycle state
  // that has not moved yet. A press while one is crossing is dropped.
  const pressing = useRef(false);
  const [refused, setRefused] = useState<{ why: string; at: number } | null>(null);
  // The refusal stands until the NEXT reading after the press's own (a poll, another control's
  // refresh) or 20 s, whichever comes first. The press's own read-back lands within a second of the
  // answer, so a summary arriving later than that is a new reading and retires the sentence.
  useEffect(() => {
    if (refused !== null && Date.now() - refused.at > 1_000) setRefused(null);
  }, [summary, refused]);
  useEffect(() => {
    if (refused === null) return undefined;
    const timer = window.setTimeout(() => setRefused(null), REFUSAL_MS);
    return () => window.clearTimeout(timer);
  }, [refused]);
  const press = async (door: () => Promise<Response>, what: string): Promise<void> => {
    if (pressing.current) return;
    pressing.current = true;
    let why: string | null = null;
    try {
      const answer = await readApiJson<CycleAnswer>(await door());
      if (!answer.started) why = answer.why;
    } catch (error) {
      // Not a refusal — the route or the network failed. The server's own sentence still belongs where
      // the finger is, or the press would look like it did nothing.
      console.error(`Error asking the heal worker to ${what}:`, error);
      why = error instanceof Error ? error.message : String(error);
    } finally {
      pressing.current = false;
      await refresh();
      setRefused(why === null ? null : { why, at: Date.now() });
    }
  };
  const onCycleStart = (): void => void press(() => api.heal.cycleStart(), 'open a cycle');
  const onCycleStop = (): void => void press(() => api.heal.cycleStop(), 'end the cycle');
  const refusal: string | null = refused?.why ?? null;

  return (
    <>
      <Button
        size="sm"
        variant={cycleOpen ? 'secondary' : 'default'}
        disabled={!cycleOpen && !master}
        title={cycleOpen
          ? t('heal.startStop.stopHint', { defaultValue: 'End the open cycle: heals already running finish on their own, and nothing new starts.' })
          : master
            ? t('heal.startStop.startHint', { defaultValue: 'Open a cycle now: Chiron ranks the live friction, then heals walk his list one after another.' })
            : t('heal.cycles.masterOff', { defaultValue: 'Heals are off — Settings → Agents' })}
        onClick={cycleOpen ? onCycleStop : onCycleStart}
        data-heal-cycle-start-stop={cycleOpen ? 'stop' : 'start'}
      >
        {cycleOpen ? <SquareIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
        {cycleOpen
          ? t('heal.startStop.stop', { defaultValue: 'End cycle' })
          : t('heal.startStop.start', { defaultValue: 'Run a cycle now' })}
      </Button>
      {refusal !== null && (
        <Badge as="span" tone="warn" role="status" className="w-full min-w-0 max-w-72 whitespace-normal break-words" data-heal-cycle-refusal>{refusal}</Badge>
      )}
    </>
  );
}
