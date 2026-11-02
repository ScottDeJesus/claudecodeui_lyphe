import { Clock, ImageMinus, ImageUp, LayoutGrid, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionAvatar } from '@/modules/companion/CompanionAvatar';
import { useCompanionFaceSettings } from '@/modules/companion/hooks/useCompanionFaceSettings';
import type { CompanionFace, CompanionFaceAvatar, CompanionFaceBake } from '@/shared/companion-types';
import type { CompanionPresence } from '@/shared/types';
import { Banner, Button, ConfirmDialog, Lightbox, Meter, SegmentedControl, SettingRow, SettingsCard, WholeWords } from '@/shared/ui';

type CompanionFaceSettingsViewProps = {
  /** The account's face as the card last read it: the face drawn now (`id`, the pick's), the look he picked (`avatar`) and the looks he may wear (`avatars`), each with its making in `bake`. */
  face: CompanionFace;
  /** Her portrait, idle, filling the card's 96px square: this module's CompanionAvatar on `face.id`, her initial while no face is drawn. */
  portrait: ReactNode;
  /** His photo is on its way to the server: Upload a photo turns its glyph into the waiting ring and refuses a second press. */
  uploading: boolean;
  /** Why the server refused his last photo (a 400's sentence), drawn under the buttons in place of the helper; null when none was. */
  refusal: string | null;
  /** Why the server refused his last pick (a 400's sentence: no look of that name, or one not made yet), drawn under the buttons; null when none was. */
  pickRefusal: string | null;
  /** The contact sheet's address (an object URL) while every frame is shown; null while the lightbox is shut. */
  contactUrl: string | null;
  /** The contact sheet is being fetched for the lightbox: See every frame turns its glyph into the waiting ring and refuses a second press. */
  framesOpening: boolean;
  /** The photo he chose, one JPEG, PNG or WebP: sent to be made into Your photo, in place of an earlier one. */
  onUpload: (file: File) => void;
  /** A look was chosen on the switch, by its `key`: once the server has stored it, she wears it on every page of his account. */
  onPick: (avatar: string) => void;
  /** Called from the confirm alone, never from the press that asks: his photo, and the face made from it or being made, go; a pick of it goes back to the default. */
  onRemove: () => void;
  /** See every frame was pressed: the contact sheet of the pick's face is fetched (`framesOpening` while it is out), and its address becomes `contactUrl`. */
  onSeeFrames: () => void;
  /** The lightbox was closed (Escape, its ✕ or the backdrop): `contactUrl` goes back to null. */
  onCloseFrames: () => void;
};

/** A look whose making the band shows: waiting, being made, or failed. */
type LookInMaking = CompanionFaceAvatar & { bake: CompanionFaceBake };

/** The `key` of his photo among a face's `avatars`: the one look the card removes. */
const OWN_AVATAR_KEY = 'own';

/** The switch is drawn while this many looks are made: with fewer there is nothing to choose between. */
const LOOKS_TO_SWITCH = 2;

/** The photos the face maker takes: the chooser offers these kinds and no other. */
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';

/** The portrait on the card is at rest: she is doing nothing, and has no session, files or walk to show. One object, so the portrait is never handed a new presence by a render. */
const IDLE_PRESENCE: CompanionPresence = { state: 'idle', session: null, files: null, walk: null };

/** The card's portrait fills its 96px square. */
const PORTRAIT_SIZE_PX = 96;

/** Under a finger every button is Verve's 44px touch floor; a mouse keeps the section's small buttons. The switch's options carry the floor themselves (data.css). */
const TOUCH_FLOOR = '[@media(pointer:coarse)]:min-h-11';

const isInMaking = (look: CompanionFaceAvatar): look is LookInMaking => look.bake !== null;

