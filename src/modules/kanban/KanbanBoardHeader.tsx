import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KanbanVitalsStrip } from '@/modules/kanban/KanbanVitalsStrip';
import type { KanbanBoard, KanbanVitals } from '@/shared/kanban-types';
import { ActionMenu, type ActionMenuItem, LLMProviderLogo, Select, Switch, Tooltip } from '@/shared/ui';

/**
 * The board's one row of chrome: which board you are looking at, how it stands in six counts,
 * whether it is running itself, and the four things you can do to the board as a whole.
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
 *
 * The DeepSeek switch beside it wears the whale rather than a colour of its own. Two bare
 * switches in one cramped edge are two identical tracks a reader has to label by position, and a
 * second accent for the second one would be a second palette. The mark is the whole distinction:
 * the same whale, at the same size, that the composer's Flash chip already carries — so the two
 * are learned once. The word rides beside it from `sm` up and stands down on a phone, exactly as
 * that chip's does, because the mark alone is what a reader who has met it once actually reads
 * and the board's name must keep its width. "Autonomy" keeps its word at every width: it has no
 * mark, and a switch with neither is a switch whose positions have to be discovered by pressing.
 *
 * The two switches are PAIRED with their labels by proximity, not by punctuation: each label and
 * its track sit at `gap-1.5`, the pairs at `gap-3`. At one uniform gap the eye read
 * `[switch] · [whale]` as a pair as readily as `[whale] · [switch]`, and a divider between them
 * would say the two are different kinds of thing when they are the same kind — a per-board mode.
 */

type KanbanBoardHeaderProps = {
  /** Every board this app knows, archived ones already filtered out by the API. */
  boards: KanbanBoard[];
  /** The one selected board, or null before a board has ever been made or chosen. */
  currentBoardId: string | null;
  /** The selected board's own setting. It gates the UI only; no write is ever skipped. */
  autonomy: boolean;
  /** The board row's `deepseek_flash`: where this board's Metis, and every plan runner she
   *  starts, are billed. It moves nothing already running — a child reads it at its next spawn. */
  deepseekFlash: boolean;
  /** The selected board's six counts, handed straight to the strip: an object is a reading, `null`
   *  is a first reading still on its way, and absent is no reading at all — which the strip draws
   *  as em-dashes, never as zeros. */
  vitals?: KanbanVitals | null;
  /** Boards are GLOBAL: selecting one is never scoped to the open project. */
  onSelectBoard: (boardId: string) => void;
  onToggleAutonomy: (next: boolean) => void;
  onToggleDeepseekFlash: (next: boolean) => void;
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
  deepseekFlash,
  vitals,
  onSelectBoard,
  onToggleAutonomy,
  onToggleDeepseekFlash,
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

      {/* The board's counts sit against its name, because they are ABOUT the board: identity, then
          the state of that identity, then — across the gap — the controls that change it. The strip
          never shrinks; below `xl` it stands down to its two amber registers on its own, so the
          switcher still truncates by its own rule and the cluster to the right never moves. */}
      <KanbanVitalsStrip vitals={vitals} />

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

        {/* The tooltip hangs off the LABEL — the mark and the word — and not off the track. The kit
            centres a bubble on its anchor and clamps it to nothing, and this pair sits at the
            right edge: measured at 390px, a bubble centred on the whole pair ran 37px past the
            viewport, while one centred on the mark has 118px to either side. `w-56` is a WIDTH
            and not a cap, because the kit's bubble is a fixed box with no width of its own, and
            a fixed box shrinks to fit the room between its anchor's centre and the viewport's
            right edge BEFORE it is translated back over the anchor — under `max-w-56` the same
            sentence came out 118px wide and eight lines tall on a phone. At 224px it is three
            lines and fits both widths, so the sentence behind it has to stay short — about
            eighty characters. It sits BELOW, over the lanes:
            above is the top of the viewport on a desktop, and to the LEFT a bubble centred on a
            48px row clips at the top the moment it is more than two lines. The kit's default is
            one unbroken line, which is why it is told to wrap. The label runs the row's full
            height so a phone reader, who sees the mark alone, has something to long-press —
            that is the only way a phone can learn what this switches. The mark comes through the
            shared provider logo rather than DeepSeekLogo directly: it is the door that branches on
            a provider name, and the mark's own file records it as the only one. It is hidden from
            the accessibility tree: the svg names itself "DeepSeek" through `role="img"`, and beside
            a visible word and a track whose accessible name both already say "DeepSeek Flash", a
            screen reader heard the name three times where Autonomy's is heard twice. With no board
            the track is disabled exactly as Autonomy's is, and for the same reason: there is no
            row for the setting to live on. */}
        <div className="flex items-center gap-1.5">
          <Tooltip
            content={t('kanban.board.deepseekFlashTooltip')}
            position="bottom"
            className="w-56 whitespace-normal"
          >
            <div className="flex h-12 items-center gap-1.5">
              <span aria-hidden="true" className="flex shrink-0">
                <LLMProviderLogo provider="deepseek" className="h-4 w-4 shrink-0" />
              </span>
              <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
                {t('kanban.board.deepseekFlash')}
              </span>
            </div>
          </Tooltip>
          <Switch
            checked={deepseekFlash}
            onChange={onToggleDeepseekFlash}
            label={t('kanban.board.deepseekFlash')}
            disabled={!hasBoard}
          />
        </div>

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
