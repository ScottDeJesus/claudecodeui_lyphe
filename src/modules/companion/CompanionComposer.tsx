import { useEffect, useRef, useState } from 'react';
import type { Dispatch, FormEvent, KeyboardEvent, SetStateAction } from 'react';
import { PaperclipIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ComposerAttachmentTray, ComposerDropOverlay } from '@/modules/chat';
import { CompanionTalkButton } from '@/modules/companion/CompanionTalkButton';
import { useGrowingField } from '@/modules/companion/hooks/useGrowingField';
import { ServerSentenceError } from '@/shared/api';
import { MAX_ATTACHMENT_COUNT } from '@/shared/constants';
import { useAttachmentIntake } from '@/shared/hooks/useAttachmentIntake';
import type { TalkPress } from '@/shared/types';
import { PromptInput, PromptInputButton, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionComposerProps = {
  /** Her name, for the field's placeholder and its accessible name. */
  name: string;
  /** False while the picture loads: there is nobody to send to yet. */
  ready: boolean;
  /** Whether her panel is drawn: the field is measured only then, and again when it opens. */
  visible: boolean;
  /**
   * Sends his words and the files he attached to them (either may be empty, never both). The files are the browser's own `File`s: the
   * caller uploads them, and a refusal rejects, so the box puts both back. A `ServerSentenceError` carries the server's own sentence (an
   * upload refused, the door's 400) and the box says it; any other rejection (a status, a timeout, a send that never got an answer) says
   * the plain line.
   */
  onSend: (text: string, files: File[]) => Promise<void>;
  /**
   * The page's one talk press: the talk button in the tools cluster before send draws and presses it, and its error is said above
   * the box. Absent, there is neither.
   */
  talk?: TalkPress;
  /**
   * Below 768 px its field stands at the touch law's 44 px, a finger's catch (the station's talk row). Absent, the field keeps
   * the 40 px its panel draws.
   */
  touchField?: boolean;
  /**
   * Whether the box stands at the screen's own foot, as her panel's does on a phone: then below 1024 px it pads its foot by the
   * home indicator's inset (`env(safe-area-inset-bottom)`). False for the station's talk control, whose frame clears the
   * indicator itself (compact's body, the phone's bottom bar): padded twice, the box stood 34 px over the bar on an iPhone, and
   * 34 px over the keyboard while he types, where the indicator's inset still reads 34. Absent, true.
   */
  atScreenFoot?: boolean;
  /**
   * His typed words, when the caller keeps them (with `onText`, given together): the field shows them and every keystroke reports
   * through `onText`. The station holds them in its provider, so the words outlive the tree an arrangement mounts. Absent, the
   * composer keeps them itself, as her panel's does.
   */
  text?: string;
  /**
   * A change of the held words (a keystroke, a send emptying the field, a refused send putting them back), a state setter's own
   * shape: it takes the new words or a function of the words held now. A refused send puts its words back with the function, so it
   * reads what the box holds when the refusal lands, in whichever tree that is. Given with `text`.
   */
  onText?: Dispatch<SetStateAction<string>>;
  /**
   * The files he has attached and not sent, when the caller keeps them (with `onAttachedFiles`, given together as `text` and `onText`
   * are): the station does, so the Compact switch keeps them. Absent, the composer keeps its own.
   */
  attachedFiles?: File[];
  /** A change of the held files (an intake adding, a chip's remove, a send emptying the tray, a refused send putting them back), a state setter's own shape. Given with `attachedFiles`. */
  onAttachedFiles?: Dispatch<SetStateAction<File[]>>;
};

/**
 * The server's own sentence off a refused send's error, or null for every other failure (a status line, a parse failure, a timeout, a
 * send that never got an answer: text the page or the browser made up, which nobody can use): the box says its plain line instead.
 */
const sentenceOf = (error: unknown): string | null =>
  error instanceof ServerSentenceError && error.message.trim() !== '' ? error.message : null;

/**
 * Puts the files of a refused send back ahead of whatever was attached while it was out, to the ten a message carries, and answers the
 * files that did not fit (the ones attached since, past the tenth) so the box can name them. The updater only answers through the
 * promise and returns the list: React may run an updater twice and one that sets state would do it from inside a render.
 */
const putBack = (setFiles: Dispatch<SetStateAction<File[]>>, sent: File[]): Promise<File[]> =>
  new Promise((resolve) => {
    setFiles((attachedSince) => {
      const all = [...sent, ...attachedSince];
      resolve(all.slice(MAX_ATTACHMENT_COUNT));
      return all.slice(0, MAX_ATTACHMENT_COUNT);
    });
  });

/**
 * The box to type to her: the kit's PromptInput as one row that grows with the text — the field, then the tools cluster,
 * then send. Enter sends and Shift+Enter breaks the line (a phone's Enter key says "Send"); an IME still composing
 * keeps its Enter. Drawn by this module's CompanionPanel, at the panel's foot, clear of a phone's home indicator, and by the
 * station module's talk control, inside a frame that clears it (`atScreenFoot` false).
 *
 * THE TOOLS CLUSTER stands between the field and send: the paperclip first, then the talk button. The cluster's icon buttons stay
 * together, as the chat's footer keeps its own, and the field starts at the box's left edge.
 *
 * THE TALK BUTTON (CompanionTalkButton) is the same press as the key or mouse button he binds, here for the phone: drawn from
 * `talk`, the page's one press. What failed with a press on the page itself (`talk.error`) is said right above the box at that
 * end, amber with the ▲, in the flow: it moves her log up a line rather than standing over it or over the draft's sends. Without
 * `talk` the cluster holds the paperclip alone. A voice press carries no attachment: the files waiting in the box stay there
 * until he sends a typed message.
 *
 * HIS FILES go with his typed words, exactly as in a chat (`useAttachmentIntake`, the chat's one way to take them): the paperclip
 * (named "Attach a file", a 44 px catch under a finger), a picture pasted into the field, files dropped on the box. At most 10 files
 * of at most 10 MB each, of any kind; they stand as the chat's chips above the field until he sends, and a file not taken is named
 * in one line above them. The chips stand in a tray that scrolls inside itself past a share of the box's height, so ten file cards
 * never push the field or send out of a panel or a station column that cannot grow. Files alone are a message: Send is live with
 * words or files.
 *
 * A send clears the field, the tray and the refusal line at once, so the next thought can start; a send that is refused puts the
 * words and the files back (ahead of anything typed or attached since, to the ten a message carries: a file attached since that no
 * longer fits is named in the line) and says so under the box: the server's own sentence when it wrote one (an upload refused, the
 * door's 400), else the plain line. The field stays live while a send is out.
 *
 * WHERE THEY ARE KEPT. His words and his files are the composer's own until a caller holds them (`text` with `onText`,
 * `attachedFiles` with `onAttachedFiles`): the station does, so pressing its Compact switch, which mounts the other
 * arrangement's tree and with it a new box, leaves what he had typed and attached in the box. In memory only: a browser `File`
 * cannot be stored, so a reload starts with an empty box.
 */
export function CompanionComposer({ name, ready, visible, onSend, talk, touchField = false, atScreenFoot = true, text: heldText, onText, attachedFiles: heldFiles, onAttachedFiles }: CompanionComposerProps) {
  const { t } = useTranslation();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // What he is typing to her when no caller holds it (her panel). Not hers until he sends it.
  const [ownText, setOwnText] = useState('');
  const held = heldText !== undefined && onText !== undefined;
  const text = held ? heldText : ownText;
  const setText = held ? onText : setOwnText;
  // The files he has attached and not sent, when no caller holds them (her panel). In memory only, like his words: a `File` cannot be stored.
  const [ownFiles, setOwnFiles] = useState<File[]>([]);
  const filesHeld = heldFiles !== undefined && onAttachedFiles !== undefined;
  const files = filesHeld ? heldFiles : ownFiles;
  const setFiles = filesHeld ? onAttachedFiles : setOwnFiles;
  const { handlePaste, getRootProps, getInputProps, isDragActive, openAttachmentPicker, refused: notTaken, clearRefused } = useAttachmentIntake(setFiles);
  // The tray's scroller, so a refusal can be brought into view (below).
  const trayRef = useRef<HTMLDivElement>(null);
  // The sentence naming a file the intake did not take is the tray's first line, and a refused file draws no chip: when the tray is scrolled
  // down among its cards the line would appear above the scroller's edge and nothing on screen would change, so he would send without the file.
  // A new sentence takes the tray back to its top, where the line stands.
  useEffect(() => {
    if (notTaken !== null && trayRef.current !== null) trayRef.current.scrollTop = 0;
  }, [notTaken]);

  // A send is out: the send button is busy, and a second Enter does not send the same words again.
  const [sending, setSending] = useState(false);
  // The last send was refused: the line under the box says so until the next send. `sentence` is the server's own when it wrote one, else null
  // (the plain line); `leftOut` names the files attached while the send was out that no longer fit the box's ten when it put its own back.
  const [sendRefusal, setSendRefusal] = useState<{ sentence: string | null; leftOut: string[] } | null>(null);

  // The field grows with its words up to the kit's cap (then scrolls), and shrinks back when a send empties it.
  useGrowingField(fieldRef, text, visible);

  // Words or files make a message: files alone are one.
  const empty = text.trim().length === 0 && files.length === 0;

  const send = () => {
    const words = text.trim();
    const sentFiles = files;
    if (empty || sending || !ready) return;
    setSendRefusal(null);
    clearRefused();
    setSending(true);
    setText('');
    setFiles([]);
    onSend(words, sentFiles)
      .catch((error: unknown) => {
        // Put back ahead of whatever was typed or attached while the send was out, in whichever tree the box is now.
        setText((typedSince) => (typedSince.trim().length === 0 ? words : `${words}\n${typedSince}`));
        const sentence = sentenceOf(error);
        void putBack(setFiles, sentFiles).then((leftOut) => setSendRefusal({ sentence, leftOut: leftOut.map((file) => file.name) }));
      })
      .finally(() => setSending(false));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <div data-companion-composer="" className={cn('shrink-0 bg-background px-3 pb-3 pt-2', atScreenFoot && 'max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]')}>
      {talk?.error != null && (
        // What failed on the page with his last press (the mic refused, the clip not sent), right above the box at the
        // talk button's end: in the flow, so it takes room instead of standing over her newest line or the draft's sends.
        <p
          role="alert"
          data-tone="warn"
          data-companion-talk-error=""
          className="mb-1.5 ml-auto flex w-fit max-w-[85%] items-start gap-1.5 rounded-lg border border-tone-ink/25 bg-tone-soft px-2.5 py-1.5 text-xs leading-snug text-tone-ink"
        >
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 break-words">{talk.error}</span>
        </p>
      )}
      <PromptInput onSubmit={submit} {...getRootProps()}>
        {isDragActive && <ComposerDropOverlay compact />}
        {/* The tray is the chat's own and unbounded: a file card is 80 px and stands one to a row in a box this narrow, so ten of them are
            800 px. Here it scrolls inside a share of the box's height (a fifth of her panel's, where the field's own cap is a quarter; the
            viewport's where no container is sized), never more than 8rem, so the field and send stay on screen. The chat's tray is untouched. */}
        <div ref={trayRef} data-companion-tray="" className="max-h-[min(8rem,20cqh)] overflow-y-auto overscroll-contain">
          <ComposerAttachmentTray
            files={files}
            onRemove={(index) => setFiles((held) => held.filter((_, at) => at !== index))}
            refused={notTaken}
          />
        </div>
        <input {...getInputProps()} />
        <div className="flex items-end gap-1 py-1 pl-1 pr-2">
          <PromptInputTextarea
            ref={fieldRef}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={sendOnEnter}
            onPaste={handlePaste}
            enterKeyHint="send"
            placeholder={t('companion.composer.placeholder', { name })}
            aria-label={t('companion.composer.label', { name })}
            data-companion-composer-field=""
            // Capped at a quarter of the PANEL's height (her panel is a size container), not the window's 40vh/300px:
            // with the keyboard up the panel is the strip above it, and a long message must never push send out of it.
            className={cn('max-h-[25cqh] min-w-0 flex-1 px-3 sm:max-h-[25cqh]', touchField && 'finger:py-2.5')}
          />
          {/* The tools cluster, before send: the paperclip first, then the talk button. */}
          <PromptInputTools data-companion-talk-slot="" className="mb-1">
            {/* The kit's 32px button keeps its size to the eye and takes a 44px catch under a finger, Verve's touch floor; there it
                stands 8px further from its neighbour (the talk button, or send), so the two catches meet and neither takes the other's edge. */}
            <PromptInputButton
              tooltip={{ content: t('companion.composer.attach') }}
              onClick={openAttachmentPicker}
              aria-label={t('companion.composer.attach')}
              data-companion-attach=""
              className="relative before:absolute before:inset-0 before:content-[''] finger:mr-2 finger:before:-inset-1.5"
            >
              <PaperclipIcon />
            </PromptInputButton>
            {talk && <CompanionTalkButton state={talk.state} error={talk.error} onToggle={talk.toggle} name={name} />}
          </PromptInputTools>
          {/* A send empties the field, so the button is disabled while it is out without a state of its own. The kit's
              32px send keeps its size to the eye and takes a 44px catch under a finger (a touch screen, or a window under 768 px), Verve's touch floor. */}
          <PromptInputSubmit
            aria-label={t('companion.composer.send')}
            aria-busy={sending || undefined}
            disabled={!ready || empty}
            className="relative mb-1 before:absolute before:inset-0 before:content-[''] finger:before:-inset-1.5"
          />
        </div>
      </PromptInput>
      {sendRefusal !== null && (
        <p role="alert" data-tone="warn" className="mt-1.5 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-tone-ink">
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 break-words">
            {sendRefusal.sentence ?? t('companion.composer.refused', { name })}
            {sendRefusal.leftOut.length > 0 && (
              // Its own line: a server's sentence may end without a full stop ("disk full"), and the clause must not run on from it.
              <span className="block">{t('companion.composer.leftOut', { max: MAX_ATTACHMENT_COUNT })} {sendRefusal.leftOut.join(', ')}</span>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
