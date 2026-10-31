import type { TFunction } from 'i18next';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useStation } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { StageGone } from '@/modules/station/stageStates';
import { stationStamp } from '@/modules/station/stationClock';
import { SessionStateChip } from '@/modules/station/SessionRows';
import { openInCloudcli } from '@/shared/cloudcliDoors';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { StationFocus, StationSession } from '@/shared/station-types';
import { Banner, Button, Card, Spinner } from '@/shared/ui';
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
};

/**
 * A CHAT ON THE STAGE, drawn whole from the very row the rail reads: the stage's head already names it (the session's glyph and
 * word over its name), so the body says the rest once. Its state, with the rail's own chip; its project and when it last moved (a
 * clock time, in the page's one clock: `stationClock.ts`); the line she reads of it, WHOLE and wrapping (on the rail it is cut to one line: here a finger reads it); "Open the chat", the
 * chat in CloudCLI; and a quiet line with the words that ask her about it ("Say “What is <name> doing?”"). A chat waiting on him
 * says what it waits on in the warn ink, as its row does. The open is a 44 px catch under a finger below 768 px (the touch law).
 *
 * While his sessions have not been read, a quiet "Reading your sessions…" waits, so a stage restored on a reload never calls gone
 * a chat it has not looked for; when the first read has failed it says so in the rail's own warn banner, with Try again, rather
 * than read for good; a chat his sessions no longer hold says so in the kind's own line (`StageGone`).
 *
 * `data-station-chat` reads which of the four it drew. A pure view: `ChatStage` below binds it. Drawn on the stage by
 * `StationStage` for a `chat` focus (registered in `stageViews.ts`), and by `.verify/kaylee-station-shots.mjs` for `home`.
 */
export function ChatStageView({ focus, session, onOpenChat, failure = null, onReread }: ChatStageViewProps) {
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
  return (
    <Card data-station-chat="session" data-station-chat-session={session.sessionId} className="flex min-w-0 flex-col gap-4 p-4 lg:p-5">
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
      <Button variant="outline" data-station-chat-open="" className="self-start finger:h-11" onClick={onOpenChat}>
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

  return (
    <ChatStageView
      focus={focus}
      session={session}
      failure={failure}
      onReread={reread}
      // The chat in CloudCLI: the window named `cloudcli` on a desktop, this window on a phone or in the home-screen app (the door's own rule).
      onOpenChat={() => openInCloudcli(`/session/${encodeURIComponent(focus.sessionId)}`, navigate, { phone, pwa: isPWA })}
    />
  );
}
