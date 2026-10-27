import { AudioLines } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { RAIL_BUTTON_BASE, RAIL_BUTTON_LIT, RAIL_BUTTON_UNLIT } from '@/shared/constants';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionDoorViewProps = {
  /** Whether her panel is open: the door is lit, and says it is expanded. */
  open: boolean;
  /** Her name as he set it; null while the page has not read it, and the default stands in. */
  name: string | null;
  onPress: () => void;
};

/**
 * Her door in the views rail, drawn: one rail button — RailButton's size and feel from the shared rail constants, a 20px
 * glyph at stroke 1.75 in a 40px square (44px below md) — holding her mark, the same waveform that marks a brief sent
 * "Through Kaylee" in a chat. Lit while her panel is open, in the rail's one lit look (`RAIL_BUTTON_LIT`); the open
 * state reaches a reader as `aria-expanded`, since the door opens a panel and is no page of the rail.
 *
 * Its name is hers, "Kaylee" as he set it, with `aria-expanded`: a door that opens and closes her panel is named for
 * what it shows, as the rail's views are, never for an action ("Talk to Kaylee" is her panel's talk button, which opens
 * the mic). Every word is a `t()` with a default, because the door stands in the rail before anything else of hers
 * loads. The name rides the kit Tooltip on hover and keyboard focus.
 * `data-companion-door` is what her panel hands focus back to when it closes from the keyboard.
 *
 * Exported for this file's CompanionDoorButton and for `.verify/companion-panel-scaffold.mjs`, which draws it lit and
 * unlit in the live rail.
 */
export function CompanionDoorView({ open, name, onPress }: CompanionDoorViewProps) {
  const { t } = useTranslation();
  const her = name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const label = t('companion.door.label', { defaultValue: '{{name}}', name: her });

  return (
    <Tooltip position="right" showOnFocus content={label}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        data-companion-door=""
        onClick={onPress}
        className={cn(RAIL_BUTTON_BASE, open ? RAIL_BUTTON_LIT : RAIL_BUTTON_UNLIT)}
      >
        <AudioLines aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}

/**
 * Her door on the page: what WorkspaceRail renders in its foot, just above the Inbox. It reads the open state and her
 * name from the companion's provider and toggles the panel; CompanionDoorView draws it.
 */
export function CompanionDoorButton() {
  const { picture, open, setOpen } = useCompanion();

  return <CompanionDoorView open={open} name={picture?.settings.name ?? null} onPress={() => setOpen(!open)} />;
}
