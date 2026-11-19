import { Bug, CloudOff } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanBoardDialog, type KanbanBoardDialogMode, type KanbanBoardDraft } from '@/modules/kanban/KanbanBoardDialog';
import { KanbanBoardFace } from '@/modules/kanban/KanbanBoardFace';
import { KanbanBoardHeader } from '@/modules/kanban/KanbanBoardHeader';
import { KanbanCardDrawer } from '@/modules/kanban/card-drawer/KanbanCardDrawer';
import { BugDashboard } from '@/modules/kanban/dashboard/BugDashboard';
import { useBoardProjects } from '@/modules/kanban/hooks/useBoardProjects';
import { useBoardReposPrompt } from '@/modules/kanban/hooks/useBoardReposPrompt';
import { useKanbanBoards } from '@/modules/kanban/hooks/useKanbanBoards';
import { useKanbanDrag } from '@/modules/kanban/hooks/useKanbanDrag';
import { useKanbanLanes } from '@/modules/kanban/hooks/useKanbanLanes';
import { useKanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { useKanbanWalks } from '@/modules/kanban/hooks/useKanbanWalks';
import { useLinkedTitles } from '@/modules/kanban/hooks/useLinkedTitles';
import type { KanbanViewSort } from '@/modules/kanban/utils/cardModel';
import { DONE_LANE_ID, kanbanLanes } from '@/modules/kanban/utils/lanePolicy';
import type { BugDashboardView } from '@/shared/types';
import { EmptyState, Spinner, Tabs } from '@/shared/ui';

/**
 * The Kanban tab's pane: the board's one row of chrome, the strip that switches its two faces (the
 * Board's lane rail and the Dashboard's numbers), and the four states the board can be in. A
 * reader's first sight is the leftmost lane and its count — where the work ready to be picked up lives.
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
 * THE VIEW SORT, THE COLLAPSED LANES, THE FACE AND WHAT THE DASHBOARD IS ASKED are the panel's own,
 * because they are per-SCREEN and not per-board: all survive a board switch, which is what makes
 * the second board open the way the first one was left. None is remembered across visits.
 */

type KanbanPanelProps = {
  /** The open project, or `null` when none is selected. Read ONCE on first mount, to pick this
   *  project's board when none is selected — never as a filter: a board's project is a label, not a
   *  scope. With `null` the mount adopts no board and a new board carries no label. */
  projectId: string | null;
};

/** Rendered by WorkspaceMain while the Kanban tab is active, and mounted nowhere else. */
export function KanbanPanel({ projectId }: KanbanPanelProps) {
  const { t } = useTranslation();

  const {
    boards,
    currentBoardId,
    autonomy,
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
  // Which of the view's two faces is drawn. The Board on every arrival: the dashboard is a look, the board is the work.
  const [face, setFace] = useState<'board' | 'dashboard'>('board');
  // Which boards and how far back the dashboard is asked for, kept here so a visit to the Board face does not reset it.
  const [dashboardView, setDashboardView] = useState<BugDashboardView>({ scope: 'board', days: 30 });

  // The Dashboard tab's count: the open board's open high cards, off the cards this panel already holds, so the Board face asks for no dashboard read.
  const openHigh = board.loading ? undefined : lanes
    .filter((spec) => spec.id !== DONE_LANE_ID)
    .flatMap((spec) => board.cardIds(spec.id))
    .filter((cardId) => board.summaryOf(cardId)?.priority === 'high').length;

  // A dashboard row opens its card on its own board: the selection is made on that board, so it shows the moment the board does.
  const openDashboardCard = (cardId: string, boardId: string) => {
    if (boardId !== currentBoardId) void selectBoard(boardId);
    setFace('board');
    board.openCardOn(boardId, cardId);
  };

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


  // Each card's walk off the dispatcher's feed, read ONCE here for the faces and the drawer.
  const walkOf = useKanbanWalks(currentBoardId, board.summaryOf);

  // What the board knows of another of its cards, by id: its title off the lanes already loaded, or
  // read by id for a card no loaded page holds (an archived one, one further down a lane); `'unread'`
  // only while that read is out, and `'gone'` when it answers 404. A link never falls back to an id.
  const titleOf = useLinkedTitles(currentBoardId, board.summaryOf);

  // The projects the app already lists, each a name and its absolute path: read while the dialog is
  // open on a row that asks for repositories, and only then.
  const projects = useBoardProjects(dialog === 'new' || dialog === 'repos');

  // The server's two sentences about the repositories. The 409 `KANBAN_BOARD_NEEDS_REPOS` of a
  // refused Autonomy switch opens the dialog on `repos` with its sentence above the list, and is
  // cleared when the dialog closes; the 400 of a path that is not a directory inside a git work tree
  // is said under the field, and the dialog stays open over the draft.
  const reposPrompt = useBoardReposPrompt(dialog, setDialog);
  const reposNotice = reposPrompt.notice;
  const reposRefusal = reposPrompt.refusal;

  /** The two saves that carry repositories. Each closes the dialog on the server's ANSWER and not on
   *  the press, and only if the reader is still in the box it was saved from: a refusal has to find
   *  the draft still on screen. A new board is made with its repositories in one call, or not made. */
  const saveWithRepos = async (mode: 'new' | 'repos', name: string, repos: string[]) => {
    const landed = mode === 'new'
      ? await createBoard(name, repos)
      : currentBoardId !== null && (await updateBoard(currentBoardId, { repos }));
    if (landed) setDialog((open) => (open === mode ? null : open));
  };

  /** The board dialog's one write. Archive NEVER falls back by hand: every board write re-reads the
   *  list, and the board the server answers with as current is the one this panel paints. */
  const confirmDialog = (draft: KanbanBoardDraft) => {
    const mode = dialog;
    const { name, repos } = draft;
    if (mode === 'new' || mode === 'repos') {
      void saveWithRepos(mode, name, repos);
      return;
    }
    setDialog(null);
    if (mode === 'rename' && currentBoardId) void updateBoard(currentBoardId, { name });
    else if (mode === 'archive' && currentBoardId) void updateBoard(currentBoardId, { archived: true });
  };

  const currentBoard = boards.find((candidate) => candidate.id === currentBoardId);
  const currentName = currentBoard?.name ?? '';

  /** Loading, unreachable, no board, then the face: four pieces of news, never one spinner. The lanes' own loading and failure are the Board face's. */
  const body = () => {
    const onBoard = face === 'board';
    if (boardsLoading || (onBoard && board.loading)) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <Spinner label={t('kanban.loading')} />
        </div>
      );
    }

    if (boardsUnreachable || (onBoard && board.unreachable)) {
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
            icon={Bug}
            title={t('kanban.noBoard.title')}
            message={t('kanban.noBoard.message')}
            actionLabel={t('kanban.noBoard.action')}
            // The same name surface the switcher's New-board row opens: a first board is a board, and
            // it is named the one way a board is named.
            onAction={() => setDialog('new')}
          />
        </div>
      );
    }

    if (!onBoard) return <BugDashboard boardId={currentBoardId} view={dashboardView} onView={setDashboardView} onOpenCard={openDashboardCard} />;

    return (
      <KanbanBoardFace
        autonomy={autonomy}
        boardId={currentBoardId}
        specs={lanes} board={board}
        drag={drag} writes={writes}
        walkOf={walkOf} titleOf={titleOf}
        sorts={sorts} collapsed={collapsed}
        onSort={(laneId, sort) => setSorts((held) => ({ ...held, [laneId]: sort }))}
        onCollapse={(laneId, folded) => setCollapsed((held) => ({ ...held, [laneId]: folded }))}
      />
    );
  };

  return (
    <div className="vv-board flex h-full min-h-0 flex-col" data-kanban-panel data-kanban-face={face} data-project-id={projectId ?? undefined}>
      <KanbanBoardHeader
        boards={boards}
        currentBoardId={currentBoardId}
        autonomy={autonomy}
        // Boards are GLOBAL: selecting one writes the one `current_board` setting, and the lanes
        // repaint from the id the server answers with. Never scoped to the open project.
        onSelectBoard={(boardId) => { void selectBoard(boardId); }}
        onToggleAutonomy={(next) => {
          // It changes what the board SHOWS only: no write is skipped and nothing is hidden on the
          // server, which is why the lanes are recomposed from the same setting the faces read.
          if (currentBoardId) void updateBoard(currentBoardId, { autonomy: next });
        }}
        // A kit `Dialog` + `Field`, never `window.prompt`: a new board is labelled with THIS panel's
        // projectId (none, when no project is open), and that label is the point of `board.project_id`.
        onNewBoard={() => setDialog('new')}
        onRenameBoard={() => setDialog('rename')}
        onEditRepos={() => setDialog('repos')}
        onArchiveBoard={() => setDialog('archive')}
      />

      {/* The two faces: a flat strip on the header's ground, capped so two words do not stretch across a desktop, 44 px
          under a finger. The Dashboard's pill counts the open high cards, in amber and in words; none at zero. */}
      <div className="shrink-0 border-b border-border px-3 finger:[&_[role=tab]]:min-h-11">
        <div className="w-full max-w-xs">
          <Tabs
            variant="underline" ariaLabel={t('kanban.faces.label')}
            active={face} onChange={(id) => setFace(id === 'dashboard' ? 'dashboard' : 'board')}
            tabs={[
              { id: 'board', label: t('kanban.faces.board') },
              { id: 'dashboard', label: t('kanban.faces.dashboard'), count: openHigh, attention: openHigh ? t('kanban.faces.openHigh', { count: openHigh }) : undefined },
            ]}
          />
        </div>
      </div>

      {body()}

      <KanbanBoardDialog
        // One mount per opening: the field inside is seeded from `initialName` on mount, so a fresh
        // instance is what makes a rename open on the current board's name and nothing else.
        key={dialog ?? 'closed'}
        mode={dialog}
        initialName={dialog === 'rename' ? currentName : ''}
        initialRepos={dialog === 'repos' ? (currentBoard?.repos ?? []) : []}
        projects={projects}
        notice={dialog === 'repos' ? reposNotice : null}
        refusal={reposRefusal}
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
        walk={board.selectedCardId === null ? null : walkOf(board.selectedCardId)}
        titleOf={titleOf}
        // A link's press opens the linked card in this same sheet.
        onOpenCard={board.openCard}
        onClose={() => board.openCard(null)}
      />

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
