import '@/modules/kanban/bugScreen.css';

import { Bug, ChevronsDown, CloudOff } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BugBoardOpening } from '@/modules/kanban/BugBoardOpening';
import { BugFoot, type BugFace } from '@/modules/kanban/BugFoot';
import { BugHead } from '@/modules/kanban/BugHead';
import { BugInstrument } from '@/modules/kanban/BugInstrument';
import { KanbanBoardDialog, type KanbanBoardDialogMode, type KanbanBoardDraft } from '@/modules/kanban/KanbanBoardDialog';
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
import { ProposedFeatures } from '@/modules/kanban/proposed/ProposedFeatures';
import { useProposals } from '@/modules/kanban/proposed/useProposals';
import { bugHoop, bugStatusOf, groupOfMore, moreId } from '@/modules/kanban/utils/bugHoop';
import { DONE_LANE_ID, kanbanGroups, kanbanLanes, laneOfStatus, newCardLane } from '@/modules/kanban/utils/lanePolicy';
import { proposalHoop, proposalIdOf, proposalItemId, proposalMoreId } from '@/modules/kanban/utils/proposalHoop';
import { stageRunning } from '@/modules/kanban/utils/walkModel';
import { useHoopView } from '@/shared/hooks/useHoopView';
import type { AstrolabePoint, BugDashboardView, HoopHandle, HoopSlot, HoopView, InstrumentMeasure, ProposalsView } from '@/shared/types';
import { Button, EmptyState, HoopViewSwitch, IconWord, Opening, Spinner } from '@/shared/ui';

/**
 * THE BUGS VIEW, drawn to the design system: a Scene. Its head is the way back, BUGS and the board's name, which is its picker
 * (`BugHead`). Its middle is the board as an instrument: the cards as slots on a hoop round the board's core, a lane's cards side
 * by side, each slot saying where its card is, what it is doing, how far it has got and how much it matters, and the card facing
 * you read out under the hoop (`BugInstrument`, `utils/bugHoop`). A press on the slot at the front opens that card, hung from it
 * (`KanbanCardDrawer`, in the kit's Opening); a press on the core opens the board (`BugBoardOpening`); a press on its measure opens
 * the board's numbers. Its foot holds what is present: the switch between the three faces and the plus that makes a bug
 * (`BugFoot`). The Proposed features are the instrument's second set: the same core, and round it the proposals
 * (`ProposedFeatures`, `utils/proposalHoop`). The Dashboard is the work when chosen: it takes the middle, and the instrument docks
 * at the foot, still live.
 *
 * A BOARD TOO CROWDED TO READ ROUND A BAND is a list at the press of the head's switch (`HoopViewSwitch`, kept on the device by
 * `useHoopView`): the same cards, and on the Proposed face the same proposals, as rows under the same core, every card read so far on
 * its row, and a lane with more on the server ending in Load more. A row opens what its slot opens, on the row's right; docked at the
 * foot the instrument is still its hoop.
 *
 * IT COMPOSES, IT DOES NOT BUILD. The hoop is the kit's; the hooks below are the board's data; the two decisions the kit may never
 * know — which statuses compose which lane and which lanes compose which run of the hoop — live in `utils/lanePolicy`. What is left
 * here is the one thing none of them can see: the board as a whole.
 *
 * IT IS THE ONE OWNER OF BOARD STATE: the board hook is called HERE once, so this screen has a single `currentBoardId` — and it
 * is GLOBAL, never scoped to the open project. ONE LIVE REGION, owned by the board rather than a run, because only the board sees
 * both the lane a card left and the one it landed in. ONE OPENING AT A TIME: a card's, a proposal's, the board's, or a run's
 * further cards.
 *
 * THE FACE AND WHAT THE DASHBOARD AND THE PROPOSALS ARE ASKED are the panel's own, because they are per-SCREEN and not per-board:
 * all survive a board switch. None is remembered across visits.
 */

type KanbanPanelProps = {
  /** The open project, or `null` when none is selected. Read ONCE on first mount, to pick this
   *  project's board when none is selected — never as a filter: a board's project is a label, not a
   *  scope. With `null` the mount adopts no board and a new board carries no label. */
  projectId: string | null;
  /** The way to every other place, the workspace's menu, stood last in the head. */
  menu: ReactNode;
};

/** What the one Opening that is not a card's hangs from: the board's core, or a run's further cards. */
type OtherOpening = { kind: 'board' } | { kind: 'more'; groupId: string } | null;

