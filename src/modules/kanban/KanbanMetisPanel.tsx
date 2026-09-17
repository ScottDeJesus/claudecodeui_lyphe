import { Bot, ChevronDown, ChevronUp, Play } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanMetisRow } from '@/modules/kanban/KanbanMetisRow';
import { useKanbanMetis } from '@/modules/kanban/hooks/useKanbanMetis';
import { SubagentTranscriptView } from '@/modules/chat';
import type { KanbanMetisSession } from '@/shared/types';
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
 * THE FLEET, WATCHED FROM THE BOARD: every Metis this board has running or has run recently, what
 * each is costing, and the one button that starts another.
 *
 * Mounted by `KanbanPanel` beside the card drawer, while a board is selected, and by nothing else.
 *
 * A PANEL, NOT A DIALOG. A dialog cannot be watched while the board moves, and watching is the
 * whole job of this surface. It is a bounded strip in the board's own flow — the rail keeps its
 * `flex-1`, this takes what its rows need up to a cap and scrolls inside it — so a lane is never
 * covered and the operator reads both at once. It takes no width of its own: laid beside the rail
 * in a row it would fill the column it is given, and under it in the board's column it spans the
 * board. It FOLDS to its header bar, because on a phone a permanent strip is a third of the screen,
 * and the bar alone answers the question a folded reader has — is anything running — with the
 * count beside the title.
 *
 * FOUR PIECES OF NEWS, NEVER ONE SPINNER. The first read is a spinner with a label; a board with
 * no session is an `EmptyState` whose MESSAGE carries the invitation and which draws no button of
 * its own — a second Launch forty pixels under the header's would be two identical names in one
 * region and a second accent fill; a board with sessions is the list; and an opened row hands the
 * body to the transcript view. The header, and Launch with it, stays through all four: a reader
 * watching a transcript may want a second Metis, and should not have to leave to ask for one.
 *
 * ROWS ARE ORDERED FOR TRIAGE, not by the server's clock. The server lists sessions oldest first;
 * the reader wants what is spending money at the top, then what died, then what was stopped, then
 * what finished on its own — and within each, the newest. Keyed on the session id, so a row that
 * changes state moves rather than remounts.
 *
 * LAUNCH IS THE ONE FILLED BUTTON. It is the primary action of the surface and the only accent
 * fill on it; every verb on a row sits below it on the prominence ladder (`KanbanMetisRow`).
 *
 * WHAT IT READS. `useKanbanMetis` — this board's fleet, seeded once by REST and kept current by the
 * `kanban_metis_state` frame — and the three verbs it hands the rows. Nothing else here is data:
 * the two pieces of state the panel keeps are both about the reader's own view of it.
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
 * How tall the body may grow: enough for a handful of rows, more once a transcript has it. The cap
 * sits on the BODY and the scroll sits on its direct flex child, never a percentage height: the
 * kit's content slot folds through a grid row over a block, and a `h-full` under a block resolves
 * to nothing — measured as a list that grew past the strip and never scrolled.
 */
const BODY_CAP = { list: 'max-h-72', transcript: 'max-h-96' } as const;

export function KanbanMetisPanel({ boardId, boardName }: KanbanMetisPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // Whether the strip shows only its header bar. Essential: nothing else in the app knows the
  // reader folded it, and a phone reader who wants the board back has to be able to say so.
  const [folded, setFolded] = useState(false);
  // Which row's transcript has the body, WITH the board that opened it, or `null` for the list.
  // Essential: it is the one decision that changes what the body is, and no session record carries
  // it. The board id is held BESIDE the session id rather than the id being cleared when the rail
  // moves: a session id is one board's mint, so a row opened on board A must read as nothing-open
  // under board B — otherwise B's header would carry A's transcript, read from a route that still
  // serves it. Read against the board now selected, just below: no effect writes state on a board
  // change, and no `key` on the mount, which would remount the panel and re-seed the fleet — a
  // request per tab press for facts `useKanbanMetis` already holds.
  const [opened, setOpened] = useState<{ boardId: string; sessionId: string } | null>(null);

  // The fleet this board is running, and the one verb on the header. `metis` is read whole here and
  // its rows and its count are both taken from it, so nothing can disagree about how many run.
  const metis = useKanbanMetis(boardId);
  const { launch } = metis;

  // What the body is open on, and only while it belongs to the board on screen.
  const openedId = opened !== null && opened.boardId === boardId ? opened.sessionId : null;
  // The row's own session id, stamped with the board that minted it.
  const openTranscript = (sessionId: string) => setOpened({ boardId, sessionId });

  const rows = orderForTriage(metis.sessions);
  const runningCount = metis.sessions.filter((session) => session.state === 'running').length;

  /** Transcript, loading, empty, list. Four different pieces of news, never one spinner. */
  const body = () => {
    if (openedId !== null) {
      // The opened row's own record, found in the same picture the list draws rather than kept
      // beside it. A session the board no longer lists — reaped, or dropped by a seed — leaves this
      // `undefined`, and the view is then a finished transcript with nothing live to follow.
      const openSession = metis.sessions.find((session) => session.sessionId === openedId);
      return (
        <div className={cn('flex min-h-0 flex-col', BODY_CAP.transcript)} data-metis-transcript={openedId}>
          {/* The scroller is the container's, never the view's: `SubagentTranscriptView` is a plain
              column whose sticky way-back sticks inside whichever scroller boxes it, so this is the
              box `PinnedSubagents` gives it. No top padding, or that header sticks inside the padding
              and the transcript shows through the gap above it. `bg-card` is `--surface`, the paint
              the header itself uses, so it never scrolls past as a lighter stripe on the strip's canvas. */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-card px-3 pb-3">
            {/* `sessionId` is `null` on purpose: that prop addresses an `agent` row through its chat,
                and a board's Metis belongs to no chat — the session id the board minted travels in
                `target.id`, which is what selects the `metis` route. `running` is the opened
                session's own state, so a finished Metis is read once and a live one keeps polling. */}
            <SubagentTranscriptView
              sessionId={null}
              target={{ kind: 'metis', id: openedId }}
              label={openSession?.model ?? t('kanban.metis.transcript')}
              running={openSession !== undefined && openSession.state === 'running'}
              onBack={() => setOpened(null)}
            />
          </div>
        </div>
      );
    }

    if (metis.loading) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <Spinner label={t('kanban.metis.loading')} />
        </div>
      );
    }

    if (rows.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState icon={Bot} title={t('kanban.metis.empty.title')} message={t('kanban.metis.empty.message')} />
        </div>
      );
    }

    return (
      <div className={cn('flex min-h-0 flex-col', BODY_CAP.list)}>
        <ul role="list" className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto">
          {rows.map((session) => (
            <KanbanMetisRow
              key={session.sessionId}
              session={session}
              onStop={metis.stop}
              onResume={metis.resume}
              onOpenTranscript={openTranscript}
            />
          ))}
        </ul>
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
          Fold, identity, the one figure a folded reader needs, then the primary action at the
          far edge on an auto margin — it takes only what is left over, so the board's name keeps
          its width on a phone and Launch still sits right on a desktop. */}
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

        {runningCount > 0 && (
          <Badge tone="info" className="vv-badge--compact shrink-0">
            {t('kanban.metis.runningCount', { count: runningCount })}
          </Badge>
        )}

        <Button size="sm" className="ml-auto h-8 shrink-0" onClick={launch}>
          <Play aria-hidden="true" />
          {t('kanban.metis.launch')}
        </Button>
      </header>

      <CollapsibleContent>{body()}</CollapsibleContent>
    </Collapsible>
  );
}
