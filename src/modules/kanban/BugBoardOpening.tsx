import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useBoardVitals } from '@/modules/kanban/hooks/useKanbanLaneFeed';
import type { KanbanBoard, KanbanVitals } from '@/shared/kanban-types';
import { ActionMenu, KeyValueList, Switch } from '@/shared/ui';

type BugBoardOpeningProps = {
  /** The open board. */
  board: KanbanBoard;
  /** Turns the board's running itself on or off; a board that names no repository is refused, and its repositories are asked for. */
  onAutonomy: (next: boolean) => void;
  /** The board dialog, on one of its four questions. */
  onDialog: (mode: 'new' | 'rename' | 'repos' | 'archive') => void;
  /** Archives every card in Done (nothing is deleted); absent while Done holds none. */
  onClearDone?: () => void;
};

/**
 * THE BOARD'S FIVE COUNTS, in one fixed order: what is building, what is asking you, what is queued, then the two backlogs every
 * board shares (lessons and memories, said so beside their number). The hoop already shows the first three as slots; here they
 * are numbers, which the hoop never says.
 */
const REGISTERS: Array<{ key: keyof KanbanVitals; wordsKey: string; words: string; estate: boolean }> = [
  { key: 'building', wordsKey: 'kanban.ring.vitals.building', words: 'Building', estate: false },
  { key: 'awaitingAnswer', wordsKey: 'kanban.ring.vitals.asking', words: 'Asking', estate: false },
  { key: 'queued', wordsKey: 'kanban.ring.vitals.queued', words: 'Queued', estate: false },
  { key: 'lessonsPendingEstate', wordsKey: 'kanban.ring.vitals.lessons', words: 'Lessons', estate: true },
  { key: 'memoryPendingEstate', wordsKey: 'kanban.ring.vitals.memories', words: 'Memories', estate: true },
];

/** A row's label: the design system's caption, in capitals and the muted ink. */
const CAPTION = 'font-mono text-[10px] uppercase leading-[14px] tracking-[0.24em] text-muted-foreground';

/**
 * WHAT THE BOARD'S CORE OPENS: the board itself. Whether it runs itself (the switch the old header carried: its word its position,
 * On or Off, its name "Turn this board on or off", refused the same way while the board names no repository), the repositories its cards are built in, its counts as the board
 * feed keeps them (the two backlogs that belong to every board said so), and, behind its mark (`⋯`), the things done to a board:
 * its repositories, its name, another board, archiving this one, and clearing its Done run (every finished card archived at
 * once). Switching boards is the head's (`BugHead`): the board's name there is its picker.
 *
 * Drawn inside the Opening the panel hangs from the core (`KanbanPanel`).
 */
export function BugBoardOpening({ board, onAutonomy, onDialog, onClearDone }: BugBoardOpeningProps) {
  const { t } = useTranslation();
  const { vitals } = useBoardVitals(board.id);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        {/* The word reads the switch's position, On or Off; the switch's name says what it switches, this board, and nothing
            else: its cards wait on it alone, the queue's Pause all included. */}
        <span className={CAPTION}>{t(board.autonomy ? 'kanban.board.autonomyOn' : 'kanban.board.autonomyOff')}</span>
        <Switch checked={board.autonomy} onChange={onAutonomy} label={t('kanban.board.autonomySwitch')} />
      </div>

      <KeyValueList
        items={REGISTERS.map((register) => {
          const count = vitals === null ? null : vitals[register.key];
          const value = count === null ? '—' : register.estate ? t('kanban.ring.vitals.everyBoard', { count, defaultValue: '{{count}} · every board' }) : String(count);
          return [t(register.wordsKey, { defaultValue: register.words }), value] as const;
        })}
      />

      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={CAPTION}>{t('kanban.board.repos')}</span>
          {board.repos.length > 0 ? (
            <ul className="flex flex-col gap-0.5 font-mono text-[11px] leading-4 text-foreground">
              {board.repos.map((repo) => <li key={repo} className="truncate" title={repo}>{repo}</li>)}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t('kanban.ring.noRepos', { defaultValue: 'None yet — name one to let the board run itself.' })}</p>
          )}
        </div>
        {/* The four things done to a board, behind its mark alone: its repositories, its name, another board, and archiving
            this one, apart behind a rule because it is the one that takes the board out of sight (it deletes nothing). */}
        <ActionMenu
          label={t('kanban.board.actions')}
          ariaLabel={t('kanban.board.actions')}
          icon={MoreHorizontal}
          iconOnly
          align="right"
          variant="outline"
          size="icon"
          triggerClassName="size-9 flex-none finger:size-11"
          menuClassName="finger:[&_[role=menuitem]]:min-h-11 finger:[&_[role=menuitem]]:items-center"
          items={[
            { key: 'board-repos', label: t('kanban.board.repos'), onSelect: () => onDialog('repos') },
            { key: 'rename-board', label: t('kanban.board.rename'), onSelect: () => onDialog('rename') },
            { key: 'new-board', label: t('kanban.board.newBoard'), onSelect: () => onDialog('new') },
            { key: 'archive-board', label: t('kanban.board.archive'), showDividerBefore: true, onSelect: () => onDialog('archive') },
            // What the old Done lane's menu offered: every finished card archived at once. Danger, because it moves many.
            ...(onClearDone ? [{ key: 'clear-done', label: t('kanban.laneMenu.clearDone'), isDanger: true, onSelect: onClearDone }] : []),
          ]}
        />
      </div>
    </>
  );
}
