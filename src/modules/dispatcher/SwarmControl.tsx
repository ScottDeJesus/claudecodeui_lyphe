import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LANES_MIN } from '@/shared/constants';
import { Stepper } from '@/shared/ui';
import type { DispatcherSwarmChoice, DispatcherSwarmWord } from '@/shared/types';
import { swarmLadderSteps, swarmLadderTop } from '@/shared/utils';

/**
 * Drawn in the stepper while there is no number to draw: the plan has no word of its own and the first
 * frame has not told us Settings'. Not a word, so it is not translated.
 */
const PENDING = '…';

/**
 * How many of a plan's tasks a swarm word allows at once — the dispatcher's own reading of it
 * (`swarm_word.lanes`): `off` is one, `on N` is N, and a bare `on` has no ceiling, which is `null` and
 * is drawn as All.
 */
function lanesOfWord(word: DispatcherSwarmWord): number | null {
  if (word === 'off') return LANES_MIN;
  return word === 'on' ? null : Number(word.slice(3));
}

/**
 * The word a press on the ladder sends for the number it landed on.
 *
 * COMPARED AS NUMBERS, NOT WORDS: landing on Settings' number is `auto` whichever way Settings spells
 * it (`off` and `on 1` are both one), so the plan follows Settings again instead of freezing a copy of
 * it. Anything else is the plan's own word, spelled as the dispatcher's grammar has it.
 */
function choiceForLanes(lanes: number | null, settingsLanes: number | null): DispatcherSwarmChoice {
  if (lanes === settingsLanes) return 'auto';
  if (lanes === null) return 'on';
  return lanes === LANES_MIN ? 'off' : `on ${lanes}`;
}

type SwarmControlProps = {
  /** The plan's OWN word as the last frame read it (`DispatcherPlan.swarm`), `null` when it follows Settings. */
  value: DispatcherSwarmWord | null;
  /** Settings' word — the box's switch as the same frame read it (`DispatcherRoute.swarm`) — or `null` before the first frame. */
  settingsWord: DispatcherSwarmWord | null;
  /** A verb is in flight for this plan: every press is refused until it answers. */
  busy: boolean;
  /** Relays the word a press chose (`auto` hands the plan back to Settings). Never called for a press the ladder refuses. */
  onChoose: (choice: DispatcherSwarmChoice) => void;
};

/**
 * One plan's swarm: how many of this feature's tasks walk at once — `1, 2, … 6, All` — as one compact
 * `Stepper` beside the swarm mark.
 *
 * SETTINGS IS THE DEFAULT. A plan with no word of its own draws Settings' number (box `off` is 1,
 * `on 3` is 3, a bare `on` is All) and wears a quiet `default` inside the control; a plan with its own
 * word draws its own number and wears nothing. Stepping to a number other than Settings' gives the plan
 * its own word; stepping back to Settings' number sends `auto`, so it follows Settings again and the
 * marker comes back. The number IS the word: `off` is 1, `on N` is N, a bare `on` is All.
 *
 * THE LADDER IS THE SETTINGS ROW'S (`swarmLadderSteps`, one copy of the rules): `+` adds one up to the
 * top rung — six, or a wider count Settings or the plan already holds — then goes to All; `−` takes All
 * to the top rung and stops at one.
 *
 * NOTHING IS GUESSED OR OPTIMISTIC, as `RunModelControl`: the number drawn is the frame's own, a press
 * waits for Settings' word (it is what a press is compared against), `busy` refuses presses, and a
 * refused press leaves the control telling the truth with the dispatcher's sentence in a toast.
 *
 * The probe's handles: `data-plan-swarm` is the plan's own word (`auto` for none),
 * `data-plan-swarm-effective` the word in force, and `data-plan-swarm-default` is present while the
 * plan follows Settings.
 *
 * Used by `PlanControls`, beside the plan's model control at the end of the card's `ActionBar`.
 */
export function SwarmControl({ value, settingsWord, busy, onChoose }: SwarmControlProps) {
  const { t } = useTranslation();
  // A rung is `{ lanes }` so that All (`lanes: null`) can be told from "no rung yet" (`null`).
  const own = value === null ? null : { lanes: lanesOfWord(value) };
  const settings = settingsWord === null ? null : { lanes: lanesOfWord(settingsWord) };
  const shown = own ?? settings;
  const following = value === null;

  // Both presses are refused until Settings' word has arrived: it is what a press is compared with.
  const steps = settings === null || shown === null
    ? { down: null, up: null }
    : swarmLadderSteps(shown.lanes, swarmLadderTop(settings.lanes, shown.lanes));

  const press = (move: { lanes: number | null } | null) => {
    if (move === null || settings === null || busy) return;
    onChoose(choiceForLanes(move.lanes, settings.lanes));
  };

  return (
    <div
      className="inline-flex h-8 shrink-0 items-center gap-1.5"
      title={following ? t('dispatcher.swarm.hintDefault') : t('dispatcher.swarm.hint')}
      data-plan-swarm={value ?? 'auto'}
      data-plan-swarm-effective={value ?? settingsWord ?? ''}
      data-plan-swarm-default={following ? '' : undefined}
    >
      {/* The swarm mark, the settings row's `Network`: one shape names this switch on both surfaces. */}
      <span className="flex items-center text-muted-foreground" aria-hidden="true">
        <Network className="h-3.5 w-3.5 flex-none" />
      </span>
      <Stepper
        compact
        value={shown === null ? PENDING : shown.lanes === null ? t('dispatcher.swarm.all') : String(shown.lanes)}
        note={following && shown !== null ? t('dispatcher.swarm.default') : undefined}
        onDecrease={() => press(steps.down)}
        onIncrease={() => press(steps.up)}
        canDecrease={!busy && steps.down !== null}
        canIncrease={!busy && steps.up !== null}
        decreaseLabel={t('dispatcher.swarm.lanesDown')}
        increaseLabel={t('dispatcher.swarm.lanesUp')}
        ariaLabel={t('dispatcher.swarm.lanesLabel')}
      />
    </div>
  );
}
