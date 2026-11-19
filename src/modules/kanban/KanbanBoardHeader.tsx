import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KanbanVitalsStrip } from '@/modules/kanban/KanbanVitalsStrip';
import type { KanbanBoard } from '@/shared/kanban-types';
import { ActionMenu, type ActionMenuItem, Select, Switch } from '@/shared/ui';

/**
 * The board's one row of chrome: which board you are looking at, how it stands in five counts,
 * whether it is running itself, and the three things you can do to the board you are on.
 *
 * MAKING A BOARD IS THE SWITCHER'S, NOT THE MENU'S. It used to sit in the `…` beside Rename and
 * Archive, and the operator's report of it was "no way to select or create other boards": the
 * glyph carries no word, sits at the far end of the row past the switch, and holds verbs
 * that act on the CURRENT board — so nothing about it says a new one starts there. The moment a
 * reader wants a board that does not exist is the moment they have the switcher open and cannot
 * find it, which is exactly where the row now is.
 *
 * IT INVENTS NO SHELL. `h-12`, a bottom border and no background of its own — it sits inside the
 * workspace tab and inherits the chrome the tab already draws. A second page-level header here
 * would put two bars above the lanes and cost the board a lane's worth of height on a phone.
 *
 * IT OWNS NO STATE AND CALLS NO HOOK. Every value it paints arrives as a prop and every action it
 * offers is raised to the panel, because the panel is where the board hook lives and where the
 * open `projectId` is. A `useKanbanBoards` call HERE would be a SECOND instance of that hook — a
 * second `boards()` fetch on mount, a second once-only `boardForProject` ref, and two
 * `currentBoardId`s free to disagree the moment either one writes.
 *
 * The switcher is left and the switch is right for the reason a triage screen puts identity left
 * and mode right: WHICH board is the thing you read on arrival, and the autonomy switch is the
 * thing you change — a control you must never hit while reaching for the board's name.
 *
 * "Autonomy" is spelled out beside the switch rather than left to the toggle alone, because the
 * word is the only thing that says which of two boards you are about to get: with it off the
 * faces are title, priority and tags; with it on they carry questions, issues, steps, holds
 * and spend. A bare toggle is a switch whose two positions the reader has to discover by pressing
 * it.
 *
 * IT IS THE BOARD'S ONE SWITCH. Which model a walk rides is the house's setting and not a board's,
 * so nothing else stands beside it. What a self-running board is built IN is its repositories,
 * which are not a mode and so are not a switch: they are a row of the `…`, beside Rename.
 */

type KanbanBoardHeaderProps = {
  /** Every board this app knows, archived ones already filtered out by the API. */
  boards: KanbanBoard[];
  /** The one selected board, or null before a board has ever been made or chosen. */
  currentBoardId: string | null;
  /** The selected board's own setting. It gates the UI only; no write is ever skipped. */
  autonomy: boolean;
  /** Boards are GLOBAL: selecting one is never scoped to the open project. */
  onSelectBoard: (boardId: string) => void;
  onToggleAutonomy: (next: boolean) => void;
  /** Raised from the switcher's own action row. The panel holds the board's dialog and the hook
   *  that writes it, so every row that opens it is raised rather than handled here. */
  onNewBoard: () => void;
  onRenameBoard: () => void;
  /** Opens the board's repositories: where the cards of a self-running board are built. */
  onEditRepos: () => void;
  onArchiveBoard: () => void;
};