/** Rendered by WorkspaceMain while the Kanban tab is active, and mounted nowhere else. */
export function KanbanPanel({ projectId, menu }: KanbanPanelProps) {
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
  const board = useKanbanLanes(currentBoardId, lanes);
  const { refresh: refreshLanes } = board;

  const refresh = useCallback(async () => {
    await Promise.all([refreshBoards(), refreshLanes()]);
  }, [refreshBoards, refreshLanes]);

  // The write verbs paint the card the SERVER returns through `applyCard`, so a refused move puts
  // the card back where the reader found it — the revert is the applier, run backwards.
  const writes = useKanbanMutations({ applyCard: board.applyCard });

  const [dialog, setDialog] = useState<KanbanBoardDialogMode>(null);
  // Which of the view's three faces is drawn. The Board on every arrival: the other two are looks, the board is the work.
  const [face, setFace] = useState<BugFace>('board');
  // The Opening that is not a card's, if one hangs: the board's, from its core, or a run's further cards. A card's is the lanes
  // hook's selection, so the board and its Opening can never disagree about which card is open.
  const [other, setOther] = useState<OtherOpening>(null);
  // Which boards and how far back the dashboard is asked for, kept here so a visit to the Board face does not reset it.
  const [dashboardView, setDashboardView] = useState<BugDashboardView>({ scope: 'board', days: 30 });
  // Which boards and which proposals the Proposed features face is asked for, kept here for the same reason.
  const [proposalsView, setProposalsView] = useState<ProposalsView>({ scope: 'board', state: 'open' });
  // The open proposal, by id: the instrument turns its slot to the front and its Opening hangs from it.
  const [openProposalId, setOpenProposalId] = useState<number | null>(null);
  // The board as its hoop or as a list, this device's choice for the Bugs view: both faces that show the instrument follow it.
  const [hoopView, setHoopView] = useHoopView('bugs');
  const asList = hoopView === 'list';

  // The proposals' ONE read, here and not in the face: the tab's count and the face's rows are then the same answer.
  const proposals = useProposals(proposalsView.scope === 'all' ? 'all' : currentBoardId, proposalsView.state);
  const openProposals = proposals.reading.status === 'ready' ? proposals.reading.proposals.filter((proposal) => proposal.state === 'open') : undefined;
  const openHighProposals = openProposals?.filter((proposal) => proposal.priority === 'high').length;

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
    // The hoop stands each lane in the server's order, so a move resolves against that order.
    cardIds: (laneId) => board.cardIds(laneId),
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

  // THE BOARD AS A HOOP, worked out again on every render from what the lanes hold (a hundred cards at most is nothing to count).
  const groupSpecs = useMemo(() => kanbanGroups(), []);
  const hoop = bugHoop({ specs: lanes, groupSpecs, board, walkOf, t });
  // The board as a list holds every card read so far: the same runs without the hoop's end to a lane. The docked hoop keeps the hoop's.
  const boardSlots = asList ? bugHoop({ specs: lanes, groupSpecs, board, walkOf, t, most: Infinity }).slots : hoop.slots;
  const hoopRef = useRef<HoopHandle>(null);
  // The card the dispatcher is building now: one in hand with a sitting still out on it. The core writes toward it.
  const building = (hoop.cardsOf[groupSpecs[0].id] ?? []).find((cardId) => walkOf(cardId)?.stages.some(stageRunning)) ?? null;
  // The core's one measure: how much of the board is fixed. A share finished is never a load, so it never runs warm.
  const total = lanes.reduce((sum, spec) => sum + (board.laneView(spec).count ?? 0), 0);
  const fixed = lanes.filter((spec) => spec.id === DONE_LANE_ID).reduce((sum, spec) => sum + (board.laneView(spec).count ?? 0), 0);
  const measure: InstrumentMeasure | null = total === 0 ? null : {
    value: fixed / total,
    label: t('kanban.ring.fixed', { defaultValue: 'Fixed' }),
    detail: t('kanban.ring.fixedOf', { fixed, total, defaultValue: '{{fixed}} of {{total}}' }),
    warn: 2,
    danger: 2,
  };

  // The open card: its summary, its lane and its state, for its Opening's head and course.
  const openId = board.selectedCardId;
  const openSummary = openId === null ? null : hoop.summaryOf(openId) ?? board.summaryOf(openId);
  const openLane = openSummary === null ? null : laneOfStatus(lanes, openSummary.status);
  const openStatus = openSummary === null || openId === null ? null : bugStatusOf(openSummary, walkOf(openId), t);
  // The slot a thing faces you on: its own, or its run's "more" slot for one past the slots; null for one the hoop does not hold.
  const facingOf = (slots: HoopSlot[], slotId: string, groupId: string | null, more: (groupId: string) => string) => (
    slots.some((slot) => slot.id === slotId) ? slotId : groupId === null ? null : more(groupId)
  );
  const openFacing = openId === null ? null : facingOf(boardSlots, openId, hoop.groupOf(openId), moreId);
  // Where an Opening hangs: a card's own slot (its row, in the list), or its run's "more" slot for a card past the slots; the board's core.
  const cardAnchor = (): AstrolabePoint | null => (openFacing === null ? null : hoopRef.current?.pointOf(openFacing) ?? null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const coreAnchor = useCallback((): AstrolabePoint | null => {
    const box = sceneRef.current?.querySelector('[data-bug-instrument] [data-bug-core]')?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  }, []);
  const moreAnchor = useCallback((groupId: string) => () => hoopRef.current?.pointOf(moreId(groupId)) ?? null, []);
  // The hoop's box, or the list's column: an Opening stands clear of it where the room allows, so the instrument stays whole beside it.
  const instrumentBox = useCallback(
    () => sceneRef.current?.querySelector('[data-bug-instrument] [data-hoop], [data-bug-instrument] [data-hoop-list-column]')?.getBoundingClientRect() ?? null,
    [],
  );

  // THE PROPOSALS ON THE HOOP, the instrument's second set, worked out again on every render from the panel's one read; as a list, every one.
  const proposalsRead = proposals.reading.status === 'ready' ? proposals.reading.proposals : [];
  const proposalSet = proposalHoop(proposalsRead, proposalsView.scope === 'all', t);
  const proposalSlots = asList ? proposalHoop(proposalsRead, proposalsView.scope === 'all', t, Infinity).slots : proposalSet.slots;
  const proposalFacing = openProposalId === null ? null : facingOf(proposalSlots, proposalItemId(openProposalId), proposalSet.groupOf(openProposalId), proposalMoreId);
  const proposalAnchor = (): AstrolabePoint | null => (proposalFacing === null ? null : hoopRef.current?.pointOf(proposalFacing) ?? null);

  // The card the plus just made, by id: its Opening names it first. Any other card opened is no longer fresh.
  const [freshId, setFreshId] = useState<string | null>(null);
  // One Opening at a time: a card opened closes the board's, and the board's closes the card's.
  const openCard = (cardId: string | null, made = false) => {
    setOther(null);
    setFreshId(made ? cardId : null);
    board.openCard(cardId);
  };
  const openProposal = (id: number | null) => {
    setOther(null);
    setOpenProposalId(id);
  };
  const openOther = (next: OtherOpening) => {
    board.openCard(null);
    setOpenProposalId(null);
    setOther(next);
  };

  /** The head's switch: the instrument as its hoop or as a list. What hangs open is put away, as it hung from the other form. */
  const chooseView = (next: HoopView) => {
    setOther(null);
    setOpenProposalId(null);
    board.openCard(null);
    setHoopView(next);
  };

  /** A run's next page: each of its lanes the board shows reads its next page of cards. */
  const loadRun = (groupId: string) => {
    for (const laneId of groupSpecs.find((spec) => spec.id === groupId)?.laneIds ?? []) {
      if (lanes.some((spec) => spec.id === laneId)) void board.loadMore(laneId);
    }
  };
  const loadMoreWord = t('kanban.ring.loadMore', { defaultValue: 'Load more' });
  /** Under a run's rows in the list: Load more, while its lanes hold more cards on the server than the board has read. */
  const loadMoreUnder = (groupId: string) => (hoop.unread[groupId] ? (
    <Button variant="outline" size="sm" className="mt-2 finger:size-11 finger:px-0" aria-label={loadMoreWord} title={loadMoreWord} onClick={() => loadRun(groupId)}>
      <IconWord icon={ChevronsDown} word={loadMoreWord} />
    </Button>
  ) : null);

  /** The plus: a card in To Do, then opened, its title field first — a card created and left closed is a card under a name nobody chose. */
  const newBug = async () => {
    const spec = newCardLane(lanes);
    if (!currentBoardId || !spec) return;
    const card = await writes.createCard(currentBoardId, { title: t('kanban.card.untitled'), status: spec.statuses[0] });
    if (card) openCard(card.id, true);
  };

  /** The instrument: the board's cards, or a second set the face hands it (the proposals), round the same core and measure. */
  const instrument = (docked: boolean, set?: { slots: HoopSlot[]; label: string; held: boolean; current: string | null; onOpen: (slotId: string) => void }) => (
    <BugInstrument
      hoopRef={hoopRef}
      slots={set?.slots ?? (docked ? hoop.slots : boardSlots)}
      label={set?.label}
      view={docked ? 'hoop' : hoopView}
      counts={set === undefined ? hoop.counts : undefined}
      after={set === undefined ? loadMoreUnder : undefined}
      building={set === undefined ? building : null}
      measure={measure}
      docked={docked}
      held={(set?.held ?? openId !== null) || other !== null}
      current={set === undefined ? openFacing : set.current}
      onOpen={(slotId) => {
        if (set !== undefined) {
          set.onOpen(slotId);
          return;
        }
        const groupId = groupOfMore(slotId);
        if (groupId !== null) openOther({ kind: 'more', groupId });
        else openCard(slotId);
      }}
      onCore={() => openOther(other?.kind === 'board' ? null : { kind: 'board' })}
      onMeasure={() => setFace('dashboard')}
    />
  );

  /** Loading, unreachable, no board, then the face: four pieces of news, never one spinner. */
  const body = () => {
    const onBoard = face === 'board';
    if (boardsLoading || (onBoard && board.loading)) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <Spinner label={t('kanban.loading')} />
        </div>
      );
    }

    if (boardsUnreachable || (onBoard && board.unreachable)) {
      return (
        <div className="flex h-full items-center justify-center p-6">
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
        <div className="flex h-full items-center justify-center p-6">
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

    if (face === 'dashboard') {
      return (
        <div className="scrollbar-thin h-full overflow-y-auto">
          <BugDashboard boardId={currentBoardId} view={dashboardView} onView={setDashboardView} onOpenCard={openDashboardCard} />
        </div>
      );
    }
    if (face === 'proposed') {
      return (
        <ProposedFeatures
          view={proposalsView}
          onView={setProposalsView}
          reading={proposals.reading}
          onRetry={proposals.retry}
          onOpenCard={openDashboardCard}
          openId={openProposalId}
          onOpen={openProposal}
          anchor={proposalAnchor}
          avoid={instrumentBox}
          side={asList ? 'right' : undefined}
          home={
            // At home under the face's two controls, as large as the room under them allows.
            instrument(false, {
              slots: proposalSlots,
              label: t('kanban.proposed.listLabel'),
              held: openProposalId !== null,
              current: proposalFacing,
              onOpen: (slotId) => {
                const groupId = groupOfMore(slotId);
                const id = proposalIdOf(slotId);
                if (groupId !== null) openOther({ kind: 'more', groupId });
                else if (id !== null) openProposal(id);
              },
            })
          }
        />
      );
    }

    // At home: the instrument has the middle. Its hoop keeps an Opening open while a slot is turned to or pressed.
    return <div className="h-full">{instrument(false)}</div>;
  };

  // A run's further things, past its slots: the "more" slot they hang from, and the cards or proposals it stands for.
  const shownSlots = face === 'proposed' ? proposalSlots : boardSlots;
  const moreSlot = other?.kind === 'more' ? shownSlots.find((slot) => slot.id === moreId(other.groupId)) ?? null : null;
  const onHoop = (slotId: string) => shownSlots.some((slot) => slot.id === slotId);
  const moreCards = other?.kind === 'more' && face === 'board' ? (hoop.cardsOf[other.groupId] ?? []).filter((cardId) => !onHoop(cardId)) : [];
  const moreProposals = other?.kind === 'more' && face === 'proposed'
    ? (proposalSet.proposalsOf[other.groupId] ?? []).filter((proposal) => !onHoop(proposalItemId(proposal.id)))
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-kanban-panel data-kanban-face={face} data-project-id={projectId ?? undefined}>
      <BugHead
        boards={boards}
        currentBoardId={currentBoardId}
        // Boards are GLOBAL: selecting one writes the one `current_board` setting, and the hoop
        // repaints from the id the server answers with. Never scoped to the open project.
        onSelectBoard={(boardId) => { void selectBoard(boardId); }}
        onNewBoard={() => setDialog('new')}
        // The switch between the hoop and the list, on the two faces that show the instrument.
        view={face !== 'dashboard' && currentBoardId !== null ? <HoopViewSwitch view={hoopView} onChange={chooseView} /> : null}
        menu={menu}
      />

      {/* THE SCENE: the instrument at home, or the face chosen as the work. Every Opening is drawn inside it and measures its room here. */}
      <div ref={sceneRef} className="relative min-h-0 flex-1">
        {body()}

        {/* The open card, hung from its slot. Mounted while the board is, so its reading outlives a close and a reopen. */}
        {face === 'board' && (
          <KanbanCardDrawer
            cardId={openId}
            autonomy={autonomy}
            // The writes are the PANEL's, not the card's: one `applyCard`, one idea of where a card sits.
            writes={writes}
            walk={openId === null ? null : walkOf(openId)}
            titleOf={titleOf}
            // A link's press opens the linked card in this same Opening.
            onOpenCard={(cardId) => openCard(cardId)}
            onClose={() => openCard(null)}
            fresh={openId !== null && openId === freshId}
            anchor={cardAnchor}
            avoid={instrumentBox}
            side={asList ? 'right' : undefined}
            lanes={lanes}
            laneId={openLane?.id ?? null}
            status={openStatus}
            onMove={(laneId) => {
              if (openId !== null) void drag.moveCardToLane(openId, laneId);
            }}
            onShift={(step) => {
              if (openId !== null) void drag.moveCard(openId, 0, step);
            }}
            onArchive={() => {
              if (openId === null) return;
              void writes.archiveCard(openId, board.summaryOf(openId));
              openCard(null);
            }}
          />
        )}

        {/* The board itself, hung from its core, whichever set turns round it. */}
        {face !== 'dashboard' && currentBoard !== undefined && (
          <Opening
            open={other?.kind === 'board'}
            anchor={coreAnchor}
            avoid={instrumentBox}
            onClose={() => setOther(null)}
            backLabel={t('kanban.drawer.close')}
            source={t('kanban.ring.boardSource', { defaultValue: 'Board' })}
            title={currentBoard.name}
            width={340}
            marks={{ 'data-bug-board-opening': '' }}
          >
            <BugBoardOpening
              board={currentBoard}
              open={other?.kind === 'board'}
              shared={boards.filter((each) => !each.archived).length > 1}
              onAutonomy={(next) => {
                // It changes what the board SHOWS only: no write is skipped and nothing is hidden on the
                // server, which is why the lanes are recomposed from the same setting the faces read.
                if (currentBoardId) void updateBoard(currentBoardId, { autonomy: next });
              }}
              onDialog={(mode) => setDialog(mode)}
              onClearDone={(hoop.cardsOf[DONE_LANE_ID] ?? []).length === 0 ? undefined : () => {
                setOther(null);
                void writes.clearLane(board.cardIds(DONE_LANE_ID));
              }}
            />
          </Opening>
        )}

        {/* A run's further cards, hung from its "more" slot: each a press that opens it, and the lane's next page while there is one. */}
        {face !== 'dashboard' && moreSlot !== null && other?.kind === 'more' && (
          <Opening
            open
            anchor={moreAnchor(other.groupId)}
            avoid={instrumentBox}
            onClose={() => setOther(null)}
            backLabel={t('kanban.drawer.close')}
            source={moreSlot.groupName ?? ''}
            title={t('kanban.ring.further', { count: face === 'proposed' ? moreProposals.length : moreCards.length, defaultValue: '{{count}} more' })}
            marks={{ 'data-bug-more-opening': other.groupId }}
          >
            <ul className="-mx-2 flex flex-col">
              {moreCards.map((cardId) => (
                <li key={cardId}>
                  <button
                    type="button"
                    className="w-full truncate rounded-[2px] px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--focus)]"
                    onClick={() => openCard(cardId)}
                  >
                    {hoop.summaryOf(cardId)?.title ?? cardId}
                  </button>
                </li>
              ))}
              {moreProposals.map((proposal) => (
                <li key={proposal.id}>
                  <button
                    type="button"
                    className="w-full truncate rounded-[2px] px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--focus)]"
                    onClick={() => openProposal(proposal.id)}
                  >
                    {proposal.title}
                  </button>
                </li>
              ))}
            </ul>
            {face === 'board' && hoop.unread[other.groupId] && (
              <Button variant="outline" size="sm" onClick={() => loadRun(other.groupId)}>
                {loadMoreWord}
              </Button>
            )}
          </Opening>
        )}
      </div>

      <BugFoot
        face={face}
        onFace={(next) => {
          setOther(null);
          setOpenProposalId(null);
          if (next !== 'board') board.openCard(null);
          setFace(next);
        }}
        openHigh={openHigh}
        openProposals={openProposals?.length}
        openHighProposals={openHighProposals}
        onNewBug={currentBoardId === null ? undefined : () => { void newBug(); }}
        docked={face === 'dashboard' && currentBoardId !== null ? instrument(true) : null}
      />

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

      {/* The board's single live region. Every move announces here, and nowhere else. `key` is the ANNOUNCEMENT and not the
          text: a live region speaks a CHANGE to its DOM, so keying the sentence on the announcement's own sequence makes each
          one a new node, and every outcome is heard. */}
      <div className="sr-only" aria-live="polite">
        <span key={board.announcement.seq}>{board.announcement.text}</span>
      </div>
    </div>
  );
}
