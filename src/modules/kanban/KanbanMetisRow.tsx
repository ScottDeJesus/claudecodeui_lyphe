import { Play, ScrollText, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
import type { KanbanMetisSession, Tone } from '@/shared/types';
import { Badge, Button, LLMProviderLogo } from '@/shared/ui';

/**
 * ONE METIS AS A ROW: who is paying for her, whether she is still spending, and the one thing the
 * reader can do about it.
 *
 * Drawn by `KanbanMetisPanel`, once per live or recent session on the board, and by nothing else.
 *
 * THE MARK, NEVER THE WORD. The provider is the same logo the composer's DeepSeek switch, the soul
 * pins and the board header draw, through the one door that branches on a provider name
 * (`LLMProviderLogo`). It is not hidden from the accessibility tree: no word beside it spells the
 * provider, so the logo's own `role="img"` name is how a screen reader learns which vendor's money
 * this row is spending.
 *
 * THE STATE IS A BADGE, AND RUNNING IS THE ONE THAT MOVES. Four states, four tones from the closed
 * set (doctrine §5): `info` while she runs, `positive` when she finished on her own, `neutral` when
 * the operator stopped her, `warn` when the child died — amber, not red, because red is reserved
 * for destructive (doctrine §5) and a failed row is news, not a verb. The colour is never the whole
 * signal (doctrine §6): the word is on the badge, and a running row alone carries a pulsing filled
 * dot inside the badge and a clock that ticks. A finished row and a running one cannot be confused
 * in greyscale, which is the whole point of an operator watching money being spent.
 *
 * ONE CLOCK EITHER WAY, `RunCard`'s own rule: since she started while she runs, ticking each
 * second; since she ended once she has, re-read once a minute — an age read once said "2s ago" an
 * hour later. The record stores epoch MILLISECONDS and `useElapsed` reads epoch seconds, so the
 * conversion happens here and nowhere else.
 *
 * THE VERBS ARE RANKED. Transcript is the everyday verb (watch what she is doing) and is the
 * quietest: a ghost button with the mark. Stop is destructive and rare, so it is findable but not
 * tempting: an outline, no fill, only while she runs. Resume is the safe verb and the only one
 * given a fill (`tonal`), only on a row she can be resumed from — stopped or failed. A completed
 * row has nothing to resume: she ended because nothing was claimable, and the panel's Launch is
 * how a fresh one is asked to look again. On a phone the verbs keep their marks and drop their
 * words; the `aria-label` carries the word at every width.
 *
 * WHAT IT DOES NOT DO. It reads nothing and holds no state beyond its clock. The session and the
 * three handlers arrive as props — the panel is where they are bound — so the row never reaches for
 * a route, a hook or a socket of its own.
 */

type KanbanMetisRowProps = {
  session: KanbanMetisSession;
  /** Asks the driver to end this session. Only reachable while it runs. */
  onStop: (sessionId: string) => void;
  /** Asks the driver to continue this session's conversation. Only reachable once it has stopped or failed. */
  onResume: (sessionId: string) => void;
  /** Hands the transcript view the panel body. */
  onOpenTranscript: (sessionId: string) => void;
};

/**
 * What each state wears and says, in one table, so the tone and the word can never disagree about
 * which state a row is in. The keys are literal so a grep over `t('kanban.metis.…')` finds them.
 */
const STATE: Record<KanbanMetisSession['state'], { tone: Tone; key: string }> = {
  running: { tone: 'info', key: 'kanban.metis.state.running' },
  completed: { tone: 'positive', key: 'kanban.metis.state.completed' },
  stopped: { tone: 'neutral', key: 'kanban.metis.state.stopped' },
  failed: { tone: 'warn', key: 'kanban.metis.state.failed' },
};

/** Milliseconds in the record, seconds on the clock. */
const toSeconds = (epochMs: number): number => epochMs / 1000;

export function KanbanMetisRow(props: KanbanMetisRowProps) {
  const { t } = useTranslation();
  const { session, onStop, onResume, onOpenTranscript } = props;

  const running = session.state === 'running';
  const resumable = session.state === 'stopped' || session.state === 'failed';
  // `null` for an ended row with no end stamp yet: the hook then holds no timer at all.
  const elapsed = useElapsed(
    running ? toSeconds(session.startedAt) : session.endedAt === null ? null : toSeconds(session.endedAt),
    running ? 1_000 : 60_000,
  );

  // Each verb names the ONE session this row is, and this row is the only place that knows which.
  const stop = () => onStop(session.sessionId);
  const resume = () => onResume(session.sessionId);
  const openTranscript = () => onOpenTranscript(session.sessionId);

  const word = STATE[session.state];

  return (
    <li
      className="flex items-center gap-3 px-3 py-2"
      data-session-id={session.sessionId}
      data-state={session.state}
      data-provider={session.provider}
    >
      <LLMProviderLogo provider={session.provider} className="h-5 w-5 shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* State, then model, then the clock at the far edge: the badge is what an eye lands on,
            the model is what it reads next, and the time is where a tabular figure always sits. */}
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={word.tone} className="vv-badge--compact shrink-0 gap-1">
            {running && <span aria-hidden="true" className="vv-tone-dot vv-pulse" data-filled="true" />}
            {t(word.key)}
          </Badge>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{session.model}</span>
          {elapsed && (
            <span className="vv-tabular ml-auto shrink-0 text-xs text-muted-foreground">
              {running ? elapsed : t('kanban.metis.ago', { elapsed })}
            </span>
          )}
        </div>
        {/* The board she works, and on a failed row the one fact the reader would otherwise open
            the log to learn. Quiet on purpose: in a per-board panel the name repeats down the list. */}
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{session.boardName}</span>
          {session.state === 'failed' && session.exitCode !== null && (
            <span className="vv-tabular shrink-0">{t('kanban.metis.exitCode', { code: session.exitCode })}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground"
          aria-label={t('kanban.metis.transcript')}
          onClick={openTranscript}
        >
          <ScrollText aria-hidden="true" />
          <span className="hidden sm:inline">{t('kanban.metis.transcript')}</span>
        </Button>
        {running && (
          <Button variant="outline" size="sm" className="h-7 px-2" aria-label={t('kanban.metis.stop')} onClick={stop}>
            <Square aria-hidden="true" />
            <span className="hidden sm:inline">{t('kanban.metis.stop')}</span>
          </Button>
        )}
        {resumable && (
          <Button variant="tonal" size="sm" className="h-7 px-2" aria-label={t('kanban.metis.resume')} onClick={resume}>
            <Play aria-hidden="true" />
            <span className="hidden sm:inline">{t('kanban.metis.resume')}</span>
          </Button>
        )}
      </div>
    </li>
  );
}
