import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { QuestionText, replyMaterialOf } from '@/modules/chat';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { useLatestReply } from '@/modules/station/hooks/useLatestReply';
import type { LatestReply } from '@/modules/station/hooks/useLatestReply';
import { useOpenChatInCloudcli } from '@/modules/station/hooks/useOpenChatInCloudcli';
import { StageOpen } from '@/modules/station/StageOpen';
import { StageGone } from '@/modules/station/stageStates';
import { stationStamp } from '@/modules/station/stationClock';
import { SessionStateChip } from '@/modules/station/SessionStateChip';
import type { StationFocus, StationSession } from '@/shared/station-types';
import { Banner, Button, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A chat on the stage. */
type ChatFocus = Extract<StationFocus, { kind: 'chat' }>;

/**
 * When the chat last moved, on his clock and the locale's (`stationStamp`): the clock alone today ("2:04 PM"), "yesterday 7:34 PM",
 * else its day and clock ("Oct 26 2:04 PM"). A clock time stays true for as long as the stage stays open, with no tick to keep it
 * so. Empty for a chat that carries no time.
 */
function movedWords(updatedAt: string | null, t: TFunction): string {
  const stamp = updatedAt === null ? null : stationStamp(updatedAt);
  if (stamp === null) return '';
  if (stamp.day === 'today') return t('station.chat.when.today', { clock: stamp.clock, defaultValue: '{{clock}}' });
  if (stamp.day === 'yesterday') return t('station.chat.when.yesterday', { clock: stamp.clock, defaultValue: 'yesterday {{clock}}' });
  return t('station.chat.when.day', { date: stamp.date, clock: stamp.clock, defaultValue: '{{date}} {{clock}}' });
}

type ChatStageViewProps = {
  focus: ChatFocus;
  /** The chat as his sessions hold it: undefined until they have been read, null once they have and it is not among them. */
  session: StationSession | null | undefined;
  /** "Open the chat": the chat itself, in CloudCLI. */
  onOpenChat: () => void;
  /** Why his sessions' first read failed, in the server's sentence; null while none has. Only drawn while `session` is undefined. */
  failure?: string | null;
  /** Try again: his sessions read once more. */
  onReread?: () => void;
  /**
   * The last thing the chat said, whole (`useLatestReply`): undefined while it has not been read, null when the chat has said
   * nothing yet. Absent on a fixture that draws the chat's one line alone.
   */
  reply?: LatestReply | null;
};

/** The ink of each material's mark, as the transcript's reply marks wear it (the chat module's `reading.css`). */
const MARK_INK = { mercury: 'var(--ink-muted)', tube: 'var(--tube)', wire: 'var(--wire)', plasma: 'var(--plasma)' } as const;

/**
 * A CHAT ON THE PANEL. The panel's head already names it (the session's glyph and word over its name), so the body says the rest
 * once, on the panel's own ground with no box of its own:
 *
 * - ITS FACTS on one line: its state, with the rail's own chip; its project; when it last moved (a clock time, in the page's one
 *   clock: `stationClock.ts`).
 * - WHAT IT IS DOING, the one line the companion reads of it, whole and wrapping. A chat waiting on you says what it waits on in the
 *   warn ink, as its row does.
 * - ITS LATEST REPLY, WHOLE, under a hairline: the last thing the chat said, as the chat wrote it (markdown, through the chat's own
 *   renderer), headed by the loop of the model that wrote it and when. The panel is where a reply is read in full; the row had room
 *   for one line. Nothing is drawn there while the chat has said nothing.
 * - "Open" at the panel's foot (`StageOpen`): the chat itself, in the workspace.
 *
 * While the sessions have not been read, a quiet "Reading your sessions…" waits, so a panel restored on a reload never calls gone
 * a chat it has not looked for; when the first read has failed it says so in the rail's own warn banner, with Try again, rather
 * than read for good; a chat the sessions no longer hold says so in the kind's own line (`StageGone`).
 *
 * `data-station-chat` reads which of the four it drew. A pure view: `ChatStage` below binds it. Drawn on the panel by
 * `StationStage` for a `chat` focus (registered in `stageViews.ts`), and by `.verify/kaylee-station-shots.mjs` for `home`.
 */
export function ChatStageView({ focus, session, onOpenChat, failure = null, onReread, reply = null }: ChatStageViewProps) {
  const { t } = useTranslation();

  if (session === undefined && failure !== null) {
    return (
      <div role="alert" data-station-chat="failed">
        <Banner
          tone="warn"
          action={onReread && (
            <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs finger:h-11" onClick={onReread}>
              {t('station.sessions.retry', { defaultValue: 'Try again' })}
            </Button>
          )}
        >
          <p className="break-words text-sm font-medium">{failure}</p>
        </Banner>
      </div>
    );
  }
  if (session === undefined) {
    return (
      <div data-station-chat="reading" className="grid place-items-center py-10">
        <Spinner size={32} label={t('station.sessions.reading', { defaultValue: 'Reading your sessions…' })} />
      </div>
    );
  }
  if (session === null) {
    return (
      <div data-station-chat="gone">
        <StageGone focus={focus} />
      </div>
    );
  }

  const moved = movedWords(session.updatedAt, t);
  const said = reply !== null && reply.at !== null ? movedWords(reply.at, t) : '';
  return (
    <div data-station-chat="session" data-station-chat-session={session.sessionId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <SessionStateChip state={session.state} />
        <span className="min-w-0 break-words">{session.project}</span>
        {moved !== '' && session.updatedAt !== null && (
          <>
            <span aria-hidden="true">{'·'}</span>
            <time dateTime={session.updatedAt}>{t('station.chat.moved', { when: moved, defaultValue: 'last moved {{when}}' })}</time>
          </>
        )}
      </div>
      {session.activity !== '' && (
        <p
          data-station-chat-line=""
          className={cn('whitespace-pre-wrap break-words text-base leading-relaxed', session.state === 'waiting' ? 'text-warn-ink' : 'text-foreground')}
        >
          {session.activity}
        </p>
      )}
      {reply !== null && (
        <section
          data-station-chat-reply=""
          aria-label={t('station.chat.reply', { defaultValue: 'Its latest reply' })}
          className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
        >
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span
              role="img"
              aria-label={reply.model ?? t('station.chat.reply', { defaultValue: 'Its latest reply' })}
              title={reply.model ?? undefined}
              className="size-3.5 shrink-0 rounded-full border-2"
              style={{ borderColor: MARK_INK[replyMaterialOf(reply.model ?? '')] }}
            />
            {said !== '' && reply.at !== null && <time dateTime={reply.at}>{said}</time>}
          </p>
          <QuestionText text={reply.text} className="min-w-0 max-w-[46rem]" />
        </section>
      )}
      <StageOpen name={t('station.chat.open', { defaultValue: 'Open the chat' })} data-station-chat-open="" onOpen={onOpenChat} />
    </div>
  );
}

/**
 * The chat's stage on the page: registered for the `chat` kind in `stageViews.ts`, drawn by `StationStage`. It finds the chat
 * in his sessions, the very rows the rail draws, reads the last thing it said (`useLatestReply`, again each time the chat moves), and
 * binds the open, and hands them to `ChatStageView`, which draws every state.
 */
export function ChatStage({ focus }: { focus: ChatFocus }) {
  const openChat = useOpenChatInCloudcli();
  const { sessions, failure, reread } = useStationSessions();
  // The answer his sessions held when this chat was staged (the stage's body is keyed by its focus, so this is taken once per chat).
  // State, because it must outlive the renders: an answer that was already out when the chat was staged cannot know a chat staged
  // after it (she has just opened or created it, and its row comes with the next read), so a chat that answer lacks is "not yet" and
  // not "no longer" until a newer answer, which is a new array, has landed.
  const [heldAtStaging] = useState(sessions);
  // null (not yet read) stays undefined for the view, which waits; a chat a read that came after the staging lacks is null, which the view calls gone.
  const session = sessions === null
    ? undefined
    : (sessions.find((item) => item.sessionId === focus.sessionId) ?? (sessions === heldAtStaging ? undefined : null));

  // Its last words, read again whenever the sessions say the chat moved; what is held stays drawn while the newer one is read.
  const reply = useLatestReply(focus.sessionId, session?.updatedAt ?? null);

  return (
    <ChatStageView
      focus={focus}
      session={session}
      reply={reply ?? null}
      failure={failure}
      onReread={reread}
      // The chat in CloudCLI: the station gives way to the workspace, in this tab.
      onOpenChat={() => openChat(focus.sessionId)}
    />
  );
}
