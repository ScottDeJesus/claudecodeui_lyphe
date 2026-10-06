import { ArrowLeft, ArrowRight, Ban, CircleCheck, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PanelAdd, PanelHead, PanelQuote, RowList } from '@/modules/roadmap/panel/PanelRows';
import { ROADMAP_EPIC_WORD_KEYS, ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import type { Roadmap, RoadmapEpicWord, RoadmapMilestone } from '@/shared/roadmap-types';
import type { RoadmapDotState, RoadmapTreeSelection } from '@/shared/types';
import { ActionMenu, Badge } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/** An epic row's dot: the shipped paint once complete, in flight while in progress, hollow before anything moved. */
const EPIC_DOT: Record<RoadmapEpicWord, RoadmapDotState> = {
  complete: 'shipped',
  'in progress': 'inFlight',
  'not started': 'idea',
  empty: 'idea',
};

type MilestonePanelProps = {
  /** The roadmap the milestone stands on: its neighbours are where Move earlier and Move later put it. */
  roadmap: Roadmap;
  milestone: RoadmapMilestone;
  /** Its 1-based place on the roadmap, as the tree's eyebrow numbers it. */
  n: number;
  /** A press on an epic's row, which selects it. */
  onSelect: (selection: RoadmapTreeSelection) => void;
};

/**
 * A milestone's panel: its title, then "Milestone n · <word>" — "Reached <day>" once it is reached on a known
 * day — then, while it is blocked, why, whole; its goal quoted; its epics as rows the operator drags into
 * order, each with its dot and "<word> · shipped/features" (the word alone while it holds no feature, and
 * " · Blocked" while it carries its own reason, as the tree's tip says); and Add an epic.
 *
 * The ⋯ menu is the milestone's whole: edit, add an epic, move earlier and later along the path (the first
 * cannot move earlier nor the last later), mark it blocked or unblock it, and delete it while it holds no
 * epic, since the store refuses the rest. A milestone moved keeps the selection: it is held by name.
 *
 * Used by the roadmap module's panel, `panel/TreePanel`, for a milestone's selection.
 */
export function MilestonePanel({ roadmap, milestone, n, onSelect }: MilestonePanelProps) {
  const { t } = useTranslation();
  // FILL: openDialog — the face's dialog opener (`RoadmapFaceContext`), which the menu's dialogs and Add an epic open through.
  // FILL: writes — `useRoadmapWrites()`: the menu's moves and Unblock, and the epics' drop, write through it.

  const reachedOn = milestone.word === 'reached' ? formatShortDate(milestone.reached_at) : null;
  const word = reachedOn === null ? t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]) : t('roadmap.panel.reachedOn', { date: reachedOn });

  const items: ActionMenuItem[] = [
    {
      key: 'edit',
      label: t('roadmap.menu.edit'),
      icon: Pencil,
      // FILL: openDialog edit — openDialog({ dialog: 'edit', kind: 'milestone', item: milestone }).
      onSelect: () => {},
    },
    {
      key: 'add-epic',
      label: t('roadmap.menu.addEpic'),
      icon: Plus,
      // FILL: openDialog add arc — openDialog({ dialog: 'add', kind: 'arc', parent: milestone }).
      onSelect: () => {},
    },
    {
      key: 'earlier',
      label: t('roadmap.menu.moveEarlier'),
      icon: ArrowLeft,
      disabled: n <= 1,
      // FILL: writes.move earlier — writes.move({ kind: 'milestone', name, before: the milestone before it, itemTitle }).
      onSelect: () => {},
    },
    {
      key: 'later',
      label: t('roadmap.menu.moveLater'),
      icon: ArrowRight,
      disabled: n >= roadmap.milestones.length,
      // FILL: writes.move later — writes.move({ kind: 'milestone', name, after: the milestone after it, itemTitle }).
      onSelect: () => {},
    },
    milestone.blocked === null
      ? {
          key: 'block',
          label: t('roadmap.menu.markBlocked'),
          icon: Ban,
          // FILL: openDialog block — openDialog({ dialog: 'block', kind: 'milestone', item: milestone }).
          onSelect: () => {},
        }
      : {
          key: 'unblock',
          label: t('roadmap.menu.unblock'),
          icon: CircleCheck,
          // FILL: writes.unblock — writes.unblock({ kind: 'milestone', name, itemTitle }).
          onSelect: () => {},
        },
    ...(milestone.epics.length === 0
      ? [{
          key: 'delete',
          label: t('roadmap.menu.delete'),
          icon: Trash2,
          isDanger: true,
          showDividerBefore: true,
          // FILL: openDialog delete — openDialog({ dialog: 'delete', kind: 'milestone', item: milestone }).
          onSelect: () => {},
        }]
      : []),
  ];

  // FILL: sortable epics — useSortable over the milestone's epics by name; a drop writes writes.move({ kind: 'arc', name, before: the epic it now stands before, else after: the one it follows, itemTitle }), as MilestoneFocus's grid does.
  const sortable = null;

  const rows = milestone.epics.map((epic) => {
    const epicWord = t(ROADMAP_EPIC_WORD_KEYS[epic.word]);
    const { features, shipped } = epic.standing;
    const standing = features === 0 ? epicWord : t('roadmap.panel.rowMeta', { word: epicWord, done: shipped, count: features });
    return {
      name: epic.name,
      title: epic.title,
      dot: EPIC_DOT[epic.word],
      meta: epic.blocked === null ? standing : `${standing} · ${t('roadmap.tree.blocked')}`,
    };
  });

  return (
    <>
      <PanelHead
        title={milestone.title}
        sub={t('roadmap.milestone.eyebrow', { n, word })}
        action={(
          <ActionMenu
            label={t('roadmap.menu.actions', { title: milestone.title })}
            items={items}
            icon={MoreHorizontal}
            iconOnly
            variant="ghost"
            size="icon"
            triggerClassName="h-8 w-8"
          />
        )}
      />

      {/* Why it is blocked, whole: no other surface shows a milestone's reason. A warn sentence is a soft block that wraps, not a pill. */}
      {milestone.blocked !== null && (
        <Badge tone="warn" className="max-w-full self-start rounded-lg text-left leading-snug">
          <span className="break-words">{t('roadmap.blocked', { why: milestone.blocked })}</span>
        </Badge>
      )}

      {milestone.goal && <PanelQuote text={milestone.goal} />}

      <RowList
        rows={rows}
        sortable={sortable}
        empty={t('roadmap.empty.noEpics')}
        // FILL: onSelect — a press on an epic's row selects it: onSelect({ kind: 'epic', name }).
        onSelect={() => {}}
      />

      <PanelAdd
        label={t('roadmap.menu.addEpic')}
        // FILL: openDialog add arc — openDialog({ dialog: 'add', kind: 'arc', parent: milestone }).
        onPress={() => {}}
      />
    </>
  );
}