/**
 * Settings > Voice > Companion's "Her face": the look she wears, the looks he can switch her to, and the one he makes from a
 * photo of his. Exported for this file's CompanionFaceSettings and for `.verify/kaylee-face-card.mjs`, which draws each state
 * in its place: after the talk button's card, above her memory card and her four fields.
 *
 * ONE CARD: the pick's portrait at 96px (idle, as it moves on every page), "Her face" and the line under it, the picked
 * look's label, as the kit's SettingRow label and description; then the switch, the buttons and the lines under them. From a
 * 30rem card the portrait stands left of everything; narrower, the rest takes the card's width under the portrait's row.
 *
 * THE SWITCH is the kit's SegmentedControl named "Her face": the looks whose faces are made, in the server's order, the pick
 * chosen; drawn while two or more are made. A pick is instant and reversible, so the card
 * draws the pick's portrait alone and decodes no other; a look not made yet is a row of the band, not an option.
 *
 * THE BUTTONS. Upload a photo presses a hidden file input taking one JPEG, PNG or WebP. See every frame, offered while a face
 * is drawn, opens the pick's contact sheet in the kit's Lightbox, in the top layer above Settings. Each turns its glyph and
 * refuses a second press while its request is out. Remove your photo, offered while he has one (made, being made or
 * failed), asks first in a ConfirmDialog raised over the Settings modal, saying where a pick of his photo goes back to.
 * Under a finger every button is 44px tall, Verve's touch floor. Under the buttons, amber with the ▲ and announced, stand a
 * refused pick's sentence and a refused upload's (in place of the helper, which describes Upload a photo), each hyphenated
 * word held whole (WholeWords).
 *
 * THE BAND at the card's foot: one row per look with a making, in the server's order — a Meter while it is made ("Making
 * Brown hair", "37 of 115 frames", and "Her current face stays until it is ready." where that face will become hers), its
 * clock line while queued, and once failed a warn Banner, "<label> wasn't made." leading the server's sentence.
 *
 * WHAT IS ANNOUNCED. The line is a polite region, so a switch of look is said. One more, for a screen reader alone, holds
 * each row's state in words, never its frame count: not atomic, so a row is said when its state changes or it arrives, and
 * the words a card opens with are not. A control that leaves the page (Remove once his photo is gone, the switch once one
 * look is left) hands focus that fell with it to Upload a photo. The probes read the root's `data-companion-face` (the drawn
 * look's key, `none` while no face is drawn) and each band row's `data-companion-face-row` (its key) and `-bake` (its state).
 */
