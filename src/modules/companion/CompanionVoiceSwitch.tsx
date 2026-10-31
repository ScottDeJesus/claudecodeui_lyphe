import { Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Switch } from '@/shared/ui';

type CompanionVoiceSwitchProps = {
  /** Whether this page plays her voice: the page's own switch, stored per device and on by default. */
  on: boolean;
  /** Turns this page's voice on or off. */
  onChange: (on: boolean) => void;
};

/**
 * "Voice on this device": the switch that silences her on this page alone. Composed for this module's CompanionControls:
 * in the panel's row of its own under her controls (`rows`) and in the station head's line, beside Clear (`line`);
 * `.verify/kaylee-voice-scaffold.mjs` draws it on and off.
 *
 * Off, this page neither plays nor fetches her speech, so nothing is spent on it here, and her words still stream into the
 * log; every other device keeps its own switch. The words lead and the kit's Switch closes the row at its far end, under
 * Clear, so the eye reads the row as one setting. The speaker glyph before the words follows the position (sounding, or
 * struck through), so the state is never the switch's colour alone. The whole row is the label: a press anywhere on it
 * presses the switch, which carries the name; the words beside it are for the eye. No tooltip: unlike "Live", the words
 * say what it does.
 */
export function CompanionVoiceSwitch({ on, onChange }: CompanionVoiceSwitchProps) {
  const { t } = useTranslation();
  const label = t('companion.voice.label', { defaultValue: 'Voice on this device' });
  const Glyph = on ? Volume2 : VolumeX;

  return (
    // 44px tall under a finger (below 768 px, and on a touch screen of any width), Verve's touch floor, as the Live switch's label is.
    <label data-companion-voice={on ? 'on' : 'off'} className="flex w-full min-w-0 cursor-pointer items-center gap-2 max-md:min-h-11 [@media(pointer:coarse)]:min-h-11">
      <Glyph aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span aria-hidden="true" className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</span>
      <Switch checked={on} label={label} onChange={onChange} />
    </label>
  );
}
