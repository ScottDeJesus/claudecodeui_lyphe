import { useCallback, useState } from 'react';
import type { ClipboardEvent, Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorCode, useDropzone } from 'react-dropzone';
import type { DropzoneState, FileRejection } from 'react-dropzone';

import { MAX_ATTACHMENT_COUNT } from '@/shared/constants';

const MAX_ATTACHMENT_MEGABYTES = 10;
const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_MEGABYTES * 1024 * 1024;

/** One intake's files, sorted by what became of them. `tooBig` and `tooMany` are the ones left out, before any room is counted. */
type Offer = { accepted: File[]; tooBig: File[]; tooMany: File[] };

const nameOf = (file: File) => file.name || 'Unknown file';

// A file's name is never handed to i18next as a value: it replaces the first textual `{{x}}` it finds, so a file named
// `{{megabytes}}.bin` would be rewritten and the template's own placeholder left raw. The template is given a slot instead,
// and the name goes in afterwards, once, in one pass that never rescans what it inserted. A slot is its index between two U+E000
// marks (a private-use character no sentence holds), spelled as an escape: the character itself is invisible in an editor and in
// every tool, and a slot retyped without the marks would match every run of digits in the sentence, the "10" of "10 MB" included.
const SLOT_MARK = '\uE000';
const SLOT_PATTERN = new RegExp(`${SLOT_MARK}(\\d+)${SLOT_MARK}`, 'g');
const slot = (index: number) => `${SLOT_MARK}${index}${SLOT_MARK}`;
const fillSlots = (sentence: string, values: string[]) => sentence.replace(SLOT_PATTERN, (_, index: string) => values[Number(index)] ?? '');

/**
 * The house's one way a composer takes files: the paperclip's picker, a paste (pictures only), a drop on the box. Any kind, at most 10 with one message and 10 MB each. Used by the chat's useChatComposerState and the companion's CompanionComposer.
 *
 * Nothing is dropped without a word: `refused` is one sentence naming every file the last intake left out and why.
 */
export function useAttachmentIntake(setAttachedFiles: Dispatch<SetStateAction<File[]>>): {
  handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  getRootProps: DropzoneState['getRootProps'];
  getInputProps: DropzoneState['getInputProps'];
  isDragActive: boolean;
  openAttachmentPicker: () => void;
  /** The files the last intake did not take, and why, as one sentence; null when it took them all. Cleared by the next intake and by `clearRefused`. */
  refused: string | null;
  clearRefused: () => void;
} {
  const { t } = useTranslation('chat');
  // State, not a ref: the tray draws this sentence, and it must be drawn the moment an intake sets it. The composers that
  // call this hook own its lifetime, so a chat switch or a send empties it through `clearRefused`.
  const [refused, setRefused] = useState<string | null>(null);

  const clearRefused = useCallback(() => setRefused(null), []);

  const nameList = useCallback((files: File[]) => {
    const names = files.map(nameOf);
    return names.length === 2
      ? fillSlots(t('input.refused.pair', { first: slot(0), second: slot(1), defaultValue: '{{first}} and {{second}}' }), names)
      : names.join(', ');
  }, [t]);

  const refusalSentence = useCallback((offer: Offer, pastTheTenth: File[]) => {
    const sentences: string[] = [];
    if (offer.tooBig.length > 0) {
      sentences.push(fillSlots(t('input.refused.tooBig', {
        count: offer.tooBig.length,
        names: slot(0),
        megabytes: MAX_ATTACHMENT_MEGABYTES,
        defaultValue_one: 'Not attached: {{names}} is over {{megabytes}} MB.',
        defaultValue_other: 'Not attached: {{names}} are over {{megabytes}} MB.',
      }), [nameList(offer.tooBig)]));
    }
    if (offer.tooMany.length > 0) {
      sentences.push(t('input.refused.tooMany', {
        count: offer.tooMany.length,
        max: MAX_ATTACHMENT_COUNT,
        defaultValue: 'Not attached: {{count}} files at once; at most {{max}} go with one message.',
      }));
    }
    if (pastTheTenth.length > 0) {
      sentences.push(fillSlots(t('input.refused.waiting', {
        names: slot(0),
        max: MAX_ATTACHMENT_COUNT,
        defaultValue: 'Not attached: {{names}}; {{max}} files are already waiting.',
      }), [nameList(pastTheTenth)]));
    }
    return sentences.length > 0 ? sentences.join(' ') : null;
  }, [nameList, t]);

  const takeOffer = useCallback((offer: Offer) => {
    if (offer.accepted.length + offer.tooBig.length + offer.tooMany.length === 0) return;

    // How many files already wait is known only to the updater, which sees the list as it is when the add is applied (a
    // removal made a moment ago included); this hook is handed the setter alone. The updater hands the files that did not
    // fit out through a promise, and the sentence is set from its `then`, a microtask outside React's render, where the
    // updater itself (which may run inside another component's render) must never set state. React may run an updater
    // twice; both runs resolve the same value.
    const pastTheTenth = new Promise<File[]>((resolve) => {
      if (offer.accepted.length === 0) {
        resolve([]);
        return;
      }
      setAttachedFiles((previous) => {
        const room = Math.max(0, MAX_ATTACHMENT_COUNT - previous.length);
        resolve(offer.accepted.slice(room));
        return room > 0 ? [...previous, ...offer.accepted.slice(0, room)] : previous;
      });
    });
    void pastTheTenth.then((overflow) => setRefused(refusalSentence(offer, overflow)));
  }, [refusalSentence, setAttachedFiles]);

  /** What the dropzone sorted: it rejects a file over the size, and rejects every file of a pick of more than the count. */
  const handleDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    const rejectedFor = (code: ErrorCode) => rejections
      .filter((rejection) => rejection.errors.some((error) => error.code === code))
      .map((rejection) => rejection.file);
    takeOffer({
      accepted,
      tooBig: rejectedFor(ErrorCode.FileTooLarge),
      tooMany: rejectedFor(ErrorCode.TooManyFiles),
    });
  }, [takeOffer]);

  /** A paste is sorted the way the dropzone sorts a drop, so a pasted file is refused in the same words. */
  const handlePastedFiles = useCallback((pasted: File[]) => {
    const usable = pasted.filter((file) => {
      if (!file || typeof file !== 'object') {
        console.warn('Invalid file object:', file);
        return false;
      }
      return true;
    });
    const tooBig = usable.filter((file) => file.size > MAX_ATTACHMENT_SIZE);
    const fits = usable.filter((file) => file.size <= MAX_ATTACHMENT_SIZE);
    takeOffer(fits.length > MAX_ATTACHMENT_COUNT
      ? { accepted: [], tooBig, tooMany: fits }
      : { accepted: fits, tooBig, tooMany: [] });
  }, [takeOffer]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);
      const pictures: File[] = [];

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          pictures.push(file);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        pictures.push(...Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/')));
      }

      // One intake for the whole paste, so its refusal is one sentence rather than the last picture's.
      if (pictures.length > 0) {
        handlePastedFiles(pictures);
      }
    },
    [handlePastedFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE,
    maxFiles: MAX_ATTACHMENT_COUNT,
    onDrop: handleDrop,
    noClick: true,
    noKeyboard: true,
  });

  return { handlePaste, getRootProps, getInputProps, isDragActive, openAttachmentPicker: open, refused, clearRefused };
}
