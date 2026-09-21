import { CloudOff, KanbanSquare } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanBoardDialog, type KanbanBoardDialogMode } from '@/modules/kanban/KanbanBoardDialog';
import { KanbanBoardHeader } from '@/modules/kanban/KanbanBoardHeader';
import { KanbanMetisPanel } from '@/modules/kanban/KanbanMetisPanel';
import { KanbanRail } from '@/modules/kanban/KanbanRail';
import { KanbanCardDrawer } from '@/modules/kanban/card-drawer/KanbanCardDrawer';
import { useKanbanBoards } from '@/modules/kanban/hooks/useKanbanBoards';
import { useKanbanDrag } from '@/modules/kanban/hooks/useKanbanDrag';
import { useKanbanLanes } from '@/modules/kanban/hooks/useKanbanLanes';
import { useKanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanViewSort } from '@/modules/kanban/utils/cardModel';
import { foldedStatuses, kanbanLanes } from '@/modules/kanban/utils/lanePolicy';
import { Banner, EmptyState, Spinner } from '@/shared/ui';

/**
 * The Kanban tab's pane: the board's one row of chrome, the lane rail, and the four states the
 * board can be in. A reader's first sight is the leftmost lane and its count — where the work
 * ready to be picked up lives.
 *
 * IT COMPOSES, IT DOES NOT BUILD. The lanes and their faces are the rail's; the hooks below are the
 * board's data; the two decisions the kit may never know — which statuses compose which lane, and
 * what each `…` offers — live in `utils/lanePolicy` and `utils/boardMenus`. What is left here is
 * the one thing none of them can see: the board as a whole.
 *
 * IT IS THE ONE OWNER OF BOARD STATE: the header paints props and raises callbacks, the board hook
 * is called HERE once, so this screen has a single `currentBoardId` — and it is GLOBAL, never
 * scoped to the open project. ONE LIVE REGION, owned by the board rather than a lane, because only
 * the board sees both the lane a card left and the one it landed in; a Toast leaves, and a thing
 * that leaves cannot announce.
 *
 * THE VIEW SORT AND THE COLLAPSED LANES ARE THE PANEL'S OWN, because they are per-SCREEN and not
 * per-board: both survive a board switch, which is what makes the second board open the way the
 * first one was left.
 */

type KanbanPanelProps = {
  /** The open project. Read ONCE on first mount, to pick this project's board when none is
   *  selected — never as a filter: a board's project is a label, not a scope. */
  projectId: string;
};

