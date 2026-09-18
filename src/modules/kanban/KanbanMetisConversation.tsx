import { LoaderCircle, Square } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMetis } from '@/modules/kanban/hooks/useKanbanMetis';
import { SubagentTranscriptView } from '@/modules/chat';
import type { KanbanMetisSession, SubagentTranscriptTarget } from '@/shared/types';
import {
  Banner,
  Button,
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * ONE METIS, READ AND ANSWERED: her transcript as it grows, and beneath it the one place a person
 * can put words in front of her.
 *
 * Drawn by `KanbanMetisPanel`, beside or beneath the fleet list, for the one row the reader opened,
 * and by nothing else. The panel keys it on the session id, so a draft and a refusal belong to the
 * conversation they were typed in and never follow the reader to another Metis.
 *
 * ONE HEADER, AND IT IS THE VIEW'S. `SubagentTranscriptView` brings its own sticky row — the way
 * back, a label, and a "Live" badge while the file still grows — and sticks it inside whichever
 * scroller boxes it. A second header above it would be two Back arrows and two names a hand's
 * width apart, so this surface draws none: the view's label is fed the session's model and its
 * state word, its Back is the panel's close, and its Live badge is the running signal. The toned
 * state badge and the clock are not repeated here either, because the row that opened this stays
 * on screen beside it, highlighted, carrying both.
 *
 * THE SCROLLER IS THE CONTAINER'S, NEVER THE VIEW'S. The view is a plain column whose sticky header
 * sticks inside whichever scroller boxes it, so this is the box, the same one `PinnedSubagents`
 * gives it: no top padding, or that header sticks inside the padding and the transcript shows
 * through the gap above it; `bg-card` is `--surface`, the paint the header itself uses, so it
 * never scrolls past as a lighter stripe. Reading and empty are the view's own two states and are
 * not redrawn here — a spinner while the file is read, a line when there is no file yet.
 *
 * THE COMPOSER SAYS NO BEFORE THE PRESS. A reply is `resume` with the person's words as the turn
 * she wakes up to, and it can only reach a session whose child has STOPPED: a running child's stdin
 * was closed at spawn and nothing in this repository can reach it, so the server answers a reply
 * to a live session with a 409 — a fact of the process model, not a policy that might soften. The
 * screen therefore says it first: while she runs the textarea is disabled, the words "She is
 * mid-turn — stop her to reply" sit where the keyboard hint sits, and the footer's one button is
 * Stop — the same outline the row draws, because it is the same rare, destructive verb. A stopped
 * or failed session gets the composer enabled and the kit's filled Send; a send in flight keeps the
 * draft, disables the box and turns the Send into the house ring, so a second press has nothing to
 * land on. Enter sends and Shift+Enter breaks a line, chat's own convention.
 *
 * A REFUSAL IS A BANNER, NOT A TOAST. The hook's verbs toast because a row has nowhere to put a
 * sentence; this surface has the strip between the transcript and the box, which is exactly where
 * the eye is when a send comes back refused. It carries the server's own words — the board's dial
 * in `canSpawn`'s sentence, or the mid-turn 409 if the record here lagged the child — and is
 * dismissed by hand, because a refusal that fades before it is read is a Send that seemed to do
 * nothing. Warn, not danger: it is news about the board's capacity, not a loss. One sentence here
 * is not a refusal and rides in the same strip for the same reason: a send the hook's in-flight
 * guard dropped — a reply for this session already on its way from before this surface mounted —
 * says so rather than leaving a Send that did nothing.
 *
 * ASSEMBLED FROM `PromptInput`'S PRIMITIVES. The chat's own composer is 681 lines of chat-session
 * coupling — attachments, slash commands, a model picker, a queue — none of which a Metis can
 * take, so the box is the kit's form, body, textarea, footer, tools and submit and nothing more.
 *
 * WHAT IT DOES NOT DO. It fetches nothing of its own: the transcript is the view's read, and the
 * two writes — stop, and the reply — are the fleet's verbs handed down whole from the panel's one
 * `useKanbanMetis`, the reply being the one verb a row never has.
 */

type KanbanMetisConversationProps = {
  /** The session the row opened, by the id the board minted. Outlives the record: a session the
   *  fleet no longer lists is still a transcript on disk, read under its id. */
  sessionId: string;
  /** Its record in the fleet's last picture, or `undefined` once the board no longer lists it —
   *  reaped, or dropped by a seed. With no record there is nothing live to follow and the composer
   *  is offered; the server is the gate if the child is in fact still running. */
  session: KanbanMetisSession | undefined;
  /** The fleet's verbs, whole, from the panel's one `useKanbanMetis`: `stop` for a live session,
   *  and the reply the composer sends. */
  metis: KanbanMetis;
  /** Closes the conversation and hands the list its room back. */
  onBack: () => void;
  /** Where the panel puts this: its width beside the list, its cap beneath it. Layout is the
   *  caller's (doctrine §4); this surface only paints. */
  className?: string;
};

export function KanbanMetisConversation(props: KanbanMetisConversationProps) {
  const { sessionId, session, metis, onBack, className } = props;
  const { t } = useTranslation();

  const running = session !== undefined && session.state === 'running';
  // The reply as typed. This conversation's own — the panel keys the component on the session id,
  // so the draft dies with the conversation it was typed in rather than following the reader.
  const [draft, setDraft] = useState('');

  // ── The wires. ────────────────────────────────────────────────────────────────────────────────
  // The board's Metis, addressed by the id the board minted: `target.id` is what selects the
  // `metis` route, and `sessionId` beside it stays null (the view's own comment, below).
  const transcriptTarget: SubagentTranscriptTarget = { kind: 'metis', id: sessionId };
  // A send in flight. Essential: it is what turns the Send into the house ring and closes the box,
  // so a second press has nothing to land on — the hook's own guard would drop it, but a button that
  // looks live while nothing can happen is the button this state exists to prevent.
  const [sending, setSending] = useState(false);
  // The refusal as words, or `null` for nothing to say. Dismissed by hand, never on a timer: the
  // server's sentence is the whole of what a refused send has to show for itself. A second send
  // clears it, because the news is about the send that just came back and no older one.
  const [refusal, setRefusal] = useState<string | null>(null);
  const onStop = (): void => {
    metis.stop(sessionId);
  };
  const onSend = (text: string): void => {
    setSending(true);
    void metis
      .reply(sessionId, text)
      .then((outcome) => {
        // Only a reply that LANDED clears the draft: words that never reached her are words the
        // reader still has to send, and asking them to be typed again is the one thing this box must
        // never do.
        if (outcome.status === 'landed') {
          setDraft('');
          setRefusal(null);
          return;
        }
        // A `busy` answer is not a refusal — nothing was sent — but it is REACHABLE from here: this
        // surface is keyed on the session, so closing and reopening the row mounts a fresh one whose
        // own `sending` is false while the hook's guard still holds a reply for that session. Left
        // silent, the Send would look live and do nothing, which is the one thing this box may never
        // be; so the strip says what is actually happening.
        if (outcome.status === 'busy') {
          setRefusal(
            t('kanban.metis.conversation.pending', {
              defaultValue: 'Your last reply to her is still on its way — give it a moment',
            }),
          );
          return;
        }
        setRefusal(outcome.reason);
      })
      .finally(() => setSending(false));
  };

  const canSend = !running && !sending && draft.trim() !== '';
  const send = (): void => {
    if (canSend) onSend(draft.trim());
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    send();
  };
  // Enter sends, Shift+Enter breaks a line, and a composition in progress (an IME building a
  // character) is never taken as a send.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  // The view's one text slot names the session and its state: the model, then the state word off
  // the same four keys `KanbanMetisRow`'s table holds. A session the fleet no longer lists is named
  // by its id, which is all that is known of it.
  const label =
    session === undefined ? sessionId : `${session.model} · ${t(`kanban.metis.state.${session.state}`)}`;

  // The one sentence under the box, by state. Mid-turn is the words the operator reads INSTEAD of
  // a 409; the other two are the box's own status.
  const words = running
    ? t('kanban.metis.conversation.midTurn', { defaultValue: 'She is mid-turn — stop her to reply' })
    : sending
      ? t('kanban.metis.conversation.sending', { defaultValue: 'Sending…' })
      : t('kanban.metis.conversation.hint', { defaultValue: 'Enter sends · Shift+Enter for a new line' });

  return (
    <section
      className={cn('flex min-w-0 flex-col', className)}
      aria-label={t('kanban.metis.conversation.title', { defaultValue: 'Conversation' })}
      data-metis-conversation={sessionId}
      data-state={session?.state ?? 'unlisted'}
    >
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-card px-3 pb-3">
        {/* `sessionId` is `null` on purpose: that prop addresses an `agent` row through its chat,
            and a board's Metis belongs to no chat — the session id the board minted travels in
            `target.id`, which is what selects the `metis` route. `running` is the opened session's
            own state, so a finished Metis is read once and a live one keeps polling. */}
        <SubagentTranscriptView
          sessionId={null}
          target={transcriptTarget}
          label={label}
          running={running}
          onBack={onBack}
        />
      </div>

      {refusal !== null && (
        <div className="shrink-0 px-2 pt-2" data-metis-refusal>
          <Banner tone="warn" onClose={() => setRefusal(null)}>
            <span className="text-sm">{refusal}</span>
          </Banner>
        </div>
      )}

      <PromptInput
        status={sending ? 'submitted' : 'ready'}
        onSubmit={submit}
        className="m-2 shrink-0"
        aria-label={t('kanban.metis.conversation.reply', { defaultValue: 'Reply to her' })}
        data-composer-state={running ? 'mid-turn' : sending ? 'sending' : 'ready'}
      >
        <PromptInputBody>
          <PromptInputTextarea
            dir="auto"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={running || sending}
            // No placeholder while she runs: the box is dead on purpose and the sentence beneath it
            // says why, in ink a disabled control's placeholder would wash out.
            placeholder={running ? '' : t('kanban.metis.conversation.placeholder', { defaultValue: 'Reply to her — she wakes up to your words' })}
            aria-label={t('kanban.metis.conversation.reply', { defaultValue: 'Reply to her' })}
          />
        </PromptInputBody>
        <PromptInputFooter className="gap-2">
          {/* A status region, so a screen reader hears the box change hands — hint, then sending,
              then the hint again; or mid-turn the moment the driver resumes her under the reader. */}
          <PromptInputTools className="min-w-0">
            <p role="status" className="text-xs text-muted-foreground">
              {words}
            </p>
          </PromptInputTools>
          {running ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2"
              aria-label={t('kanban.metis.stop')}
              onClick={onStop}
            >
              <Square aria-hidden="true" />
              {t('kanban.metis.stop')}
            </Button>
          ) : (
            <PromptInputSubmit
              disabled={!canSend}
              aria-label={t('kanban.metis.conversation.send', { defaultValue: 'Send the reply' })}
            >
              {sending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : undefined}
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
    </section>
  );
}