/** Rendered by KanbanPanel, above the lane rail. Nothing else mounts it. */
export function KanbanBoardHeader({
  boards,
  currentBoardId,
  autonomy,
  onSelectBoard,
  onToggleAutonomy,
  onNewBoard,
  onRenameBoard,
  onEditRepos,
  onArchiveBoard,
}: KanbanBoardHeaderProps) {
  const { t } = useTranslation();

  const options = boards.map((board) => ({ value: board.id, label: board.name }));
  const hasBoard = currentBoardId !== null;

  // The three verbs that act on the board you are ALREADY on. Making a new one is not among them:
  // it rides in the switcher, which is where a reader looking for a board they cannot find goes.
  // Archiving hides a board and deletes nothing, which is why it is not marked as danger, and it
  // stands apart behind a rule because it is the one row that takes the board out of sight.
  const items: ActionMenuItem[] = [
    { key: 'rename-board', label: t('kanban.board.rename'), disabled: !hasBoard, onSelect: onRenameBoard },
    { key: 'board-repos', label: t('kanban.board.repos'), disabled: !hasBoard, onSelect: onEditRepos },
    { key: 'archive-board', label: t('kanban.board.archive'), disabled: !hasBoard, showDividerBefore: true, onSelect: onArchiveBoard },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      {/* The switcher is the one thing here that may shrink, and it truncates when it does: a
          board called after a long repository must never push the autonomy switch off a phone.
          It is capped rather than free to grow, so the board's NAME stays a label and not a bar
          across the whole header. */}
      <div className="min-w-0 max-w-56 flex-1">
        <Select
          options={options}
          value={currentBoardId ?? ''}
          onChange={onSelectBoard}
          placeholder={t('kanban.board.noBoard')}
          ariaLabel={t('kanban.board.switcher')}
          size="sm"
          // New board lives HERE and not behind the `…`, because the question it answers is the
          // switcher's own: a reader opens this list to find a board, and when the one they want
          // is not in it the way to make it must be under their hand — not behind an unlabelled
          // glyph at the far end of the row, past the switch.
          action={{ label: t('kanban.board.newBoard'), onSelect: onNewBoard }}
        />
      </div>

      {/* The board's counts sit against its name, because they are ABOUT the board: identity, then
          the state of that identity, then — across the gap — the controls that change it. It is
          handed the board's id and nothing else: this header holds no counts and calls no hook, and
          the id it already has is enough for the strip to find the reading. Where the row has room
          the strip stands in it and never shrinks; where it has none the strip leaves the row for
          the switcher's corner and takes no width at all — so the switcher truncates by its own
          rule, exactly as it did alone, and the cluster to the right never moves. */}
      <KanbanVitalsStrip boardId={currentBoardId} />

      {/* Identity left, mode right, and the gap between them deliberate: the board's name is what
          a reader arrives on, and the autonomy switch is the one control here that changes what
          every card shows — a hand reaching for the name must not be able to land on it.
          `ml-auto` rather than a flex spacer: a spacer is a second thing competing for the row's
          free space, and on a 390px header it split that space evenly and crushed the board's
          name to `L…`. An auto margin takes only what is LEFT OVER, so the switcher keeps its
          width on a phone and the cluster still sits right on a desktop. */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/* The word and the control are one thing to a reader and two to the accessibility tree:
            the span is what an eye reads, `label` is what a screen reader announces, and they are
            deliberately the same word so the two never describe different switches.
            `text-muted-foreground` is the repo's name for `--ink-muted`; `text-ink-muted` is not
            a class this Tailwind config builds and compiles to nothing at all. */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('kanban.board.autonomy')}</span>
          <Switch
            checked={autonomy}
            onChange={onToggleAutonomy}
            label={t('kanban.board.autonomy')}
            disabled={!hasBoard}
          />
        </div>

        <ActionMenu
          label={t('kanban.board.actions')}
          ariaLabel={t('kanban.board.actions')}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="icon"
          // Under a finger the `…` and every row it opens are 44 px (INV-10275): it is the one
          // standing door to a board's repositories, and a door a thumb misses is no door. The
          // rows are sized from here, through the menu's own class, because the kit's row is 36 px
          // for every menu in the app and that is not this header's to change.
          triggerClassName="h-7 w-7 finger:h-11 finger:w-11"
          menuClassName="finger:[&_[role=menuitem]]:min-h-11 finger:[&_[role=menuitem]]:items-center"
        />
      </div>
    </header>
  );
}