export function CompanionFaceSettingsView({ face, portrait, uploading, refusal, pickRefusal, contactUrl, framesOpening, onUpload, onPick, onRemove, onSeeFrames, onCloseFrames }: CompanionFaceSettingsViewProps) {
  const { t } = useTranslation('settings');
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  // Whether Remove's question is up: the question is the press's first half, so his photo is never removed by one slip.
  const [confirming, setConfirming] = useState(false);

  // The look the portrait draws: the pick whose face is drawn, else the look whose face is (the server draws another for a pick
  // it cannot draw), else, while no face is drawn, the pick. Two looks may share a face (his upload of a house photo).
  const drawnLooks = face.avatars.filter((look) => look.faceId !== null && look.faceId === face.id);
  const worn = drawnLooks.find((look) => look.key === face.avatar) ?? drawnLooks[0] ?? face.avatars.find((look) => look.key === face.avatar) ?? null;
  // The looks whose faces are made, in the server's order (the house's, then his photo): the switch's options.
  const made = face.avatars.filter((look) => look.faceId !== null);
  const switchable = made.length >= LOOKS_TO_SWITCH;
  const inMaking = face.avatars.filter(isInMaking);
  const removable = face.avatars.some((look) => look.key === OWN_AVATAR_KEY);
  // The house's first look, every account's default: what a pick of his photo goes back to when it is removed.
  const fallback = face.avatars.find((look) => look.key !== OWN_AVATAR_KEY) ?? null;
  // Whether Remove and the switch were drawn when focus last followed the card: only a control leaving moves focus, so a card that mounts takes none.
  const followed = useRef({ removable, switchable });

  // The question asks about his photo: once nothing of it is left (removed here or on another page), it is put away, so a
  // later upload never reopens it. Set while rendering, which React re-runs at once.
  if (confirming && !removable) setConfirming(false);

  // A control that left the page took focus with it (the closing question hands focus back to Remove, which is gone):
  // focus that fell to the page goes to Upload a photo. Focus he put somewhere else stays there.
  useEffect(() => {
    const was = followed.current;
    followed.current = { removable, switchable };
    const left = (was.removable && !removable) || (was.switchable && !switchable);
    if (left && (document.activeElement === null || document.activeElement === document.body)) uploadRef.current?.focus({ preventScroll: true });
  }, [removable, switchable]);

  // The chooser's one photo goes out. The input is emptied first, so choosing the same file again (after a refusal or a
  // removal) is still a change and still sent.
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(file);
  };

  const title = t('voiceSettings.companion.face.title', { defaultValue: 'Her face' });
  // The line names the look the portrait draws; while no face is drawn yet (a fresh box, her initial), it says so.
  const line = worn === null ? t('voiceSettings.companion.face.noneAtAll', { defaultValue: "Her face isn't made yet." })
    : face.id === null ? t('voiceSettings.companion.face.none', { label: worn.label, defaultValue: "{{label}} isn't made yet." }) : worn.label;
  const framesLabel = t('voiceSettings.companion.face.framesLabel', { defaultValue: 'Every frame of her face' });
  const removeMessage = t('voiceSettings.companion.face.removeMessage', { defaultValue: 'The face made from it is removed.' })
    + (face.avatar === OWN_AVATAR_KEY && fallback !== null ? ` ${t('voiceSettings.companion.face.removeBack', { label: fallback.label, defaultValue: 'She goes back to {{label}}.' })}` : '');

  // A look's making in words for its row and the polite region, never a frame count; a failure leads with its look's name (the server's sentences name none).
  const failedLead = (label: string) => t('voiceSettings.companion.face.failed', { label, defaultValue: "{{label}} wasn't made." });
  const makingWords = ({ label, bake }: LookInMaking) => (bake.state === 'failed' ? `${failedLead(label)} ${bake.error}`
    : bake.state === 'queued' ? t('voiceSettings.companion.face.queued', { label, defaultValue: '{{label}} waits for another face to finish.' })
      : t('voiceSettings.companion.face.making', { label, defaultValue: 'Making {{label}}' }));

  const makingRow = (look: LookInMaking) => {
    const { bake } = look;
    if (bake.state === 'failed') return <Banner tone="warn"><span className="font-medium">{failedLead(look.label)}</span> <WholeWords>{bake.error}</WholeWords></Banner>;
    if (bake.state === 'queued') {
      return (
        <p className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
          <Clock aria-hidden="true" className="size-3.5 shrink-0" />
          {makingWords(look)}
        </p>
      );
    }
    return (
      <Meter
        percent={bake.total > 0 ? (bake.done / bake.total) * 100 : null}
        label={makingWords(look)}
        value={t('voiceSettings.companion.face.progress', { done: bake.done, total: bake.total, defaultValue: '{{done}} of {{total}} frames' })}
        // Only a face that will become hers keeps her current one until it is ready: his photo's (the pick once made), or the worn look's made again.
        sub={face.id !== null && (look.key === OWN_AVATAR_KEY || look.key === face.avatar) ? t('voiceSettings.companion.face.stays', { defaultValue: 'Her current face stays until it is ready.' }) : undefined}
      />
    );
  };

  // A refusal under the buttons, amber with the ▲ and announced, as the section's other refusals are.
  const refused = (sentence: string) => (
    <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
      <span aria-hidden="true">▲ </span>
      <WholeWords>{sentence}</WholeWords>
    </span>
  );

  return (
    <div data-companion-face={face.id === null ? 'none' : (worn?.key ?? face.avatar)}>
      <SettingsCard className="[container-type:inline-size]">
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-4 [@container(min-width:30rem)]:grid-rows-[auto_1fr] [@container(min-width:30rem)]:items-start">
          <div data-companion-face-portrait="" className="size-24 [@container(min-width:30rem)]:row-span-2">{portrait}</div>
          <SettingRow
            label={<span data-companion-face-title="">{title}</span>}
            description={<span role="status" data-companion-face-line="">{line}</span>}
            className="min-w-0 p-0"
          >
            {null}
          </SettingRow>
          <div className="col-span-2 min-w-0 space-y-3 [@container(min-width:30rem)]:col-span-1 [@container(min-width:30rem)]:col-start-2">
            {switchable && (
              <div data-companion-face-switch="">
                {/* The look she wears already is no pick: a press on it sends nothing. */}
                <SegmentedControl label={title} options={made.map((look) => ({ value: look.key, label: look.label }))} value={face.avatar} onChange={(key) => { if (key !== face.avatar) onPick(key); }} />
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={inputRef} type="file" accept={PHOTO_TYPES} className="hidden" tabIndex={-1} aria-hidden="true" data-companion-face-input="" onChange={choose} />
                <Button ref={uploadRef} variant="outline" size="sm" busy={uploading} aria-describedby={helpId} data-companion-face-upload="" onClick={() => inputRef.current?.click()} className={TOUCH_FLOOR}>
                  {uploading ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <ImageUp aria-hidden="true" />}
                  {t('voiceSettings.companion.face.upload', { defaultValue: 'Upload a photo' })}
                </Button>
                {face.id !== null && (
                  <Button variant="outline" size="sm" busy={framesOpening} data-companion-face-frames="" onClick={onSeeFrames} className={TOUCH_FLOOR}>
                    {framesOpening ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <LayoutGrid aria-hidden="true" />}
                    {t('voiceSettings.companion.face.frames', { defaultValue: 'See every frame' })}
                  </Button>
                )}
                {removable && (
                  <Button variant="ghost" size="sm" data-companion-face-remove="" onClick={() => setConfirming(true)} className={`text-muted-foreground hover:text-foreground ${TOUCH_FLOOR}`}>
                    <ImageMinus aria-hidden="true" />
                    {t('voiceSettings.companion.face.remove', { defaultValue: 'Remove your photo' })}
                  </Button>
                )}
              </div>
              <div className="mt-2 space-y-1 text-pretty text-xs leading-relaxed">
                {pickRefusal !== null && <p data-companion-face-pick-refusal="">{refused(pickRefusal)}</p>}
                <p id={helpId} data-companion-face-help={refusal === null ? 'help' : 'refused'} className="text-muted-foreground">
                  {refusal === null ? t('voiceSettings.companion.face.help', { defaultValue: 'A JPEG, PNG or WebP where her face is clear, facing forward and not cut off.' }) : refused(refusal)}
                </p>
              </div>
            </div>
          </div>
        </div>
        {inMaking.length > 0 && (
          <div data-companion-face-making="" className="space-y-4 border-t border-border px-4 py-3">
            {inMaking.map((look) => <div key={look.key} data-companion-face-row={look.key} data-companion-face-bake={look.bake.state}>{makingRow(look)}</div>)}
          </div>
        )}
        <div role="status" aria-atomic="false" data-companion-face-announce="" className="sr-only">
          {inMaking.map((look) => <p key={look.key}>{makingWords(look)}</p>)}
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirming && removable}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={t('voiceSettings.companion.face.removeTitle', { defaultValue: 'Remove your photo?' })}
        message={removeMessage}
        actions={[
          { label: t('voiceSettings.companion.face.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirming(false) },
          { label: t('voiceSettings.companion.face.removeConfirm', { defaultValue: 'Remove your photo' }), variant: 'destructive', onSelect: () => { setConfirming(false); onRemove(); } },
        ]}
        onDismiss={() => setConfirming(false)}
      />

      {contactUrl !== null && (
        <Lightbox label={framesLabel} onClose={onCloseFrames}>
          <img src={contactUrl} alt={framesLabel} draggable={false} data-companion-face-contact="" className="block max-h-[88vh] max-w-[92vw] rounded-lg shadow-2xl" />
        </Lightbox>
      )}
    </div>
  );
}

type CompanionFaceSettingsProps = {
  /** Her name as he set it: the portrait's accessible name. */
  name: string;
  /**
   * The account's face as the section's one read of her picture carried it (`GET /api/companion`, the read that brings her
   * settings). The section mounts the card only once it is known, so the card never draws a face it has not read and
   * makes no read of its own; a read that failed is the section's own banner.
   */
  face: CompanionFace;
};

/**
 * Her face card on the page: what this module's CompanionSettingsSection passes into CompanionSettingsView's `face`
 * slot, with her name and the face its read carried. From that face it follows the account's `companion_face` frames,
 * picks the look she wears, uploads his photo, removes it and fetches the contact sheet; CompanionFaceSettingsView draws it.
 */
export function CompanionFaceSettings({ name, face }: CompanionFaceSettingsProps) {
  const { face: current, uploading, framesOpening, refusal, pickRefusal, contactUrl, pick, upload, remove, seeFrames, closeFrames } = useCompanionFaceSettings(face);

  return (
    <CompanionFaceSettingsView
      face={current}
      // An idle presence, no voice, no sentences and no look: the portrait blinks and glances, and a switch of face reaches it through the atlas cache it shares with her button.
      portrait={<CompanionAvatar presence={IDLE_PRESENCE} faceId={current.id} voice={null} sentences={null} look={null} name={name} size={PORTRAIT_SIZE_PX} />}
      uploading={uploading}
      framesOpening={framesOpening}
      refusal={refusal}
      pickRefusal={pickRefusal}
      contactUrl={contactUrl}
      onUpload={(file) => void upload(file)}
      onPick={(avatar) => void pick(avatar)}
      onRemove={() => void remove()}
      onSeeFrames={() => void seeFrames()}
      onCloseFrames={closeFrames}
    />
  );
}
