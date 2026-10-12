import { ArrowLeft, ArrowRight, Ban, CircleCheck, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { PanelAdd, PanelHead, PanelQuote, RowList } from '@/modules/roadmap/panel/PanelRows';
import { ROADMAP_EPIC_WORD_KEYS, ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import type { Roadmap, RoadmapEpicWord, RoadmapMilestone } from '@/shared/roadmap-types';
import type { RoadmapDotState, RoadmapTreeSelection } from '@/shared/types';
import { ActionMenu, Badge } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { useSortable } from '@/shared/ui/sortable/useSortable';
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
  /** The open panel's heading id (`TreePanel`'s): the panel's frame is named by it. */
  headingId: string;
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
export function MilestonePanel({ roadmap, milestone, n, headingId, onSelect }: MilestonePanelProps) {
  const { t } = useTranslation();
  // The face's dialog opener, which the menu's dialogs and Add an epic open through.
  const { openDialog } = useContext(RoadmapFaceContext);
  // The menu's moves and Unblock, and the epics' drop, write through the lane; the screen redraws from the frame that follows.
  const writes = useRoadmapWrites();

  const reachedOn = milestone.word === 'reached' ? formatShortDate(milestone.reached_at) : null;
  const word = reachedOn === null ? t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]) : t('roadmap.panel.reachedOn', { date: reachedOn });

  const items: ActionMenuItem[] = [
    {
      key: 'edit',
      label: t('roadmap.menu.edit'),
      icon: Pencil,
      onSelect: () => openDialog({ dialog: 'edit', kind: 'milestone', item: milestone }),
    },
    {
      key: 'add-epic',
      label: t('roadmap.menu.addEpic'),
      icon: Plus,
      onSelect: () => openDialog({ dialog: 'add', kind: 'arc', parent: milestone }),
    },
    {
      key: 'earlier',
      label: t('roadmap.menu.moveEarlier'),
      icon: ArrowLeft,
      disabled: n <= 1,
      onSelect: () => void writes.move({ kind: 'milestone', name: milestone.name, before: roadmap.milestones[n - 2].name, itemTitle: milestone.title }),
    },
    {
      key: 'later',
      label: t('roadmap.menu.moveLater'),
      icon: ArrowRight,
      disabled: n >= roadmap.milestones.length,
      onSelect: () => void writes.move({ kind: 'milestone', name: milestone.name, after: roadmap.milestones[n].name, itemTitle: milestone.title }),
    },
    milestone.blocked === null
      ? {
          key: 'block',
          label: t('roadmap.menu.markBlocked'),
          icon: Ban,
          onSelect: () => openDialog({ dialog: 'block', kind: 'milestone', item: milestone }),
        }
      : {
          key: 'unblock',
          label: t('roadmap.menu.unblock'),
          icon: CircleCheck,
          onSelect: () => void writes.unblock({ kind: 'milestone', name: milestone.name, itemTitle: milestone.title }),
        },
    ...(milestone.epics.length === 0
      ? [{
          key: 'delete',
          label: t('roadmap.menu.delete'),
          icon: Trash2,
          isDanger: true,
          showDividerBefore: true,
          onSelect: () => openDialog({ dialog: 'delete', kind: 'milestone', item: milestone }),
        }]
      : []),
  ];

  const keys = useMemo(() => milestone.epics.map((item) => item.name), [milestone.epics]);
  const byName = useMemo(() => new Map(milestone.epics.map((item) => [item.name, item])), [milestone.epics]);
  // A drop hands back the whole order; the store is told only which neighbour the epic now stands before, else after.
  const sortable = useSortable({
    keys,
    // The promise lets `useSortable` keep the row where it was dropped until the frame that carries the move lands.
    onReorder: (carried, next) => {
      const at = next.indexOf(carried);
      const place = at < next.length - 1 ? { before: next[at + 1] } : { after: next[at - 1] };
      return writes.move({ kind: 'arc', name: carried, ...place, itemTitle: byName.get(carried)?.title });
    },
  });

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
        id={headingId}
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
        onSelect={(name) => onSelect({ kind: 'epic', name })}
      />

      <PanelAdd
        label={t('roadmap.menu.addEpic')}
        onPress={() => openDialog({ dialog: 'add', kind: 'arc', parent: milestone })}
      />
    </>
  );
}
