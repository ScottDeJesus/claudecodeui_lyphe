import { Clock, ImageUp, LayoutGrid, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionAvatar } from '@/modules/companion/CompanionAvatar';
import { useCompanionFaceSettings } from '@/modules/companion/hooks/useCompanionFaceSettings';
import type { CompanionFace } from '@/shared/companion-types';
import type { CompanionPresence } from '@/shared/types';
import { Banner, Button, ConfirmDialog, Lightbox, Meter, SettingRow, SettingsCard, WholeWords } from '@/shared/ui';

type CompanionFaceSettingsViewProps = {
  /** The account's face as the card last read it: the face drawn now (`id`, and `original` for whose it is) and the making of his upload (`bake`). */
  face: CompanionFace;
  /** Her portrait, idle, filling the card's 96px square: this module's CompanionAvatar on `face.id`, her initial while no face is drawn. */
  portrait: ReactNode;
  /** His photo is on its way to the server: Upload a photo turns its glyph into the waiting ring and refuses a second press. */
  uploading: boolean;
  /** Why the server refused his last photo (a 400's sentence), drawn under the upload button in place of its helper; null when none was. */
  refusal: string | null;
  /** The contact sheet's address (an object URL) while every frame is shown; null while the lightbox is shut. */
  contactUrl: string | null;
  /** The contact sheet is being fetched for the lightbox: See every frame turns its glyph into the waiting ring and refuses a second press. */
  framesOpening: boolean;
  /** The photo he chose, one JPEG, PNG or WebP: sent to be made into her face. */
  onUpload: (file: File) => void;
  /** Called from the confirm alone, never from the press that asks: his photo, and the face made from it or being made, go; the original stays or comes back. */
  onRestore: () => void;
  /** See every frame was pressed: the contact sheet of the face drawn now is fetched (`framesOpening` while it is out), and its address becomes `contactUrl`. */
  onSeeFrames: () => void;
  /** The lightbox was closed (Escape, its ✕ or the backdrop): `contactUrl` goes back to null. */
  onCloseFrames: () => void;
};

/** The photos the face maker takes: the chooser offers these kinds and no other. */
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';

/** The portrait on the card is at rest: she is doing nothing, and has no session, files or walk to show. One object, so the portrait is never handed a new presence by a render. */
const IDLE_PRESENCE: CompanionPresence = { state: 'idle', session: null, files: null, walk: null };

/** The card's portrait fills its 96px square. */
const PORTRAIT_SIZE_PX = 96;

/**
 * Settings > Voice > Companion's "Her face": the face her pages draw, whose it is, and how he swaps it for one made from a
 * photo of his. Exported for this file's CompanionFaceSettings and for `.verify/kaylee-face-card.mjs`, which draws each
 * state in its place: after the talk button's card, above her memory card and her four fields.
 *
 * ONE CARD, her portrait leading it at 96px (idle, as it moves on every page), "Her face" beside it and the line that
 * says whose face it is: "The original face" or "Your photo", drawn as the kit's SettingRow label and description so they
 * wear the section's paint. Then one line of controls and the helper under them. The
 * layout follows the card's own width (a container query, as SettingRow follows its row's): from 30rem the portrait
 * stands at the left of everything, the controls beside it under the line; narrower, the portrait and its words make
 * the first row and the controls take the card's width under them, so no button is squeezed beside a 96px face.
 *
 * THE CONTROLS. Upload a photo presses a hidden file input (the file tree's pattern) taking one JPEG, PNG or WebP; while
 * the photo is out its glyph turns and it refuses a second press, keeping its focus. See every frame opens the face's
 * contact sheet (every frame at 128px, named) in the kit's Lightbox, which stands in the top layer above Settings; it is
 * offered while a face is drawn, and while its sheet is fetched it turns and refuses a second press as Upload does.
 * Restore the original is offered only while his photo is involved — it is her face, or its face is being made or
 * failed — and asks first, in a ConfirmDialog raised over the Settings modal, saying what the press does: while the face
 * made from his photo is hers, "Restore her original face? The face made from your photo is removed."; while she still
 * wears the original and his photo waits, is being made or failed, "Remove your photo? No face is made from it, and her
 * original face stays." (just "No face is made from it." while no original face is made yet). Its accessible name,
 * "Restore the original face", tells it from the register's Restore the original further down the section. Under a
 * finger every control is 44px tall, Verve's touch floor.
 *
 * WHILE A FACE IS MADE, a band at the card's foot: a Meter of the frames made of all of them ("Making her new face",
 * "37 of 115 frames", "Her current face stays until it is ready."), or, queued behind another account's, "Waiting for
 * another face to finish." in the muted ink. The portrait above keeps her current face until the new one is ready.
 * A BAKE THAT FAILED is a warn Banner in that band carrying the server's sentence; Upload a photo and Restore the
 * original stay beside it as the two ways on. A REFUSED UPLOAD's sentence (a 400) stands in place of the helper, amber
 * with the ▲ and announced, as the section's other refusals do. Both sentences hold each hyphenated word whole
 * (WholeWords): a command split at its hyphen (`scripts/install-` / `comfyui.sh`) reads as two things.
 *
 * WHAT IS ANNOUNCED. One polite region, mounted with the card and drawn for a screen reader alone, carries the making's
 * state in words — "Making her new face", "Waiting for another face to finish." or the failure's sentence — and never the
 * frame count, which would be a hundred announcements: each change of state is announced once, and the words a card opens
 * with (Settings opened mid-bake, a failure standing for days) are not, the band showing them. The line is a polite region
 * of its own, so a switch of face (a bake finished, a restore) is announced. A restore that went through takes Restore
 * off the page: focus that fell with it goes to Upload a photo instead of to the page.
 */
