import { Ban, CircleCheck, FolderInput, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { PanelAdd, PanelHead, PanelQuote, RowList } from '@/modules/roadmap/panel/PanelRows';
import { ROADMAP_EPIC_WORD_KEYS, ROADMAP_FEATURE_WORD_KEYS } from '@/shared/constants';
import type { RoadmapEpic } from '@/shared/roadmap-types';
import { humanizeDuration } from '@/shared/spend';
import type { RoadmapDotState, RoadmapTreeSelection } from '@/shared/types';
import { ActionMenu, Badge } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { useSortable } from '@/shared/ui/sortable/useSortable';

type EpicPanelProps = {
  epic: RoadmapEpic;
  /** Its milestone's 1-based place on the roadmap, as the tree's eyebrow numbers it. */
  n: number;
  /** Every feature's dot state, the tree's own (`TreeLayout.dots`), so a row and its dot never disagree. */
  dots: ReadonlyMap<string, RoadmapDotState>;
  /** The open panel's heading id (`TreePanel`'s): the panel's frame is named by it. */
  headingId: string;
  /** A press on a feature's row, which selects it. */
  onSelect: (selection: RoadmapTreeSelection) => void;
};

/**
 * An epic's panel: its title, then "Epic · Milestone n · <word>", with how long agents have worked on it once
 * any did; once it keeps regression cases, how many hold, with what broke in amber; while it is blocked, why,
 * whole; its goal quoted; its features as rows the operator drags into order, each painted the dot the tree
 * paints it, with "<word> · done/tasks" (the word alone before it has a task, and " · Blocked" while its dot
 * is, as the tree's tip says); and Add a feature.
 *
 * The ⋯ menu is the epic's whole: add a feature, edit, move it to another milestone, mark it blocked or
 * unblock it, and delete it while it holds no feature, since the store refuses the rest.
 *
 * Used by the roadmap module's panel, `panel/TreePanel`, for an epic's selection, and by the station module's
 * `CardStage`, which draws it on the stage for an epic the dispatcher no longer holds (the roadmap barrel exports it
 * for that). Its menu and Add a feature open their dialogs through `RoadmapFaceContext`, so they open under the
 * Roadmap face or under a `RoadmapDialogHost`, which `CardStage` draws it in.
 */
export function EpicPanel({ epic, n, dots, headingId, onSelect }: EpicPanelProps) {
  const { t } = useTranslation();
  // The face's dialog opener, which the menu's dialogs and Add a feature open through.
  const { openDialog } = useContext(RoadmapFaceContext);
  // The menu's Unblock and the features' drop write through the lane; the screen redraws from the frame that follows.
  const writes = useRoadmapWrites();

  const line = t('roadmap.panel.epicLine', { n, word: t(ROADMAP_EPIC_WORD_KEYS[epic.word]) });
  // The epic's cases by word, summed over its features: a line of their own, drawn once it keeps one.
  const { cases } = epic.standing;
  // What broke, a break and a regression alike: that line's one amber word.
  const broken = cases.broken + cases.regressed;

  const items: ActionMenuItem[] = [
    {
      key: 'add-feature',
      label: t('roadmap.menu.addFeature'),
      icon: Plus,
      onSelect: () => openDialog({ dialog: 'add', kind: 'plan', parent: epic }),
    },
    {
      key: 'edit',
      label: t('roadmap.menu.edit'),
      icon: Pencil,
      onSelect: () => openDialog({ dialog: 'edit', kind: 'arc', item: epic }),
    },
    {
      key: 'move',
      label: t('roadmap.menu.moveToMilestone'),
      icon: FolderInput,
      onSelect: () => openDialog({ dialog: 'move', kind: 'arc', name: epic.name }),
    },
    epic.blocked === null
      ? {
          key: 'block',
          label: t('roadmap.menu.markBlocked'),
          icon: Ban,
          onSelect: () => openDialog({ dialog: 'block', kind: 'arc', item: epic }),
        }
      : {
          key: 'unblock',
          label: t('roadmap.menu.unblock'),
          icon: CircleCheck,
          onSelect: () => void writes.unblock({ kind: 'arc', name: epic.name, itemTitle: epic.title }),
        },
    ...(epic.features.length === 0
      ? [{
          key: 'delete',
          label: t('roadmap.menu.delete'),
          icon: Trash2,
          isDanger: true,
          showDividerBefore: true,
          onSelect: () => openDialog({ dialog: 'delete', kind: 'arc', item: epic }),
        }]
      : []),
  ];

  const keys = useMemo(() => epic.features.map((item) => item.name), [epic.features]);
  const byName = useMemo(() => new Map(epic.features.map((item) => [item.name, item])), [epic.features]);
  // A drop hands back the whole order; the store is told only which neighbour the feature now stands before, else after.
  const sortable = useSortable({
    keys,
    // The promise lets `useSortable` keep the row where it was dropped until the frame that carries the move lands.
    onReorder: (carried, next) => {
      const at = next.indexOf(carried);
      const place = at < next.length - 1 ? { before: next[at + 1] } : { after: next[at - 1] };
      return writes.move({ kind: 'plan', name: carried, ...place, itemTitle: byName.get(carried)?.title });
    },
  });

  const rows = epic.features.map((feature) => {
    const dot = dots.get(feature.name) ?? 'idea';
    const word = t(ROADMAP_FEATURE_WORD_KEYS[feature.word]);
    const done = feature.tasks.filter((task) => task.status === 'done').length;
    const standing = feature.tasks.length === 0 ? word : t('roadmap.panel.rowMeta', { word, done, count: feature.tasks.length });
    return {
      name: feature.name,
      title: feature.title,
      dot,
      meta: dot === 'blocked' ? `${standing} · ${t('roadmap.tree.blocked')}` : standing,
    };
  });

  return (
    <>
      <PanelHead
        id={headingId}
        title={epic.title}
        sub={epic.runtime_s > 0 ? t('roadmap.facts.withTime', { facts: line, time: humanizeDuration(epic.runtime_s) }) : line}
        action={(
          <ActionMenu
            label={t('roadmap.menu.actions', { title: epic.title })}
            items={items}
            icon={MoreHorizontal}
            iconOnly
            variant="ghost"
            size="icon"
            triggerClassName="h-8 w-8"
          />
        )}
      />

      {/* The cases, quiet until something breaks: the count in the muted ink, what broke beside it in amber. */}
      {cases.total > 0 && (
        <div data-roadmap-epic-cases className="-mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">{t('roadmap.cases.epicHolding', { holding: cases.holding, count: cases.total })}</span>
          {broken > 0 && <Badge tone="warn" className="tabular-nums">{t('roadmap.cases.epicBroken', { count: broken })}</Badge>}
        </div>
      )}

      {/* Why it is blocked, whole: no other surface shows an epic's reason. A warn sentence is a soft block that wraps, not a pill. */}
      {epic.blocked !== null && (
        <Badge tone="warn" className="max-w-full self-start rounded-lg text-left leading-snug">
          <span className="break-words">{t('roadmap.blocked', { why: epic.blocked })}</span>
        </Badge>
      )}

      {epic.goal && <PanelQuote text={epic.goal} />}

      <RowList
        rows={rows}
        sortable={sortable}
        empty={t('roadmap.epicWord.empty')}
        onSelect={(name) => onSelect({ kind: 'feature', name })}
      />

      <PanelAdd
        label={t('roadmap.menu.addFeature')}
        onPress={() => openDialog({ dialog: 'add', kind: 'plan', parent: epic })}
      />
    </>
  );
}
