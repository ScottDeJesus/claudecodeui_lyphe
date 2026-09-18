import { Bot, ChevronDown, ChevronUp, Play, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanMetisConversation } from '@/modules/kanban/KanbanMetisConversation';
import { KanbanMetisRow } from '@/modules/kanban/KanbanMetisRow';
import { useKanbanMetis } from '@/modules/kanban/hooks/useKanbanMetis';
import type { KanbanMetisSession, Tone } from '@/shared/types';
import {
  Badge,
  Button,
  buttonVariants,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  Spinner,
} from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * THE FLEET, WATCHED FROM THE BOARD: every Metis this board has running or has run recently, how
 * many that is against the dial that caps them, the one button that starts another, the one that
 * wakes the driver, and — beside the list, never instead of it — the conversation of whichever
 * row the reader opened.
 *
 * Mounted by `KanbanPanel` beside the card drawer, while a board is selected, and by nothing else.
 *
 * A PANEL, NOT A DIALOG. A dialog cannot be watched while the board moves, and watching is the
 * whole job of this surface. It is a bounded strip in the board's own flow — the rail keeps its
 * `flex-1`, this takes what its rows need up to a cap and scrolls inside it — so a lane is never
 * covered. It FOLDS to its header bar, because on a phone a permanent strip is a third of the
 * screen; the bar alone answers the folded reader's question — running, and room for more.
 *
 * THE LIST NEVER LEAVES. Several Metis run at once now, and the reader watches them as a fleet:
 * opening one row's conversation must not take the others off the screen, or a session dying in
 * the next row goes unseen while its neighbour is read. So the conversation is laid BESIDE the
 * list on a desktop — two columns, the list narrower — and BENEATH it on a phone, where the list
 * folds to a few rows that scroll and the conversation takes the rest. The open row is highlighted
 * (`KanbanMetisRow`), and the conversation's own Back gives the list its room back. A full-panel
 * takeover would be the pilot terminal by another name, and it is not this.
 *
 * FOUR PIECES OF NEWS, NEVER ONE SPINNER. The first read is a spinner with a label; a board with
 * no session is an `EmptyState` whose MESSAGE carries the invitation and draws no button — a second
 * Launch under the header's would be two identical names in one region and a second accent fill;
 * a board with sessions is the list; an opened row puts its conversation beside it. The header,
 * and Launch with it, stays through all four.
 *
 * THE FIGURE IS LIVE AGAINST THE DIAL. `1/2 running` is the board's capacity in four characters.
 * At the dial the word changes — `2/2 at the dial`, `2/2 full` on a phone, where the word is never
 * dropped because a touch reader cannot reach a title — and Launch is disabled, since the server
 * would refuse the press (`canSpawn`) and a button that appears to do nothing is a broken button.
 * A dial of zero is the board switched off and says so. `info` while anything runs, `neutral`
 * otherwise: a full board is healthy, not a warning, and the word carries the cap (doctrine §6).
 *
 * TWO BUTTONS ON THE HEADER, ONE FILL. Launch is the primary action and the only accent fill;
 * every row verb sits below it on the ladder (`KanbanMetisRow`). Nudge — ⚡ — wakes the driver's
 * tick now rather than at its next fifteen seconds; an outline, because it starts nothing the dial
 * and the board's governor would not have started anyway. On a phone it keeps the bolt and drops
 * the word, and Launch shortens to its verb, so the board's name keeps its width.
 *
 * ROWS ARE ORDERED FOR TRIAGE, not by the server's clock: spending first, then died, then stopped,
 * then finished — and within each, the newest. Keyed on the session id, so a row that changes
 * state moves rather than remounts. What it reads is `useKanbanMetis` alone — this board's fleet,
 * seeded once by REST and kept current by the `kanban_metis_state` frame — and the verbs it hands
 * the rows and the conversation; the two pieces of state kept here are the reader's own view.
 */

type KanbanMetisPanelProps = {
  boardId: string;
  boardName: string;
};

/** Triage order: spending first, then needs a look, then put down by hand, then finished on its own. */
const STATE_RANK: Record<KanbanMetisSession['state'], number> = {
  running: 0,
  failed: 1,
  stopped: 2,
  completed: 3,
};

function orderForTriage(sessions: KanbanMetisSession[]): KanbanMetisSession[] {
  return [...sessions].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || b.startedAt - a.startedAt);
}

/**
 * How tall each piece may grow. The caps sit on the SCROLLING CHILDREN, never on a grid or a
 * percentage height: a flex column under a `max-h` shrinks its `min-h-0 flex-1` child to fit
 * (measured), and two capped columns in a row take the taller one's height. With a conversation
 * open, a phone's list folds to a few rows and the conversation takes up to half the SCREEN — a
 * fixed cap left three lines of transcript above the composer — and a desktop's two share one cap.
 */
