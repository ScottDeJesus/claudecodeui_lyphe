import { RotateCcw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Chip, ConfirmDialog, Input, SettingRow } from '@/shared/ui';

type SoundTagsFieldProps = {
  /** Her sound tags as the server holds them, in the order her register lists them. */
  tags: string[];
  /** A save is out: every press waits for it, because the next list is made from this one. */
  saving: boolean;
  /** Saves the whole list; null restores Google's set, which the server holds and the page never copies. */
  onChange: (tags: string[] | null) => void;
};

/** The server's limits (`checkSoundTags`, server/modules/voice/voice-settings.ts), mirrored here and edited with them. */
const MAX_TAGS = 30;
const MAX_TAG_CHARS = 24;
/** Words of lower-case letters with single spaces between them, the form her parse compares in. */
const TAG_SHAPE = /^[a-z]+(?: [a-z]+)*$/;

/** What he typed in the form the server stores: trimmed, inner spaces collapsed, lower case, as her parse reads a tag. */
const tagOf = (typed: string): string => typed.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Settings > Voice > Gemini's sound tags: the sounds she may make, each voiced where she puts it. The one list her register
 * teaches her and her filter keeps, so she is never taught a sound the filter then strips. Composed for this folder's
 * GeminiVoiceSection, the last row of its card; `.verify/kaylee-voice-scaffold.mjs` draws it with Google's ten and one
 * added.
 *
 * "RESTORE GOOGLE'S SET" stands in the row's control slot, beside its title, drawn as the register's "Restore the
 * original" two cards below (outline, ↺): one tab, one way to draw a restore. It asks first, because it drops every sound
 * he added, then saves `null`: the server holds Google's set, the page never a copy of it.
 *
 * THE CHIPS are the list in its order, each the kit's Chip as a press that removes it: the ✕ says so and its name is
 * "Remove giggle". Under a finger each is 44px tall, the companion's touch floor, with a wider gap, because a press removes
 * at once and a miss would take the neighbour. Focus a removal leaves behind goes to the chip now in its place, so the
 * keyboard never drops to the page. The last one left has no ✕ (a list of none is refused), and a line says why. Under
 * them, the field and Add, as the API key row draws its own (Enter adds too): what he types is read as her parse reads a
 * tag (trimmed, spaces collapsed, lower case), and one the server would refuse (not lower-case words, longer than 24,
 * already listed) says why right under the field and is not sent. At thirty, the most she takes, Add waits and a line
 * says so (the field stays live, so it keeps his focus). The word stays in the field until the list holds it, so an add
 * the server refuses loses nothing; its sentence is the card's last line.
 *
 * Nothing is optimistic: a chip goes, or comes, when the server's answer does. While any save is out every press waits
 * (`busy`, which keeps focus where a disabled button would drop it), because the next list is made from the one drawn.
 */
