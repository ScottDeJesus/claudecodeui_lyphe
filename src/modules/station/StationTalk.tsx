import { useTranslation } from 'react-i18next';

import { CompanionComposer, CompanionTalkButton, useCompanion } from '@/modules/companion';
import type { StationRegionProps, StationTier, TalkPress } from '@/shared/types';
import { cn } from '@/shared/utils';

type StationTalkViewProps = {
  /** The arrangement: the talk button and the typing box in one row on a wide or laptop screen, stacked below. */
  tier: StationTier;
  /** The page's one talk press (the provider's `talk`): the button's look, its press, and what failed with the last one. */
  talk: TalkPress;
  /** Her name as he set it, the default while her picture loads: "Talk to Kaylee", the box's placeholder. */
  name: string;
  /** The key or mouse button he bound to the press ("F8", "Mouse back"); null when none is. */
  bindingLabel: string | null;
  /** Sends what he typed; a refusal rejects, and the box puts his words back. */
  onSend: (text: string) => Promise<void>;
  /** False while her picture loads: there is nobody to send to yet. */
  ready: boolean;
};

/**
 * THE TALK CONTROL, at the foot of her column: the large tap-to-talk button and the box to type to her, both the companion
 * module's own, drawn through its barrel.
 *
 * THE BUTTON is `CompanionTalkButton` at `size: 'large'`, the page's one press — the same as the key or mouse button he binds
 * in Settings: "Talk to Kaylee" idle, lit with "Stop and send" while Listening, the spinner and "Transcribing · press to talk
 * again" while it turns, and a press while she speaks cuts her off. Its line names the bound control ("or press F8") or says
 * "Bind a key in Settings", and what failed with the last press stands in that line's place. THE BOX is `CompanionComposer`
 * given no `talk`, so it draws no second talk button: Enter sends, Shift+Enter breaks the line, a refused send puts the words back.
 *
 * WIDE AND LAPTOP: one row, the button's cell and the box taking the rest, their tops in line. In her 420 px column (1440 px)
 * the cell is 12rem and the line stands under the button: the button's longest words ("Transcribing · press to talk again")
 * wrap to two lines and no further, and the box keeps "Message Kaylee…" on one. Where her column is at least 38rem across (a
 * laptop at 1152 px and up; the container `her`), the cell is 22rem and the line stands beside the button, so the row is the
 * button's 76 px, not 106, and her conversation has those 30 px: her column at a laptop's height has none to spare. The width
 * does not move as the words change. NARROW: the button across the column, the box under it.
 * The button is 56 px tall at every width, past the touch law's 44 px; the box's send keeps the panel's 44 px catch, and its
 * field stands 44 px below 768 px (`touchField`; its words still one line), so a finger lands on it too. While her picture is
 * read (`ready` false) the line under the button stands empty: her settings, and so the key he bound, are not known yet.
 *
 * `data-station-talk` reads the press's state. A pure view: `StationTalk` below binds it, and `.verify/kaylee-station-shots.mjs`
 * draws it on `fake/talk.ts`'s pictures.
 */
export function StationTalkView({ tier, talk, name, bindingLabel, onSend, ready }: StationTalkViewProps) {
  const row = tier !== 'narrow';

  return (
    <div data-station-talk={talk.state} className={cn('flex min-w-0 bg-background', row ? 'items-start' : 'flex-col')}>
      {/* The composer pads itself (12 px across, 8 px over its box): the button's cell matches it, so the two tops meet. */}
      <div className={cn('min-w-0 pt-2', row ? 'w-48 shrink-0 pb-3 pl-3 [@container_her_(min-width:38rem)]:w-[22rem]' : 'px-3')}>
        <CompanionTalkButton
          size="large"
          state={talk.state}
          error={talk.error}
          onToggle={talk.toggle}
          name={name}
          bindingLabel={ready ? bindingLabel : undefined}
        />
      </div>
      <div className="min-w-0 flex-1">
        <CompanionComposer name={name} ready={ready} visible onSend={onSend} touchField />
      </div>
    </div>
  );
}

/**
 * The talk control on the page, the `talk` slot's region (`stationRegions.ts`): it hands `StationTalkView` the page's one
 * press, the label of the key or mouse button bound to it, and the provider's `sendText`. It adds no state of its own: the
 * bound key and mouse button reach the same press through the provider's `useTalkBinding`.
 */
export function StationTalk({ tier }: StationRegionProps) {
  const { t } = useTranslation();
  const { picture, talk, sendText } = useCompanion();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return (
    <StationTalkView
      tier={tier}
      talk={talk}
      name={name}
      bindingLabel={picture?.settings.talkBinding?.label ?? null}
      // `sendText` unlocks the page's audio as the first press does (MAN-9113).
      onSend={sendText}
      ready={picture !== null}
    />
  );
}