const CAP = {
  list: 'max-h-72',
  fleetBesideConversation: 'max-h-32 md:max-h-[32rem]',
  conversation: 'max-h-[min(26rem,55dvh)] md:max-h-[32rem]',
} as const;

/**
 * The header's figure, in one table, so the tone and the word can never disagree about what the
 * board has room for. `why` is `canSpawn`'s own refusal, computed the way the server computes it
 * and `null` while there is room, so Launch is disabled exactly when the press would be refused;
 * `short` is the cap's word at phone width, where a `title` cannot be reached and the word is the
 * whole signal.
 */
function dialReading(
  running: number,
  dial: number | null,
  t: (key: string, options: { defaultValue: string }) => string,
): { tone: Tone; figure: string; word: string; short: string; why: string | null } {
  const tone: Tone = running > 0 ? 'info' : 'neutral';
  const figure = dial === null ? String(running) : `${running}/${dial}`;
  if (dial === 0) {
    const word = t('kanban.metis.dial.off', { defaultValue: 'dial off' });
    const why = t('kanban.metis.launchOff', { defaultValue: 'The dial is off — raise it to launch a session' });
    return { tone: 'neutral', figure, word, short: t('kanban.metis.dial.offShort', { defaultValue: 'off' }), why };
  }
  if (dial !== null && running >= dial) {
    const word = t('kanban.metis.dial.full', { defaultValue: 'at the dial' });
    const why = t('kanban.metis.launchFull', { defaultValue: 'No room on the dial — stop a session or raise it to launch another' });
    return { tone, figure, word, short: t('kanban.metis.dial.fullShort', { defaultValue: 'full' }), why };
  }
  return { tone, figure, word: t('kanban.metis.dial.running', { defaultValue: 'running' }), short: '', why: null };
}