export function SoundTagsField({ tags, saving, onChange }: SoundTagsFieldProps) {
  const { t } = useTranslation('settings');
  const idBase = useId();
  // The sound he is typing, until the list holds it: kept through a refused add, so nothing he typed is lost.
  const [typed, setTyped] = useState('');
  // The sound last sent, until the answer settles: once no save is out, the field empties if the list holds it.
  const [sent, setSent] = useState<string | null>(null);
  // Whether Restore's question is up: the question is the press's first half, so his own sounds are never dropped by a slip.
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  // The chips and the field, where focus goes once a removed chip is gone.
  const chipsRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // The sound a press removed and where its chip stood, until the answer settles.
  const removedRef = useRef<{ sound: string; at: number } | null>(null);

  // The add's answer is in (no save out): landed, the field empties; refused, his word stays for another try. Set while
  // rendering, which React re-runs at once, so the field is never drawn holding a sound the list already shows.
  if (sent !== null && !saving) {
    setSent(null);
    if (tags.includes(sent)) setTyped('');
  }

  // A removed chip takes the focus with it, to the page's body. Once the list no longer holds its sound, focus goes to the
  // chip now in its place (the last chip when it was the last), or to the field when only the last, unremovable sound is
  // left; a removal refused leaves the chip where it was. Only a focus that was dropped is moved: one he has taken
  // elsewhere meanwhile stays. It moves DOM focus and sets no state.
  useEffect(() => {
    const removed = removedRef.current;
    if (removed === null) return;
    if (tags.includes(removed.sound)) {
      if (!saving) removedRef.current = null;
      return;
    }
    removedRef.current = null;
    const active = chipsRef.current?.ownerDocument.activeElement ?? null;
    if (active !== null && active !== chipsRef.current?.ownerDocument.body) return;
    const chips = chipsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [];
    (chips.length > 0 ? chips[Math.min(removed.at, chips.length - 1)] : fieldRef.current)?.focus();
  }, [tags, saving]);

  const tag = tagOf(typed);
  const full = tags.length >= MAX_TAGS;
  const problem = tag.length === 0
    ? null
    : !TAG_SHAPE.test(tag) || tag.length > MAX_TAG_CHARS
      ? t('voiceSettings.gemini.soundTagInvalid', { defaultValue: 'A sound is 1–24 lower-case letters, with single spaces between words.' })
      : tags.includes(tag)
        ? t('voiceSettings.gemini.soundTagTaken', { defaultValue: '“{{tag}}” is on the list already.', tag })
        : null;
  const note = full
    ? t('voiceSettings.gemini.soundTagsFull', { defaultValue: 'Thirty sounds is the most she takes: remove one to add another.' })
    : tags.length === 1
      ? t('voiceSettings.gemini.soundTagsLast', { defaultValue: 'At least one sound stays on the list.' })
      : null;

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || full || tag.length === 0 || problem !== null) return;
    setSent(tag);
    onChange([...tags, tag]);
  };

  const remove = (gone: string) => {
    if (saving || tags.length <= 1) return;
    removedRef.current = { sound: gone, at: tags.indexOf(gone) };
    onChange(tags.filter((kept) => kept !== gone));
  };

  const restore = () => {
    setConfirmingRestore(false);
    onChange(null);
  };

  const label = t('voiceSettings.gemini.soundTags', { defaultValue: 'Sound tags' });

  return (
    <div data-gemini-sound-tags={tags.length}>
      <SettingRow
        label={label}
        description={t('voiceSettings.gemini.soundTagsHelp', {
          defaultValue: 'The sounds she may make, each voiced where she puts it. Any other bracket is dropped before she speaks.',
        })}
        className="pb-3"
      >
        <Button variant="outline" size="sm" busy={saving} onClick={() => setConfirmingRestore(true)} data-gemini-sound-tags-restore="">
          <RotateCcw aria-hidden="true" />
          {t('voiceSettings.gemini.soundTagsRestore', { defaultValue: "Restore Google's set" })}
        </Button>
      </SettingRow>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div ref={chipsRef} role="group" aria-label={label} className="flex flex-wrap gap-1.5 [@media(pointer:coarse)]:gap-2">
          {tags.map((sound) => (tags.length > 1 ? (
            <Chip
              key={sound}
              size="sm"
              action
              busy={saving}
              ariaLabel={t('voiceSettings.gemini.soundTagRemove', { defaultValue: 'Remove {{tag}}', tag: sound })}
              onClick={() => remove(sound)}
              // 44px under a finger, the touch floor: every chip here is a press that removes at once.
              className="[@media(pointer:coarse)]:min-h-11"
            >
              <span data-gemini-sound-tag={sound}>{sound}</span>
              <X aria-hidden="true" className="-mr-1 size-3 shrink-0" />
            </Chip>
          ) : (
            <Chip key={sound} size="sm"><span data-gemini-sound-tag={sound}>{sound}</span></Chip>
          )))}
        </div>
        {/* The field and Add, in the API key row's own shape; why a sound cannot be added stands right under them. */}
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input
            ref={fieldRef}
            value={typed}
            placeholder={t('voiceSettings.gemini.soundTagPlaceholder', { defaultValue: 'Add a sound, like hum' })}
            autoComplete="off"
            spellCheck={false}
            aria-label={t('voiceSettings.gemini.soundTagField', { defaultValue: 'A sound to add' })}
            aria-describedby={problem !== null || note !== null ? `${idBase}-sound-tag-line` : undefined}
            invalid={problem !== null}
            data-gemini-sound-tag-field=""
            onChange={(event) => setTyped(event.target.value)}
            className="min-w-0 flex-1 basis-48"
          />
          <Button type="submit" size="sm" busy={saving} disabled={full || tag.length === 0 || problem !== null}>
            {t('voiceSettings.gemini.soundTagAdd', { defaultValue: 'Add' })}
          </Button>
          {problem !== null ? (
            <p id={`${idBase}-sound-tag-line`} role="alert" data-tone="warn" className="basis-full text-xs font-medium text-tone-ink">
              <span aria-hidden="true">▲ </span>
              {problem}
            </p>
          ) : note !== null && (
            <p id={`${idBase}-sound-tag-line`} className="basis-full text-xs text-muted-foreground">{note}</p>
          )}
        </form>
      </div>

      <ConfirmDialog
        open={confirmingRestore}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={t('voiceSettings.gemini.soundTagsRestoreTitle', { defaultValue: "Restore Google's sound tags?" })}
        message={t('voiceSettings.gemini.soundTagsRestoreMessage', {
          defaultValue: "Her list goes back to Google's ten. Sounds you added are dropped, and she stops making them.",
        })}
        actions={[
          { label: t('voiceSettings.gemini.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirmingRestore(false) },
          { label: t('voiceSettings.gemini.soundTagsRestoreConfirm', { defaultValue: 'Restore' }), variant: 'destructive', onSelect: restore },
        ]}
        onDismiss={() => setConfirmingRestore(false)}
      />
    </div>
  );
}
