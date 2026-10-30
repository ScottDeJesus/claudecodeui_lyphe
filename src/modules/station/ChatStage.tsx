import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useStation } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { StageGone } from '@/modules/station/FocusFallback';
import { SessionStateChip } from '@/modules/station/SessionRows';
import { openInCloudcli } from '@/shared/cloudcliDoors';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { StationFocus, StationSession } from '@/shared/station-types';
import { Button, Card, Spinner } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

/** A chat on the stage. */
type ChatFocus = Extract<StationFocus, { kind: 'chat' }>;

type ChatStageViewProps = {
  focus: ChatFocus;
  /** The chat as his sessions hold it: undefined until they have been read, null once they have and it is not among them. */
  session: StationSession | null | undefined;
  /** "Open the chat": the chat itself, in CloudCLI. */
  onOpenChat: () => void;
};

/**
 * A CHAT ON THE STAGE, drawn whole from the very row the rail reads: the stage's head already names it (the session's glyph and
 * word over its name), so the body says the rest once. Its state, with the rail's own chip; its project and when it last moved;
 * the line she reads of it, WHOLE and wrapping (on the rail it is cut to one line: here a finger reads it); "Open the chat", the
 * chat in CloudCLI; and a quiet line with the words that ask her about it ("Say “What is <name> doing?”"). A chat waiting on him
 * says what it waits on in the warn ink, as its row does. The open is a 44 px catch under a finger below 768 px (the touch law).
 *
 * While his sessions have not been read, a quiet "Reading your sessions…" waits, so a stage restored on a reload never calls gone
 * a chat it has not looked for; a chat his sessions no longer hold says so in the kind's own line (`StageGone`).
 *
 * `data-station-chat` reads which of the three it drew. A pure view: `ChatStage` below binds it. Drawn on the stage by
 * `StationStage` for a `chat` focus (registered in `stageViews.ts`), and by `.verify/kaylee-station-shots.mjs` for `home`.
 */
export function ChatStageView({ focus, session, onOpenChat }: ChatStageViewProps) {
  const { t } = useTranslation();

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

  const moved = session.updatedAt === null ? null : formatRelativeTime(session.updatedAt);
  return (
    <Card data-station-chat="session" data-station-chat-session={session.sessionId} className="flex min-w-0 flex-col gap-4 p-4 lg:p-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <SessionStateChip state={session.state} />
        <span className="min-w-0 break-words">{session.project}</span>
        {moved !== null && session.updatedAt !== null && (
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
      <Button variant="outline" data-station-chat-open="" className="self-start max-md:h-11" onClick={onOpenChat}>
        {t('station.chat.open', { defaultValue: 'Open the chat' })}
        <ArrowUpRight aria-hidden="true" />
      </Button>
      <p data-station-chat-say="" className="text-sm text-muted-foreground">
        {t('station.chat.say', { name: session.name, defaultValue: 'Say “What is {{name}} doing?”' })}
      </p>
    </Card>
  );
}

/**
 * The chat's stage on the page: registered for the `chat` kind in `stageViews.ts`, drawn by `StationStage`. It finds the chat
 * in his sessions, the very rows the rail draws, and binds the open, and hands them to `ChatStageView`, which draws every state.
 */
export function ChatStage({ focus }: { focus: ChatFocus }) {
  const navigate = useNavigate();
  const { phone } = useStation();
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { sessions } = useStationSessions();
  // null (not yet read) stays undefined for the view, which waits; a read that lacks the chat is null, which the view calls gone.
  const session = sessions === null ? undefined : (sessions.find((item) => item.sessionId === focus.sessionId) ?? null);

  return (
    <ChatStageView
      focus={focus}
      session={session}
      // The chat in CloudCLI: the window named `cloudcli` on a desktop, this window on a phone or in the home-screen app (the door's own rule).
      onOpenChat={() => openInCloudcli(`/session/${encodeURIComponent(focus.sessionId)}`, navigate, { phone, pwa: isPWA })}
    />
  );
}