export function KanbanMetisPanel({ boardId, boardName }: KanbanMetisPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // Whether the strip shows only its header bar. Essential: nothing else in the app knows the
  // reader folded it, and a phone reader who wants the board back has to be able to say so.
  const [folded, setFolded] = useState(false);
  // Which row's conversation is open beside the list, WITH the board that opened it, or `null` for
  // the list alone. Essential: it is the one decision that changes what the body is, and no
  // session record carries it. The board id is held BESIDE the session id rather than cleared when
  // the rail moves: a session id is one board's mint, so a row opened on board A must read as
  // nothing-open under board B. Read against the board now selected, just below — no effect, and
  // no `key` on the mount, which would remount the panel and re-seed a fleet it already holds.
  const [opened, setOpened] = useState<{ boardId: string; sessionId: string } | null>(null);

  // The fleet this board is running, and the verbs over it. `metis` is read whole here and its
  // rows and its count are both taken from it, so nothing can disagree about how many run.
  const metis = useKanbanMetis(boardId);
  const { launch } = metis;

  // ── The wires. ────────────────────────────────────────────────────────────────────────────────
  // The cap this board runs under, as the driver reads it — the hook fetches the driver's own
  // reading and hands the one number this header divides by. `null` is an UNKNOWN cap: the figure
  // falls back to the live count alone, because a cap nobody read is not a cap of zero.
  const dial: number | null = metis.dial;
  // A nudge in flight. Essential: the bolt is a button and a driver tick is seconds of reaping and
  // claiming, so without it a held press would queue a tick per repeat. `data-nudging` and the
  // disabled state are the same fact, one for the eye and one for the DOM.
  const [nudging, setNudging] = useState(false);
  const onNudge = (): void => {
    setNudging(true);
    // A refusal is toasted by the hook — a bolt in a header has nowhere to draw a sentence — so
    // there is nothing to show here; the flag is cleared either way, or one refused nudge would
    // leave a dead button behind.
    void metis.nudge().finally(() => setNudging(false));
  };

  // What the body is open on, and only while it belongs to the board on screen.
  const openedId = opened !== null && opened.boardId === boardId ? opened.sessionId : null;
  // The row's own session id, stamped with the board that minted it.
  const openConversation = (sessionId: string) => setOpened({ boardId, sessionId });
  const closeConversation = () => setOpened(null);

  const rows = orderForTriage(metis.sessions);
  const runningCount = metis.sessions.filter((session) => session.state === 'running').length;
  const reading = dialReading(runningCount, dial, t);
  // The opened row's own record, found in the same picture the list draws rather than kept beside
  // it. A session the board no longer lists — reaped, or dropped by a seed — leaves this
  // `undefined`, and the conversation is then a finished transcript with nothing live to follow.
  const openSession = openedId === null ? undefined : metis.sessions.find((session) => session.sessionId === openedId);

  /** Loading, empty, the list — and the list with a conversation beside it. Four pieces of news. */
  const body = () => {
    if (openedId === null && metis.loading) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <Spinner label={t('kanban.metis.loading')} />
        </div>
      );
    }

    if (openedId === null && rows.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState icon={Bot} title={t('kanban.metis.empty.title')} message={t('kanban.metis.empty.message')} />
        </div>
      );
    }

    return (
      <div
        className={cn('flex min-h-0 flex-col', openedId !== null && 'md:flex-row')}
        data-metis-open={openedId ?? undefined}
      >
        <ul
          role="list"
          className={cn(
            'flex min-h-0 shrink-0 flex-col divide-y divide-border overflow-y-auto',
            openedId === null
              ? CAP.list
              : cn(CAP.fleetBesideConversation, 'border-b border-border md:basis-2/5 md:border-b-0 md:border-r'),
          )}
        >
          {rows.map((session) => (
            <KanbanMetisRow
              key={session.sessionId}
              session={session}
              open={session.sessionId === openedId}
              onStop={metis.stop}
              onResume={metis.resume}
              onOpen={openConversation}
            />
          ))}
        </ul>

        {openedId !== null && (
          <KanbanMetisConversation
            // Keyed on the session: a draft and a refusal belong to the conversation they were
            // typed in, and the transcript view starts from its newest step for each.
            key={openedId}
            sessionId={openedId}
            session={openSession}
            metis={metis}
            onBack={closeConversation}
            className={cn(CAP.conversation, 'md:min-w-0 md:flex-1')}
          />
        )}
      </div>
    );
  };

  return (
    <Collapsible
      open={!folded}
      onOpenChange={(open) => setFolded(!open)}
      role="region"
      aria-labelledby={headingId}
      className="flex shrink-0 flex-col border-t border-border bg-background"
      data-kanban-metis-panel
      data-board-id={boardId}
    >
      {/* The board header's own bar height, so the two line up when the strip sits under the rail.
          Fold, identity, the one figure a folded reader needs, then the two actions at the far
          edge on an auto margin — they take only what is left over, so the board's name keeps its
          width on a phone and the buttons still sit right on a desktop. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <CollapsibleTrigger
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-7 w-7 shrink-0 text-muted-foreground')}
          aria-label={folded ? t('kanban.metis.expand') : t('kanban.metis.collapse')}
        >
          {folded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </CollapsibleTrigger>

        <div className="flex min-w-0 items-baseline gap-1.5">
          <h2 id={headingId} className="shrink-0 text-sm font-semibold text-foreground">
            {t('kanban.metis.title')}
          </h2>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{boardName}</span>
        </div>

        {/* Live against the dial. The figure at every width; the word from `sm` up — except the CAP's
            word, which a phone gets in short form: Launch is disabled beside it and touch has no title. */}
        <Badge
          tone={reading.tone}
          className="vv-badge--compact shrink-0 gap-1"
          title={t('kanban.metis.dial.label', { defaultValue: '{{figure}} {{word}}', figure: reading.figure, word: reading.word })}
          data-live={runningCount}
          data-dial={dial ?? undefined}
        >
          {runningCount > 0 && <span aria-hidden="true" className="vv-tone-dot vv-pulse" data-filled="true" />}
          <span className="vv-tabular">{reading.figure}</span>
          <span className="hidden sm:inline">{reading.word}</span>
          {reading.why !== null && <span className="sm:hidden">{reading.short}</span>}
        </Badge>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            aria-label={t('kanban.metis.nudge', { defaultValue: 'Nudge' })}
            title={t('kanban.metis.nudgeTitle', { defaultValue: 'Wake the driver now — reap what has quiesced and fill the dial' })}
            disabled={nudging}
            onClick={onNudge}
            data-nudging={nudging || undefined}
          >
            <Zap aria-hidden="true" />
            <span className="hidden sm:inline">{t('kanban.metis.nudge', { defaultValue: 'Nudge' })}</span>
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 sm:px-3"
            disabled={reading.why !== null}
            title={reading.why ?? undefined}
            onClick={launch}
          >
            <Play aria-hidden="true" />
            <span className="hidden sm:inline">{t('kanban.metis.launch')}</span>
            <span className="sm:hidden">{t('kanban.metis.launchShort', { defaultValue: 'Launch' })}</span>
          </Button>
        </div>
      </header>

      <CollapsibleContent>{body()}</CollapsibleContent>
    </Collapsible>
  );
}
