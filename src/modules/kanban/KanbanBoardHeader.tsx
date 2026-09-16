import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { KanbanBoard } from '@/shared/kanban-types';
import { ActionMenu, type ActionMenuItem, Select, Switch } from '@/shared/ui';

/**
 * The board's one row of chrome: which board you are looking at, whether it is running itself,
 * and the four things you can do to the board as a whole.
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
 * faces are title, priority and tags; with it on they carry leases, questions, issues, checklist
 * and spend. A bare toggle is a switch whose two positions the reader has to discover by pressing
 * it.
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
  /** Both name-entry rows. The panel raises the surface, because it holds the `projectId` a new
   *  board is labelled with and the hook that writes it. */
  onNewBoard: () => void;
  onRenameBoard: () => void;
  onArchiveBoard: () => void;
  onImportDescent: () => void;
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
  onArchiveBoard,
  onImportDescent,
}: KanbanBoardHeaderProps) {
  const { t } = useTranslation();

  const options = boards.map((board) => ({ value: board.id, label: board.name }));
  const hasBoard = currentBoardId !== null;

  const items: ActionMenuItem[] = [
    { key: 'new-board', label: t('kanban.board.newBoard'), onSelect: onNewBoard },
    // Archiving hides a board and deletes nothing, which is why it is not marked as danger.
    { key: 'rename-board', label: t('kanban.board.rename'), disabled: !hasBoard, onSelect: onRenameBoard },
    { key: 'archive-board', label: t('kanban.board.archive'), disabled: !hasBoard, onSelect: onArchiveBoard },
    {
      // The one row that opens a dialog rather than doing something, and the only one that
      // reaches outside this app — so it sits alone under the divider.
      key: 'import-descent',
      label: t('kanban.board.importDescent'),
      showDividerBefore: true,
      onSelect: onImportDescent,
    },
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
        />
      </div>

      {/* Identity left, mode right, and the gap between them deliberate: the board's name is what
          a reader arrives on, and the autonomy switch is the one control here that changes what
          every card shows — a hand reaching for the name must not be able to land on it.
          `ml-auto` rather than a flex spacer: a spacer is a second thing competing for the row's
          free space, and on a 390px header it split that space evenly and crushed the board's
          name to `L…`. An auto margin takes only what is LEFT OVER, so the switcher keeps its
          width on a phone and the cluster still sits right on a desktop. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* The word and the control are one thing to a reader and two to the accessibility tree:
            the span is what an eye reads, `label` is what a screen reader announces, and they are
            deliberately the same word so the two never describe different switches.
            `text-muted-foreground` is the repo's name for `--ink-muted`; `text-ink-muted` is not
            a class this Tailwind config builds and compiles to nothing at all. */}
        <span className="text-xs font-medium text-muted-foreground">{t('kanban.board.autonomy')}</span>
        <Switch
          checked={autonomy}
          onChange={onToggleAutonomy}
          label={t('kanban.board.autonomy')}
          disabled={!hasBoard}
        />

        <ActionMenu
          label={t('kanban.board.actions')}
          ariaLabel={t('kanban.board.actions')}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          portal
          variant="ghost"
          size="icon"
          triggerClassName="h-7 w-7"
        />
      </div>
    </header>
  );
}
