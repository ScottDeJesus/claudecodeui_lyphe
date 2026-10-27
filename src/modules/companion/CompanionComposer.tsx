import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useGrowingField } from '@/modules/companion/hooks/useGrowingField';
import { PromptInput, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from '@/shared/ui';

type CompanionComposerProps = {
  /** Her name, for the field's placeholder and its accessible name. */
  name: string;
  /** False while the picture loads: there is nobody to send to yet. */
  ready: boolean;
  /** Whether her panel is drawn: the field is measured only then, and again when it opens. */
  visible: boolean;
  onSend: (text: string) => Promise<void>;
};

/**
 * The box to type to her: the kit's PromptInput as one row that grows with the text — the field, then the talk button's
 * place, then send. Enter sends and Shift+Enter breaks the line (a phone's Enter key says "Send"); an IME still composing
 * keeps its Enter. Drawn by this module's CompanionPanel, at the panel's foot, clear of a phone's home indicator.
 *
 * THE TALK BUTTON'S PLACE is the empty tools cluster before send: kaylee--talk puts its button there. It draws nothing,
 * and takes no room, until then.
 *
 * A send clears the field at once, so the next thought can start; a send that is refused puts the words back (ahead of
 * anything typed since) and says so under the box. The field stays live while a send is out.
 */
export function CompanionComposer({ name, ready, visible, onSend }: CompanionComposerProps) {
  const { t } = useTranslation();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // What he is typing to her. The composer's own: it is not hers until he sends it.
  const [text, setText] = useState('');
  // A send is out: the send button is busy, and a second Enter does not send the same words again.
  const [sending, setSending] = useState(false);
  // The last send was refused: the line under the box says so until the next send.
  const [refused, setRefused] = useState(false);

  // The field grows with its words up to the kit's cap (then scrolls), and shrinks back when a send empties it.
  useGrowingField(fieldRef, text, visible);

  const empty = text.trim().length === 0;

  const send = () => {
    const words = text.trim();
    if (words.length === 0 || sending || !ready) return;
    setRefused(false);
    setSending(true);
    setText('');
    onSend(words)
      .catch(() => {
        setText((typedSince) => (typedSince.trim().length === 0 ? words : `${words}\n${typedSince}`));
        setRefused(true);
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
    <div data-companion-composer="" className="shrink-0 bg-background px-3 pb-3 pt-2 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
      <PromptInput onSubmit={submit}>
        <div className="flex items-end gap-1 py-1 pl-1 pr-2">
          <PromptInputTextarea
            ref={fieldRef}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={sendOnEnter}
            enterKeyHint="send"
            placeholder={t('companion.composer.placeholder', { name })}
            aria-label={t('companion.composer.label', { name })}
            data-companion-composer-field=""
            // Capped at a quarter of the PANEL's height (her panel is a size container), not the window's 40vh/300px:
            // with the keyboard up the panel is the strip above it, and a long message must never push send out of it.
            className="max-h-[25cqh] min-w-0 flex-1 px-3 sm:max-h-[25cqh]"
          />
          {/* The talk button's place (kaylee--talk), before send. Empty until then. */}
          <PromptInputTools data-companion-talk-slot="" className="mb-1" />
          {/* A send empties the field, so the button is disabled while it is out without a state of its own. The kit's
              32px send keeps its size to the eye and takes a 44px catch under a finger, Verve's touch floor. */}
          <PromptInputSubmit
            aria-label={t('companion.composer.send')}
            aria-busy={sending || undefined}
            disabled={!ready || empty}
            className="relative mb-1 before:absolute before:inset-0 before:content-[''] [@media(pointer:coarse)]:before:-inset-1.5"
          />
        </div>
      </PromptInput>
      {refused && (
        <p role="alert" data-tone="warn" className="mt-1.5 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-tone-ink">
          <span aria-hidden="true">▲</span>
          {t('companion.composer.refused', { name })}
        </p>
      )}
    </div>
  );
}