export function CompanionFaceSettingsView({ face, portrait, uploading, refusal, contactUrl, framesOpening, onUpload, onRestore, onSeeFrames, onCloseFrames }: CompanionFaceSettingsViewProps) {
  const { t } = useTranslation('settings');
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  // Whether Restore's question is up: the question is the press's first half, so the face made from his photo is never
  // removed by one slip.
  const [confirming, setConfirming] = useState(false);

  const shown = face.id === null ? 'none' : face.original ? 'original' : 'yours';
  // His photo is involved — it is her face, or its face is being made or failed — so there is something to restore.
  const restorable = !face.original || face.bake !== null;
  // Whether Restore was offered when focus last followed the card: only a change moves focus, so a card that mounts takes none.
  const followedRestorable = useRef(restorable);

  // The question asks about his photo: once nothing of it is left (the restore went through, or another page restored),
  // it is put away, so a later upload never reopens it. Set while rendering, which React re-runs at once.
  if (confirming && !restorable) setConfirming(false);

  // The restore that went through takes Restore off the page, and the closing question hands focus back to that button,
  // which is gone: focus goes to Upload a photo, the card's first control. Focus he put somewhere else stays there.
  useEffect(() => {
    if (restorable === followedRestorable.current) return;
    followedRestorable.current = restorable;
    if (!restorable && (document.activeElement === null || document.activeElement === document.body)) uploadRef.current?.focus({ preventScroll: true });
  }, [restorable]);

  // The chooser's one photo goes out. The input is emptied first, so choosing the same file again (after a refusal or a
  // restore) is still a change and still sent.
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(file);
  };

  const line = {
    none: t('voiceSettings.companion.face.none', { defaultValue: "Her original face isn't made yet." }),
    original: t('voiceSettings.companion.face.original', { defaultValue: 'The original face' }),
    yours: t('voiceSettings.companion.face.yours', { defaultValue: 'Your photo' }),
  }[shown];
  const framesLabel = t('voiceSettings.companion.face.framesLabel', { defaultValue: 'Every frame of her face' });
  // Under a finger every control is Verve's 44px touch floor; a mouse keeps the section's small buttons.
  const touch = '[@media(pointer:coarse)]:min-h-11';

  // The question says what the press does. While the face made from his photo is hers, the design's words: the original
  // comes back and that face goes. While she still wears the original (his photo waits, is being made, or failed), the
  // press drops his photo and no face is made from it; with no original face made yet either (a fresh box), nothing of
  // hers stays, and the message says only that.
  const question = face.original
    ? {
      title: t('voiceSettings.companion.face.dropTitle', { defaultValue: 'Remove your photo?' }),
      message: face.id === null
        ? t('voiceSettings.companion.face.dropMessageNone', { defaultValue: 'No face is made from it.' })
        : t('voiceSettings.companion.face.dropMessage', { defaultValue: 'No face is made from it, and her original face stays.' }),
      confirm: t('voiceSettings.companion.face.dropConfirm', { defaultValue: 'Remove your photo' }),
    }
    : {
      title: t('voiceSettings.companion.face.restoreTitle', { defaultValue: 'Restore her original face?' }),
      message: t('voiceSettings.companion.face.restoreMessage', { defaultValue: 'The face made from your photo is removed.' }),
      confirm: t('voiceSettings.companion.face.restoreConfirm', { defaultValue: 'Restore' }),
    };

  const bake = face.bake;
  let making: ReactNode = null;
  // The making's state in words, for the card's one polite region: never the frame count.
  let makingWords = '';
  if (bake?.state === 'baking') {
    makingWords = t('voiceSettings.companion.face.making', { defaultValue: 'Making her new face' });
    making = (
      <Meter
        percent={bake.total > 0 ? (bake.done / bake.total) * 100 : null}
        label={makingWords}
        value={t('voiceSettings.companion.face.progress', { done: bake.done, total: bake.total, defaultValue: '{{done}} of {{total}} frames' })}
        sub={t('voiceSettings.companion.face.stays', { defaultValue: 'Her current face stays until it is ready.' })}
      />
    );
  } else if (bake?.state === 'queued') {
    makingWords = t('voiceSettings.companion.face.queued', { defaultValue: 'Waiting for another face to finish.' });
    making = (
      <p className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
        <Clock aria-hidden="true" className="size-3.5 shrink-0" />
        {makingWords}
      </p>
    );
  } else if (bake?.state === 'failed') {
    makingWords = bake.error;
    making = <Banner tone="warn"><WholeWords>{bake.error}</WholeWords></Banner>;
  }

  return (
    <div data-companion-face={shown} data-companion-face-bake={bake?.state ?? 'none'}>
      <SettingsCard className="[container-type:inline-size]">
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-4 [@container(min-width:30rem)]:grid-rows-[auto_1fr] [@container(min-width:30rem)]:items-start">
          <div data-companion-face-portrait="" className="size-24 [@container(min-width:30rem)]:row-span-2">{portrait}</div>
          <SettingRow
            label={<span data-companion-face-title="">{t('voiceSettings.companion.face.title', { defaultValue: 'Her face' })}</span>}
            description={<span role="status" data-companion-face-line="">{line}</span>}
            className="min-w-0 p-0"
          >
            {null}
          </SettingRow>
          <div className="col-span-2 min-w-0 [@container(min-width:30rem)]:col-span-1 [@container(min-width:30rem)]:col-start-2">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={inputRef} type="file" accept={PHOTO_TYPES} className="hidden" tabIndex={-1} aria-hidden="true" data-companion-face-input="" onChange={choose} />
              <Button
                ref={uploadRef}
                variant="outline"
                size="sm"
                busy={uploading}
                aria-describedby={helpId}
                data-companion-face-upload=""
                onClick={() => inputRef.current?.click()}
                className={touch}
              >
                {uploading ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <ImageUp aria-hidden="true" />}
                {t('voiceSettings.companion.face.upload', { defaultValue: 'Upload a photo' })}
              </Button>
              {face.id !== null && (
                <Button variant="outline" size="sm" busy={framesOpening} data-companion-face-frames="" onClick={onSeeFrames} className={touch}>
                  {framesOpening ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <LayoutGrid aria-hidden="true" />}
                  {t('voiceSettings.companion.face.frames', { defaultValue: 'See every frame' })}
                </Button>
              )}
              {restorable && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('voiceSettings.companion.face.restoreLabel', { defaultValue: 'Restore the original face' })}
                  data-companion-face-restore=""
                  onClick={() => setConfirming(true)}
                  className={`text-muted-foreground hover:text-foreground ${touch}`}
                >
                  <RotateCcw aria-hidden="true" />
                  {t('voiceSettings.companion.face.restore', { defaultValue: 'Restore the original' })}
                </Button>
              )}
            </div>
            <p id={helpId} data-companion-face-help={refusal === null ? 'help' : 'refused'} className="mt-2 text-pretty text-xs leading-relaxed text-muted-foreground">
              {refusal === null ? (
                t('voiceSettings.companion.face.help', { defaultValue: 'A JPEG, PNG or WebP where her face is clear, facing forward and not cut off.' })
              ) : (
                <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
                  <span aria-hidden="true">▲ </span>
                  <WholeWords>{refusal}</WholeWords>
                </span>
              )}
            </p>
          </div>
        </div>
        {making !== null && <div data-companion-face-making="" className="border-t border-border px-4 py-3">{making}</div>}
        <p role="status" data-companion-face-announce="" className="sr-only">{makingWords}</p>
      </SettingsCard>

      <ConfirmDialog
        open={confirming && restorable}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={question.title}
        message={question.message}
        actions={[
          { label: t('voiceSettings.companion.face.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirming(false) },
          { label: question.confirm, variant: 'destructive', onSelect: () => { setConfirming(false); onRestore(); } },
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
 * uploads his photo, restores the original and fetches the contact sheet; CompanionFaceSettingsView draws it.
 */
export function CompanionFaceSettings({ name, face }: CompanionFaceSettingsProps) {
  const { face: current, uploading, framesOpening, refusal, contactUrl, upload, restore, seeFrames, closeFrames } = useCompanionFaceSettings(face);

  return (
    <CompanionFaceSettingsView
      face={current}
      // An idle presence, no voice, no sentences and no look: the portrait blinks and glances, and a switch of face reaches it through the atlas cache it shares with her button.
      portrait={<CompanionAvatar presence={IDLE_PRESENCE} faceId={current.id} voice={null} sentences={null} look={null} name={name} size={PORTRAIT_SIZE_PX} />}
      uploading={uploading}
      framesOpening={framesOpening}
      refusal={refusal}
      contactUrl={contactUrl}
      onUpload={(file) => void upload(file)}
      onRestore={() => void restore()}
      onSeeFrames={() => void seeFrames()}
      onCloseFrames={closeFrames}
    />
  );
}
