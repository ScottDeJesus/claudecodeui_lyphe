import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionComposer, CompanionTalkButton, useCompanion } from '@/modules/companion';
import { useStationTalkFiles, useStationTalkText } from '@/modules/station/context/StationContext';
import type { StationDensity, StationRegionProps, TalkPress } from '@/shared/types';

/**
 * Which halves of the talk control a drawing holds: `both` (the scene's dock), the talk button alone (`button`: the compact
 * arrangement's head) or the typing box alone (`composer`: the compact arrangement's Conversation section, and the phone's).
 */
type TalkPart = 'both' | 'button' | 'composer';

type StationTalkViewProps = {
  /** `compact`: the talk button 44 px tall, its words kept. The box is the same at both. */
  density: StationDensity;
  /** Which halves to draw; `both` when absent. The two halves are one press and one box wherever they stand. */
  part?: TalkPart;
  /** The page's one talk press (the provider's `talk`): the button's look, its press, and what failed with the last one. */
  talk: TalkPress;
  /** Her name as he set it, the default while her picture loads: "Talk to Kaylee", the box's placeholder. */
  name: string;
  /** The key or mouse button he bound to the press ("F8", "Mouse back"); null when none is. */
  bindingLabel: string | null;
  /** Sends what he typed and the files he attached; a refusal rejects, and the box puts his words and his files back. */
  onSend: (text: string, files: File[]) => Promise<void>;
  /** False while her picture loads: there is nobody to send to yet. */
  ready: boolean;
  /** The words he has typed in the box, held by the station (with `onText`, given together) so they outlive the arrangement's tree. Absent on a fixture: the box keeps its own. */
  text?: string;
  /** A change of the typed words. Given with `text`. */
  onText?: Dispatch<SetStateAction<string>>;
  /** The files he has attached and not sent, held by the station (with `onAttachedFiles`, given together) for the same reason. Absent on a fixture: the box keeps its own. */
  attachedFiles?: File[];
  /** A change of the attached files. Given with `attachedFiles`. */
  onAttachedFiles?: Dispatch<SetStateAction<File[]>>;
};

/**
 * THE TALK CONTROL: the large tap-to-talk button and the box to type to the companion, both the companion module's own, drawn
 * through its barrel.
 *
 * THE BUTTON is `CompanionTalkButton` at `size: 'large'`, the page's one press — the same as the key or mouse button you bind in
 * Settings: "Talk to Kaylee" idle, lit with "Stop and send" while listening, the spinner and "Transcribing · press to talk again"
 * while it turns, and a press while the companion speaks cuts it off. Its line names the bound control ("or press F8") or says
 * "Bind a key in Settings", and what failed with the last press stands in that line's place. THE BOX is `CompanionComposer` given
 * no `talk`, so it draws no second talk button: Enter sends, Shift+Enter breaks the line, a refused send puts the words back.
 *
 * IN THE SCENE'S DOCK (`both`) one row: the button's cell, 12rem so its longest words wrap to two lines and no further, and the
 * box taking the rest, their tops in line. The width does not move as the words change. The button is 56 px tall at full density,
 * past the touch law's 44 px, and 44 px at compact; the box's send keeps the panel's 44 px catch, and its field stands 44 px below
 * 768 px (`touchField`), so a finger lands on it too. While the companion's picture is read (`ready` false) the line under the
 * button stands empty: the settings, and so the key you bound, are not known yet.
 *
 * ONE HALF (`part`): the button alone fills the box its caller gives it, with no padding of its own (the compact head places
 * it); the box alone is `CompanionComposer` as in the row, padding itself. Each is still the page's one press and one box.
 *
 * YOUR TYPED WORDS AND YOUR FILES are the station's (`text` and `onText`, `attachedFiles` and `onAttachedFiles`, which `StationTalk`
 * binds to the provider's), not the box's: pressing the bar's Compact switch mounts another arrangement's tree and its own box, and
 * the words and the chips stand in it. The box draws a paperclip first in its tools, so the files go with your words as in a chat.
 *
 * `data-station-talk` reads the press's state and `data-station-talk-part` the halves drawn. A pure view: `StationTalk` below
 * binds it, and the fixtures draw it on `fake/talk.ts`'s pictures.
 */
export function StationTalkView({ density, part = 'both', talk, name, bindingLabel, onSend, ready, text, onText, attachedFiles, onAttachedFiles }: StationTalkViewProps) {
  const button = (
    <CompanionTalkButton
      size="large"
      compact={density === 'compact'}
      state={talk.state}
      error={talk.error}
      onToggle={talk.toggle}
      name={name}
      bindingLabel={ready ? bindingLabel : undefined}
    />
  );
  // Inside the station's frame, which clears the home indicator itself: the box pads nothing more for it.
  const composer = (
    <CompanionComposer
      name={name}
      ready={ready}
      visible
      onSend={onSend}
      touchField
      atScreenFoot={false}
      text={text}
      onText={onText}
      attachedFiles={attachedFiles}
      onAttachedFiles={onAttachedFiles}
    />
  );

  if (part !== 'both') {
    return (
      <div data-station-talk={talk.state} data-station-talk-part={part} className="min-w-0 bg-background">
        {part === 'button' ? button : composer}
      </div>
    );
  }

  return (
    <div data-station-talk={talk.state} data-station-talk-part="both" className="flex min-w-0 items-start">
      {/* The composer pads itself (12 px across, 8 px over its box): the button's cell matches it, so the two tops meet. */}
      <div className="w-48 min-w-0 shrink-0 pb-2 pt-2">
        {button}
      </div>
      <div className="min-w-0 flex-1">{composer}</div>
    </div>
  );
}

/**
 * The talk control on the page, the `talk` slot's region (`stationRegions.ts`): it hands `StationTalkView` the page's one
 * press, the label of the key or mouse button bound to it, and the provider's `sendText`. It adds no state of its own: the
 * bound key and mouse button reach the same press through the provider's `useTalkBinding`. `part` passes through: the compact
 * arrangement draws this one region twice, its button in her head and its box in the Conversation section. The words he types in
 * the box and the files he attaches are the station provider's (`useStationTalkText`, `useStationTalkFiles`), handed through the view to
 * the composer; `sendText` uploads the files before it posts.
 */
export function StationTalk({ density, part }: StationRegionProps & { part?: TalkPart }) {
  const { t } = useTranslation();
  const { picture, talk, sendText } = useCompanion();
  const [text, setText] = useStationTalkText();
  const [attachedFiles, setAttachedFiles] = useStationTalkFiles();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return (
    <StationTalkView
      density={density}
      part={part}
      talk={talk}
      name={name}
      bindingLabel={picture?.settings.talkBinding?.label ?? null}
      // `sendText` unlocks the page's audio as the first press does (MAN-9113).
      onSend={sendText}
      ready={picture !== null}
      text={text}
      onText={setText}
      attachedFiles={attachedFiles}
      onAttachedFiles={setAttachedFiles}
    />
  );
}
