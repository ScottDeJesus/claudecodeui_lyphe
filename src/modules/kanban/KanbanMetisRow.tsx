import { ChevronRight, Play, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
import type { KanbanMetisSession, Tone } from '@/shared/types';
import { Badge, Button, LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * ONE METIS AS A ROW: who is paying for her, whether she is still spending, and the one thing the
 * reader can do about it.
 *
 * Drawn by `KanbanMetisPanel`, once per live or recent session on the board, and by nothing else.
 *
 * THE ROW IS THE DOOR. Its body — mark, state, model, clock, board — is one button that opens the
 * session's conversation beside the list, so the target is the whole row and not a word at its
 * edge, which on a phone is the difference between a tap and a miss. A chevron at the body's end
 * is the mark that it opens; the row that IS open carries a left bar and a wash and says so with
 * `aria-current`, because the list stays on screen while a conversation is read and the reader has
 * to see which one it is. The bar is the greyscale signal; the wash is the colour one. On a phone
 * the list folds to a few rows the moment a conversation opens, so the row that becomes the open
 * one scrolls itself back into its list — a highlight below the fold tells nobody anything.
 *
 * THE MARK, NEVER THE WORD. The provider is drawn through the one door that branches on a provider
 * name (`LLMProviderLogo`), which the board header still wears; the composer's switch draws the
 * mascot itself in its off state, and the soul pins wear Claude's mascot. It is not hidden from the
 * accessibility tree: no word beside it spells the provider, so the logo's own `role="img"` name is
 * how a screen reader learns which vendor's money this row is spending.
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
 * THE VERBS ARE RANKED. Stop is destructive and rare, so it is findable but not tempting: an
 * outline, no fill, only while she runs. Resume is the safe verb and the only one given a fill
 * (`tonal`), only on a row she can be resumed from — stopped or failed. A completed row has nothing
 * to resume: she ended because nothing was claimable, and the panel's Launch is how a fresh one is
 * asked to look again. On a phone the verbs keep their marks and drop their words; the `aria-label`
 * carries the word at every width. The reply is not a row verb: it needs a transcript to reply
 * under, so it lives on the conversation the row opens.
 *
 * WHAT IT DOES NOT DO. It reads nothing and holds no state beyond its clock. The session, the open
 * flag and the three handlers arrive as props — the panel is where they are bound — so the row
 * never reaches for a route, a hook or a socket of its own.
 */

type KanbanMetisRowProps = {
  session: KanbanMetisSession;
  /** True while this row's conversation is the one the panel has open beside the list. */
  open: boolean;
  /** Asks the driver to end this session. Only reachable while it runs. */
  onStop: (sessionId: string) => void;
  /** Asks the driver to continue this session's conversation. Only reachable once it has stopped or failed. */
  onResume: (sessionId: string) => void;
  /** Opens this session's conversation beside the list. */
  onOpen: (sessionId: string) => void;
};

/**
 * What each state wears and says, in one table, so the tone and the word can never disagree about
 * which state a row is in. The keys are literal so a grep over `t('kanban.metis.…')` finds them;
 * `KanbanMetisConversation` reads the same four keys for its header and this table is their home.
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
  const { session, open, onStop, onResume, onOpen } = props;

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
  const openConversation = () => onOpen(session.sessionId);

  const word = STATE[session.state];

  // Becoming the open row is the moment the list folds around it (the panel caps the list in the
  // same commit), so this runs after that layout and brings the row back inside the fold.
  // `nearest` moves nothing when the row is already in view.
  const rowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (open) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  return (
    <li
      ref={rowRef}
      className={cn(
        'flex items-center gap-1 border-l-2 pr-2',
        open ? 'border-primary bg-muted/40' : 'border-transparent',
      )}
      data-session-id={session.sessionId}
      data-state={session.state}
      data-provider={session.provider}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
        aria-current={open || undefined}
        onClick={openConversation}
      >
        {/* The verb, for a screen reader only: sighted readers get it from the chevron and the
            wash, and a visible "Open" on every row would be one word repeated down the list. */}
        <span className="sr-only">{t('kanban.metis.open', { defaultValue: 'Open the conversation' })}</span>
        <LLMProviderLogo provider={session.provider} className="h-5 w-5 shrink-0" />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* State, then model, then the clock at the far edge: the badge is what an eye lands on,
              the model is what it reads next, and the time is where a tabular figure always sits. */}
          <div className="flex min-w-0 items-center gap-2">
            <Badge as="span" tone={word.tone} className="vv-badge--compact shrink-0 gap-1">
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

        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <div className="flex shrink-0 items-center gap-1">
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
