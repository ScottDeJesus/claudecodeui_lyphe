import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useFixerWidth } from '@/modules/kanban/hooks/useFixerWidth';
import { useBoardVitals } from '@/modules/kanban/hooks/useKanbanLaneFeed';
import { CARD_WIDTH_MAX, CARD_WIDTH_MIN } from '@/shared/constants';
import type { KanbanBoard, KanbanVitals } from '@/shared/kanban-types';
import { ActionMenu, Button, KeyValueList, Slider, Switch } from '@/shared/ui';

type BugBoardOpeningProps = {
  /** The open board. */
  board: KanbanBoard;
  /** Turns the board's running itself on or off; a board that names no repository is refused, and its repositories are asked for. */
  onAutonomy: (next: boolean) => void;
  /** Whether the Opening hangs open: the fixers' number is asked for when it opens, since it can have moved from Settings or a terminal while this stayed mounted. */
  open: boolean;
  /** Whether another board stands beside this one: the fixers' number is one for all of them, and the slider's name says so. */
  shared: boolean;
  /** The board dialog, on one of its four questions. */
  onDialog: (mode: 'new' | 'rename' | 'repos' | 'archive') => void;
  /** Archives every card in Done (nothing is deleted); absent while Done holds none. */
  onClearDone?: () => void;
};

/**
 * THE BOARD'S FIVE COUNTS, in one fixed order: what is building, what is asking you, what is waiting to start (To Do), then the two backlogs every
 * board shares (lessons and memories, said so beside their number). The hoop already shows the first three as slots; here they
 * are numbers, which the hoop never says.
 */
const REGISTERS: Array<{ key: keyof KanbanVitals; wordsKey: string; words: string; estate: boolean }> = [
  { key: 'building', wordsKey: 'kanban.ring.vitals.building', words: 'Building', estate: false },
  { key: 'awaitingAnswer', wordsKey: 'kanban.ring.vitals.asking', words: 'Asking', estate: false },
  { key: 'queued', wordsKey: 'kanban.ring.vitals.queued', words: 'Waiting to start', estate: false },
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
 * HOW MANY FIXERS RUN AT ONCE stands in the switch's row, to its left: its caption, the number as a figure, and the kit's Slider with a
 * stop for each number the dispatcher takes. It is the dispatcher's one number for every board (`useFixerWidth`), so with a second board
 * beside this one the slider's name says "shared by all boards". It saves when the knob is let go and draws what the server read back; a
 * refused save puts the old number back with the server's sentence under the row. It does not wait on the switch: off, it sets what
 * applies when the board is turned on. Raising it starts waiting cards at once; lowering it stops no fixer at work.
 *
 * Drawn inside the Opening the panel hangs from the core (`KanbanPanel`).
 */
export function BugBoardOpening({ board, onAutonomy, open, shared, onDialog, onClearDone }: BugBoardOpeningProps) {
  const { t } = useTranslation();
  const { vitals } = useBoardVitals(board.id);
  const fixers = useFixerWidth(open);

  // The line under the row while the number could not be read or a save did not land: what happened, then the server's own sentence.
  let fixersLine: string | null = null;
  if (fixers.problem !== null) {
    const reason = fixers.problem.sentence ?? t('kanban.board.fixersNoAnswer');
    fixersLine = fixers.problem.kind === 'refused'
      ? t('kanban.board.fixersRefused', { number: fixers.saved ?? '—', reason, interpolation: { escapeValue: false } })
      : t('kanban.board.fixersUnread', { reason, interpolation: { escapeValue: false } });
  }

  return (
    <>
      {/* The board's two controls, each with its word beside it. Left: how many fixers run at once, as a caption, the number as a
          figure, and the slider that sets it. Right: the board's switch, where it has always stood, and the word that reads its position. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 max-w-44 flex-1 flex-col gap-1" aria-busy={fixers.saving || undefined} data-bug-fixers={fixers.shown ?? ''}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={CAPTION}>{t('kanban.board.fixersLabel')}</span>
            {/* The slider says its own number to a reader that cannot see it, so the figure is for the eye alone. */}
            <span className="font-mono text-sm font-medium tabular-nums leading-[14px] text-foreground" aria-hidden="true">{fixers.shown ?? '—'}</span>
          </div>
          <Slider
            value={fixers.shown}
            min={CARD_WIDTH_MIN}
            max={CARD_WIDTH_MAX}
            onChange={fixers.move}
            onCommit={(next) => { void fixers.keep(next); }}
            label={t(shared ? 'kanban.board.fixersNameShared' : 'kanban.board.fixersName')}
            valueText={fixers.shown === null ? t('kanban.board.fixersUnknown') : t('kanban.board.fixersValue', { number: fixers.shown })}
            // No number, nothing to move: the slider is drawn empty and says "not known", and the line under the row says why and holds the retry.
            disabled={fixers.saved === null}
          />
        </div>
        <div className="flex flex-none items-center gap-2">
          {/* The word reads the switch's position, On or Off; the switch's name says what it switches, this board, and nothing
              else: its cards wait on it alone, the queue's Pause all included. */}
          <span className={CAPTION}>{t(board.autonomy ? 'kanban.board.autonomyOn' : 'kanban.board.autonomyOff')}</span>
          <Switch checked={board.autonomy} onChange={onAutonomy} label={t('kanban.board.autonomySwitch')} />
        </div>
      </div>

      {fixers.problem !== null && (
        <div role="alert" className="flex items-center justify-between gap-3 text-xs leading-4" data-bug-fixers-problem={fixers.problem.kind}>
          <p className={fixers.problem.kind === 'refused' ? 'min-w-0 text-destructive' : 'min-w-0 text-muted-foreground'}>{fixersLine}</p>
          {fixers.problem.kind === 'unread' && (
            <Button variant="outline" size="sm" className="flex-none finger:min-h-11" onClick={() => { void fixers.refresh(); }}>
              {t('buttons.retry', { defaultValue: 'Try again' })}
            </Button>
          )}
        </div>
      )}

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