/** Rendered by WorkspaceMain while the Kanban tab is active, and mounted nowhere else. */
export function KanbanPanel({ projectId }: KanbanPanelProps) {
  const { t } = useTranslation();

  const {
    boards,
    currentBoardId,
    autonomy,
    deepseekFlash,
    loading: boardsLoading,
    unreachable: boardsUnreachable,
    refresh: refreshBoards,
    selectBoard,
    createBoard,
    updateBoard,
  } = useKanbanBoards(projectId);

  // The ONE place the board's shape is decided, asked once per autonomy setting.
  const lanes = useMemo(() => kanbanLanes(autonomy), [autonomy]);

  // The lane counts and pages, the board's ONE websocket subscription, the open card, the live region.
  const board = useKanbanLanes(currentBoardId, lanes, autonomy);
  const { refresh: refreshLanes } = board;

  const refresh = useCallback(async () => {
    await Promise.all([refreshBoards(), refreshLanes()]);
  }, [refreshBoards, refreshLanes]);

  // The write verbs paint the card the SERVER returns through `applyCard`, so a refused move puts
  // the card back where the reader found it — the revert is the applier, run backwards.
  const writes = useKanbanMutations({ applyCard: board.applyCard });

  const [sorts, setSorts] = useState<Record<string, KanbanViewSort>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<KanbanBoardDialogMode>(null);

  const drag = useKanbanDrag({
    specs: lanes,
    // The lane's own view sort is passed on purpose: the index a lane reports was measured over the
    // cards ON SCREEN, so the neighbour pair the move resolves to has to come off that same order.
    cardIds: (laneId) => board.cardIds(laneId, sorts[laneId] ?? 'server'),
    summaryOf: board.summaryOf,
    countOf: board.countOf,
    applyCardMove: board.applyCardMove,
    move: writes.moveCard,
    announce: board.announce,
  });

  /** Cards To Do carries that wait on an answer — the questions row, and zero under autonomy. */
  const foldedQuestions = board.countOf(foldedStatuses(autonomy));

  /** The name surface's one write. Archive NEVER falls back by hand: every board write re-reads the
   *  list, and the board the server answers with as current is the one this panel paints. */
  const confirmDialog = (name: string) => {
    const mode = dialog;
    setDialog(null);
    if (mode === 'new') void createBoard(name);
    else if (mode === 'rename' && currentBoardId) void updateBoard(currentBoardId, { name });
    else if (mode === 'archive' && currentBoardId) void updateBoard(currentBoardId, { archived: true });
  };

  const currentName = boards.find((candidate) => candidate.id === currentBoardId)?.name ?? '';

  /** Loading, unreachable, no board, board. Four different pieces of news, never one spinner. */
  const body = () => {
    if (boardsLoading || board.loading) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <Spinner label={t('kanban.loading')} />
        </div>
      );
    }

    if (boardsUnreachable || board.unreachable) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={CloudOff}
            title={t('kanban.unreachable.title')}
            message={t('kanban.unreachable.message')}
            actionLabel={t('kanban.unreachable.retry')}
            onAction={() => { void refresh(); }}
          />
        </div>
      );
    }

    if (currentBoardId === null) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={KanbanSquare}
            title={t('kanban.noBoard.title')}
            message={t('kanban.noBoard.message')}
            actionLabel={t('kanban.noBoard.action')}
            // The same name surface the header's New-board row opens: a first board is a board, and
            // it is named the one way a board is named.
            onAction={() => setDialog('new')}
          />
        </div>
      );
    }

    // The banner rides WITH the rail rather than above every state: it explains a lane on the
    // screen, and over a spinner or an error would explain nothing the reader can see. Autonomy
    // off hides no card and rewrites no status — they sit in To Do wearing their own chip, and
    // this says so once.
    return (
      <>
        {!autonomy && foldedQuestions > 0 && (
          <Banner tone="info">{t('kanban.board.questionsFolded', { count: foldedQuestions })}</Banner>
        )}
        <KanbanRail
          specs={lanes}
          board={board}
          drag={drag}
          writes={writes}
          boardId={currentBoardId}
          sorts={sorts}
          collapsed={collapsed}
          onSort={(laneId, sort) => setSorts((held) => ({ ...held, [laneId]: sort }))}
          onCollapse={(laneId, folded) => setCollapsed((held) => ({ ...held, [laneId]: folded }))}
        />
      </>
    );
  };

  return (
    <div className="vv-board flex h-full min-h-0 flex-col" data-kanban-panel data-project-id={projectId}>
      <KanbanBoardHeader
        boards={boards}
        currentBoardId={currentBoardId}
        autonomy={autonomy}
        deepseekFlash={deepseekFlash}
        // Boards are GLOBAL: selecting one writes the one `current_board` setting, and the lanes
        // repaint from the id the server answers with. Never scoped to the open project.
        onSelectBoard={(boardId) => { void selectBoard(boardId); }}
        onToggleAutonomy={(next) => {
          // It changes what the board SHOWS only: no write is skipped and nothing is hidden on the
          // server, which is why the lanes are recomposed from the same setting the faces read.
          if (currentBoardId) void updateBoard(currentBoardId, { autonomy: next });
        }}
        onToggleDeepseekFlash={(next) => {
          // A board's own switch, and the row is the only thing that holds it: the flag file a
          // Metis and her plan runners read is derived from it at spawn, and nothing running moves.
          if (currentBoardId) void updateBoard(currentBoardId, { deepseekFlash: next });
        }}
        // A kit `Dialog` + `Field`, never `window.prompt`: a new board is labelled with THIS panel's
        // projectId, and that label is the point of `board.project_id`.
        onNewBoard={() => setDialog('new')}
        onRenameBoard={() => setDialog('rename')}
        onArchiveBoard={() => setDialog('archive')}
      />

      {body()}

      <KanbanBoardDialog
        // One mount per opening: the field inside is seeded from `initialName` on mount, so a fresh
        // instance is what makes a rename open on the current board's name and nothing else.
        key={dialog ?? 'closed'}
        mode={dialog}
        initialName={dialog === 'rename' ? currentName : ''}
        onClose={() => setDialog(null)}
        onConfirm={confirmDialog}
      />

      {/* MOUNTED WHILE THE BOARD IS, open or not. `Dialog` remembers what had focus when it opened
          and hands it back on close — the card the reader pressed Enter on — and unmounting the
          drawer to close it would throw that memory away with the component. */}
      <KanbanCardDrawer
        cardId={board.selectedCardId}
        autonomy={autonomy}
        // The writes are the PANEL's, not the drawer's: one `applyCard`, one idea of where a card
        // sits. The drawer hands the verbs down to the sections it painted.
        writes={writes}
        onClose={() => board.openCard(null)}
      />

      {/* THE FLEET, IN THE BOARD'S OWN COLUMN, under the rail. A sibling of the drawer rather than a
          child of it: it is a strip in the board's flow, and it must be readable while a card is
          open beside it. Mounted ONLY while a board is selected — a fleet belongs to a board, and
          with none there is nothing to ask about. It reads the fleet itself and reports into
          nothing here. */}
      {currentBoardId !== null && <KanbanMetisPanel boardId={currentBoardId} boardName={currentName} />}

      {/* The board's single live region. Every move announces here, and nowhere else.
          `key` is the ANNOUNCEMENT and not the text: a reader who moves two cards to the same
          place twice gets the same sentence twice, and a live region speaks a CHANGE to its DOM —
          the same string re-rendered in the same node is no change, and the second move would go
          unspoken. Keying the sentence on the announcement's own sequence makes each one a new
          node, so every outcome is heard. */}
      <div className="sr-only" aria-live="polite">
        <span key={board.announcement.seq}>{board.announcement.text}</span>
      </div>
    </div>
  );
}
