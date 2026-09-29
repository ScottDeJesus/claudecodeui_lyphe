import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SWARM_FIRST_CEILING } from '@/shared/constants';
import { LANES_MIN } from '@/shared/hooks/useSwarmSwitch';
import { Button, Stepper } from '@/shared/ui';
import type { DispatcherSwarmChoice, DispatcherSwarmWord } from '@/shared/types';

/** The three options, in the order they are drawn: the box's switch, then the plan's own two words. */
const CHOICES = ['auto', 'off', 'on'] as const;

/** Which option a word presses: no word of its own is `auto`, and a ceiling is still `on`. */
type SwarmOption = (typeof CHOICES)[number];

/** Each option's words: its label and the sentence its `title` carries. */
const OPTION_WORDS: Record<SwarmOption, { label: string; title: string }> = {
  auto: { label: 'dispatcher.swarm.box', title: 'dispatcher.swarm.boxTitle' },
  off: { label: 'dispatcher.swarm.off', title: 'dispatcher.swarm.offTitle' },
  on: { label: 'dispatcher.swarm.on', title: 'dispatcher.swarm.onTitle' },
};

/** The option a plan's own word presses (`null` — no word of its own — is the box's). */
function optionOf(word: DispatcherSwarmWord | null): SwarmOption {
  if (word === null) return 'auto';
  return word === 'off' ? 'off' : 'on';
}

/** The ceiling an `on` word states: `null` for a bare `on` (no ceiling), N for `on <N>`. */
function lanesOf(word: DispatcherSwarmWord): number | null {
  return word === 'on' || word === 'off' ? null : Number(word.slice(3));
}

type SwarmControlProps = {
  /** The plan's OWN word as the last frame read it (`DispatcherPlan.swarm`), `null` when it follows the box. */
  value: DispatcherSwarmWord | null;
  /** The box's word as the same frame read it (`DispatcherRoute.swarm`), `null` before the first frame. */
  boxWord: DispatcherSwarmWord | null;
  /** A verb is in flight for this plan: every press is refused until it answers. */
  busy: boolean;
  /** Relays the chosen word. Never called for the option already pressed — a press that changes nothing spawns nothing. */
  onChoose: (choice: DispatcherSwarmChoice) => void;
};

/**
 * One plan's swarm word: Box · Off · On, and — while the plan's own word is On — its ceiling.
 *
 * `Box` hands the plan back to the box's switch (`dispatcher swarm <plan> auto`) and, while pressed,
 * WEARS THE BOX'S WORD (`Box · on 3`), so the reader sees what bounds the plan without opening
 * Settings. `Off` is one of this plan's phases at a time and `On` every independent one of them;
 * either bounds THIS plan's own phases in flight instead of the box's dial over every phase
 * (`width.reason`), and means the same on the Claude route as on DeepSeek's.
 *
 * THE CEILING IS THE SETTINGS ROW'S STEPPER (`RunnerModelContent`), on the same scale: `All` is the
 * top, `−` from it lands on `SWARM_FIRST_CEILING`, `−` stops at one, `+` on a count is unbounded and
 * `+` on `All` is refused, and the `All` press beside a count clears it. Every press is a word sent
 * whole (`on 3`), because the plan's word is one string in the store.
 *
 * NOTHING OPTIMISTIC, as `RunModelControl`: the pressed option and the count are the frame's own,
 * and a refused press leaves the control telling the truth with the dispatcher's sentence in a toast.
 *
 * The probe's handles: `data-plan-swarm` carries the plan's own word (`auto` for none),
 * `data-plan-swarm-effective` the word in force (the box's when on `Box`), and each option its
 * choice in `data-plan-swarm-choice`.
 *
 * Used by `PlanControls`, beside the plan's model control at the end of the card's `ActionBar`.
 */
export function SwarmControl({ value, boxWord, busy, onChoose }: SwarmControlProps) {
  const { t } = useTranslation();
  const pressed = optionOf(value);
  const lanes = value === null || value === 'off' ? null : lanesOf(value);
  const effective = value ?? boxWord;
  const label = t('dispatcher.swarm.label');

  return (
    <div
      className="inline-flex h-8 shrink-0 items-center gap-1.5"
      data-plan-swarm={value ?? 'auto'}
      data-plan-swarm-effective={effective ?? ''}
    >
      <div
        role="group"
        aria-label={label}
        title={t('dispatcher.swarm.hint')}
        className="inline-flex h-8 items-stretch gap-0.5 rounded-md border border-border p-0.5"
      >
        {/* The swarm mark, the settings row's `Network`: one shape names this switch on both surfaces. */}
        <span className="flex items-center px-1 text-muted-foreground" aria-hidden="true">
          <Network className="h-3.5 w-3.5 flex-none" />
        </span>
        {CHOICES.map((choice) => {
          const isPressed = choice === pressed;
          const words = OPTION_WORDS[choice];
          const text = choice === 'auto' && isPressed && boxWord !== null
            ? t('dispatcher.swarm.boxWord', { word: boxWord })
            : t(words.label);
          return (
            <Button
              key={choice}
              type="button"
              variant={isPressed ? 'secondary' : 'ghost'}
              size="sm"
              className="h-full px-2 text-xs"
              aria-pressed={isPressed}
              disabled={busy}
              title={t(words.title)}
              onClick={() => {
                if (!isPressed) onChoose(choice);
              }}
              data-plan-swarm-choice={choice}
            >
              {text}
            </Button>
          );
        })}
      </div>
      {pressed === 'on' && (
        <Stepper
          compact
          value={lanes === null ? t('dispatcher.swarm.all') : String(lanes)}
          onDecrease={() => onChoose(`on ${lanes === null ? SWARM_FIRST_CEILING : lanes - 1}`)}
          onIncrease={() => {
            if (lanes !== null) onChoose(`on ${lanes + 1}`);
          }}
          canDecrease={!busy && (lanes === null || lanes > LANES_MIN)}
          canIncrease={!busy && lanes !== null}
          decreaseLabel={t('dispatcher.swarm.lanesDown')}
          increaseLabel={t('dispatcher.swarm.lanesUp')}
          ariaLabel={t('dispatcher.swarm.lanesLabel')}
        />
      )}
      {lanes !== null && (
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={busy}
          title={t('dispatcher.swarm.allTitle')} onClick={() => onChoose('on')} data-plan-swarm-all>
          {t('dispatcher.swarm.all')}
        </Button>
      )}
    </div>
  );
}
