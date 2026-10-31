import { Ear, EarOff } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { CompanionEars, CompanionEarsState } from '@/shared/types';
import { Switch } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionEarsSwitchProps = {
  /**
   * This page's ears, from the provider: the per-device switch (`on`, `setOn`), what they are doing while it is on (`state`),
   * and for `unavailable` the hook's own sentence (`reason`).
   */
  ears: CompanionEars;
  /** Her name as he set it, or the default while the picture loads: what her ears wait for, "Listening for Kaylee". */
  name: string;
};

/**
 * A press on the state's words is kept from the switch. They are for reading, and "Touch the page to let her listen" asks for
 * a press that must not turn her ears off: cancelling the click stops the label from handing it on to the switch, while the
 * touch itself (its pointerdown, all the ears wait for) still reaches the page.
 */
const keepFromSwitch = (event: MouseEvent) => event.preventDefault();

/**
 * "Listen for her name on this device": the switch that lets her ears listen on this page, and what they are doing, in words.
 * Composed for this module's CompanionControls: in the panel's row of its own under the voice row (`rows`) and in the station
 * head's line, beside the voice switch (`line`); `.verify/kaylee-ears-scaffold.mjs` draws it off and in each of its states.
 *
 * It is CompanionVoiceSwitch's pattern on the kit's Switch: the words lead and the switch closes the row at its far end, so the
 * eye reads the row as one setting; the ear before the words follows the position (`Ear` on, `EarOff` off), so the state is
 * never the switch's colour alone; and the whole row is the label, 44 px tall under a finger, so a press anywhere on it presses
 * the switch, which carries the name. Off, the row is the label and the switch alone, as the voice row is.
 *
 * On, the state's words stand under the label, past the ear, in the row's small muted type: "Listening for Kaylee", "Getting her
 * ears ready", "Touch the page to let her listen", "She listens on the page you last talked to her from", or "Listening" (her
 * name opened a recording, and the status line says Listening, then Transcribing, as for his button); for `unavailable`, the
 * hook's own sentence in the warn ink after the warn mark, ▲ in the ear's column, said as an alert, since it is news he must act
 * on. The words take no width of their own: they wrap under the label (a long word breaks), so the switch stands where the label
 * puts it whatever they say. They are not a press (`keepFromSwitch`), and the switch is centred on them and the label together.
 */
export function CompanionEarsSwitch({ ears, name }: CompanionEarsSwitchProps) {
  const { t } = useTranslation();
  const label = t('companion.ears.label', { defaultValue: 'Listen for her name on this device' });
  const Glyph = ears.on ? Ear : EarOff;
  // Every state's words, so a state added to `CompanionEarsState` without any fails to compile. `off` has none.
  const stateWords: Record<CompanionEarsState, string | null> = {
    off: null,
    waiting: t('companion.ears.waiting', { name, defaultValue: 'Listening for {{name}}' }),
    readying: t('companion.ears.readying', { defaultValue: 'Getting her ears ready' }),
    'needs-touch': t('companion.ears.needsTouch', { defaultValue: 'Touch the page to let her listen' }),
    elsewhere: t('companion.ears.elsewhere', { defaultValue: 'She listens on the page you last talked to her from' }),
    hearing: t('companion.ears.hearing', { defaultValue: 'Listening' }),
    // The hook always gives its sentence; the fallback only keeps an `unavailable` from standing wordless.
    unavailable: ears.reason ?? t('companion.ears.unavailable', { defaultValue: 'She can\'t listen on this page' }),
  };
  const words = ears.on ? stateWords[ears.state] : null;
  const unavailable = ears.state === 'unavailable';

  return (
    // 44px tall under a finger (below 768 px, and on a touch screen of any width), Verve's touch floor, as the voice row's label is;
    // there its own 6px above and below keep words of three lines and more as far from the row's edges as one or two lines stand.
    <label data-companion-ears={ears.on ? ears.state : 'off'} className="flex w-full min-w-0 cursor-pointer items-center gap-2 max-md:min-h-11 max-md:py-1.5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <Glyph aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span aria-hidden="true" className="min-w-0 text-xs font-medium text-foreground">{label}</span>
        </span>
        {words !== null && (
          // `w-0 min-w-full`: as wide as the label above it and no wider. Keyed, so the alert is a new node when it comes, which a
          // screen reader announces.
          <span
            key={unavailable ? 'alert' : 'state'}
            data-companion-ears-state=""
            role={unavailable ? 'alert' : undefined}
            data-tone={unavailable ? 'warn' : undefined}
            onClick={keepFromSwitch}
            className={cn('flex w-0 min-w-full cursor-default items-start gap-2 text-xs', unavailable ? 'text-tone-ink' : 'text-muted-foreground')}
          >
            {/* The ear's column (its 14 px, then the label's 8 px gap), so the words stand under the label's: for `unavailable` the
                warn mark, glyph and word as every warn text of hers has them and never the ink alone; empty for the rest. */}
            <span aria-hidden="true" className="w-3.5 shrink-0 text-center">{unavailable && '▲'}</span>
            {/* A name of one long word (forty letters fit in her name) breaks rather than run under the switch. */}
            <span className="min-w-0 break-words">{words}</span>
          </span>
        )}
      </span>
      <Switch checked={ears.on} label={label} onChange={ears.setOn} />
    </label>
  );
}
