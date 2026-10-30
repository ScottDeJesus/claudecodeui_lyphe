import { MessageSquare, MoonStar } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { RailEyebrow, RailFold, RailRow } from '@/modules/station/RailRow';
import type { StationFocus, StationSession, StationSessionState } from '@/shared/station-types';
import type { StationHerMark, StationTier, Tone } from '@/shared/types';
import { Badge, Banner, Button, EmptyState, Spinner, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * How each state of a chat is said: its tone and its word, and whether its chip is the faint one (an outline, no fill). Working is
 * info, waiting on you warn, idle neutral, asleep neutral and faint. The house's `live` (a process up, nothing running) is "Idle"
 * on the page. Every chip says its state in words, so no state is colour alone (MAN-578).
 */
const STATE_LOOK: Record<StationSessionState, { tone: Tone; faint: boolean; key: string; english: string }> = {
  working: { tone: 'info', faint: false, key: 'station.sessions.state.working', english: 'Working' },
  waiting: { tone: 'warn', faint: false, key: 'station.sessions.state.waiting', english: 'Waiting on you' },
  live: { tone: 'neutral', faint: false, key: 'station.sessions.state.idle', english: 'Idle' },
  asleep: { tone: 'neutral', faint: true, key: 'station.sessions.state.asleep', english: 'Asleep' },
};

/**
 * A chat's state chip: the kit's `Badge` in its compact size (a dense row's), toned and worded by the state. A phrasing `<span>`,
 * since it rides inside a row's `<button>`. Used by this file's rows and by this module's `ChatStage`, which draws the same chip
 * on the stage, so a chat's state reads alike in both places.
 */
export function SessionStateChip({ state }: { state: StationSessionState }) {
  const { t } = useTranslation();
  const look = STATE_LOOK[state];
  return (
    <Badge
      as="span"
      tone={look.tone}
      variant={look.faint ? 'outline' : undefined}
      data-station-session-state={state}
      className="vv-badge--compact shrink-0 whitespace-nowrap"
    >
      {t(look.key, { defaultValue: look.english })}
    </Badge>
  );
}

/**
 * Her mark: her initial on the info tone's ground, then her words in its ink ("Kaylee is reading Bugfixes"). The initial is a
 * sign, `aria-hidden`; the words say it. Where she looks, shown without turning her face. On a row the words are cut to one
 * line: the row's own name stands right above them. On the closed fold's head they are the one place the chat is named, so
 * there (`wrap`) they run to a second line rather than lose the name, which is their last part.
 */
function HerMark({ her, wrap = false }: { her: StationHerMark; wrap?: boolean }) {
  return (
    <span data-station-her={her.sessionId} data-tone="info" className="flex min-w-0 items-start gap-1.5 text-xs font-medium text-tone-ink">
      <Badge as="span" tone="info" aria-hidden="true" className="vv-badge--compact size-4 shrink-0 justify-center rounded-full px-0 font-bold">
        {her.initial}
      </Badge>
      <span className={wrap ? 'line-clamp-2 break-words' : 'truncate'}>{her.words}</span>
    </span>
  );
}

type SessionRowProps = {
  session: StationSession;
  tier: StationTier;
  current: boolean;
  /** Her mark, when she looks at this chat. */
  her: StationHerMark | null;
  onPress: (focus: StationFocus) => void;
};

/**
 * One chat's row: its name over its project, its state chip at the right of the name's first line, the line she reads of it cut
 * to one line, and her mark when she looks at it. A chat waiting on him says what it waits on in the warn ink. The cut line is
 * read whole on the stage this row's press opens, which is how a finger reads it; the `Tooltip` over the row only repeats it for
 * a pointer, and for a keyboard as the row takes the focus. It is not drawn where nothing hovers (`hover:none`): a tap's
 * compatibility mouse events would open it and leave it standing over the stage the press has just opened. On the columns the
 * tip opens to the row's right, over her column; in the narrow stack, above the row.
 */
function SessionRow({ session, tier, current, her, onPress }: SessionRowProps) {
  const press = () => onPress({ kind: 'chat', sessionId: session.sessionId, label: session.name });
  return (
    <li className="flex min-w-0 flex-col">
      <Tooltip
        content={session.activity}
        position={tier === 'narrow' ? 'top' : 'right'}
        showOnFocus
        className="max-w-[min(28rem,calc(100vw-2rem))] whitespace-normal [overflow-wrap:anywhere] [@media(hover:none)]:hidden"
      >
        <RailRow kind="session" name={session.sessionId} current={current} onPress={press}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-start gap-2">
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium leading-5">{session.name}</span>
              <span className="flex h-5 shrink-0 items-center"><SessionStateChip state={session.state} /></span>
            </span>
            <span className="truncate text-xs text-muted-foreground">{session.project}</span>
            {session.activity !== '' && (
              <span
                data-station-session-line=""
                className={cn('truncate text-xs', session.state === 'waiting' ? 'text-warn-ink' : 'text-muted-foreground')}
              >
                {session.activity}
              </span>
            )}
            {her !== null && <HerMark her={her} />}
          </span>
        </RailRow>
      </Tooltip>
    </li>
  );
}

type SessionRowsProps = {
  tier: StationTier;
  /** His chats in her order (waiting on you, working, idle, asleep), or null until the first read has landed. */
  sessions: StationSession[] | null;
  /**
   * Why the FIRST read failed, in the server's own sentence; null while none has failed. A read that fails after a good one
   * keeps the rows on screen as they stand and says nothing (the design's read discipline), so this is only ever set while
   * `sessions` is null.
   */
  failure: string | null;
  onReread: () => void;
  focus: StationFocus | null;
  her: StationHerMark | null;
  asleepOpen: boolean;
  onAsleepOpen: (open: boolean) => void;
  onPress: (focus: StationFocus) => void;
};

/**
 * HIS SESSIONS, the rail's first section: "Sessions" over his chats in her order. The chats that are up (waiting on you, working,
 * idle) stand as rows; the asleep ones fold under "Asleep · N", opened only by his press. While her mark names an asleep chat and
 * the fold is closed, the fold's head carries her mark, so where she looks is never hidden.
 *
 * Its states, each a data condition: READING (no read has landed: a quiet "Reading your sessions…"); FAILED (the first read
 * failed: the warn `Banner` says why, with Try again, in the rows' place); NO SESSIONS ("No sessions yet"); NOTHING RUNNING
 * (every chat asleep: "Nothing is running" with how many sleep, the fold under it); and the rows. A later read that fails keeps
 * the rows as they stand.
 *
 * Used by this module's `WhereThingsStandView`.
 */
export function SessionRows({ tier, sessions, failure, onReread, focus, her, asleepOpen, onAsleepOpen, onPress }: SessionRowsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const up = (sessions ?? []).filter((session) => session.state !== 'asleep');
  const asleep = (sessions ?? []).filter((session) => session.state === 'asleep');
  // The chat on the stage, whose row is lit.
  const onStage = focus?.kind === 'chat' ? focus.sessionId : null;
  const markOf = (session: StationSession) => (her !== null && her.sessionId === session.sessionId ? her : null);
  const rowsOf = (list: StationSession[]) => (
    <ul className="flex min-w-0 flex-col">
      {list.map((session) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          tier={tier}
          current={session.sessionId === onStage}
          her={markOf(session)}
          onPress={onPress}
        />
      ))}
    </ul>
  );
  // Her mark, lifted to the asleep fold's head while the fold hides the chat she looks at.
  const herAsleep = her !== null && asleep.some((session) => session.sessionId === her.sessionId);

  return (
    <section aria-labelledby={headingId} data-station-sessions="" className="flex min-w-0 flex-col gap-1.5">
      <RailEyebrow as="h2" id={headingId}>{t('station.sessions.heading', { defaultValue: 'Sessions' })}</RailEyebrow>

      {sessions === null ? (
        failure !== null ? (
          <div role="alert" data-station-sessions-failed="">
            <Banner
              tone="warn"
              action={(
                <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onReread}>
                  {t('station.sessions.retry', { defaultValue: 'Try again' })}
                </Button>
              )}
            >
              <p className="break-words text-sm font-medium">{failure}</p>
            </Banner>
          </div>
        ) : (
          <div data-station-sessions-reading="" className="grid place-items-center py-6">
            <Spinner size={20} label={t('station.sessions.reading', { defaultValue: 'Reading your sessions…' })} />
          </div>
        )
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={t('station.sessions.none.title', { defaultValue: 'No sessions yet' })}
          message={t('station.sessions.none.message', { defaultValue: 'A chat you start in CloudCLI stands here, with what it is doing.' })}
        />
      ) : (
        <>
          {up.length === 0 ? (
            <EmptyState
              icon={MoonStar}
              title={t('station.sessions.nothingRunning.title', { defaultValue: 'Nothing is running' })}
              message={t('station.sessions.nothingRunning.message', {
                count: asleep.length,
                defaultValue_one: 'One chat is asleep. A message wakes it.',
                defaultValue_other: '{{count}} chats are asleep. A message wakes any of them.',
              })}
            />
          ) : rowsOf(up)}
          {asleep.length > 0 && (
            <RailFold
              kind="asleep"
              label={t('station.sessions.asleep', { count: asleep.length, defaultValue: 'Asleep · {{count}}' })}
              open={asleepOpen}
              onOpenChange={onAsleepOpen}
              current={onStage !== null && asleep.some((session) => session.sessionId === onStage)}
              closedMark={herAsleep && her !== null ? <HerMark her={her} wrap /> : undefined}
            >
              {rowsOf(asleep)}
            </RailFold>
          )}
        </>
      )}
    </section>
  );
}
