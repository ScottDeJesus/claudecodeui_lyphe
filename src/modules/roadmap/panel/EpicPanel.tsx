import { Ban, CircleCheck, FolderInput, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PanelAdd, PanelHead, PanelQuote, RowList } from '@/modules/roadmap/panel/PanelRows';
import { ROADMAP_EPIC_WORD_KEYS, ROADMAP_FEATURE_WORD_KEYS } from '@/shared/constants';
import type { RoadmapEpic } from '@/shared/roadmap-types';
import { humanizeDuration } from '@/shared/spend';
import type { RoadmapDotState, RoadmapTreeSelection } from '@/shared/types';
import { ActionMenu, Badge } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';

type EpicPanelProps = {
  epic: RoadmapEpic;
  /** Its milestone's 1-based place on the roadmap, as the tree's eyebrow numbers it. */
  n: number;
  /** Every feature's dot state, the tree's own (`TreeLayout.dots`), so a row and its dot never disagree. */
  dots: ReadonlyMap<string, RoadmapDotState>;
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
 * Used by the roadmap module's panel, `panel/TreePanel`, for an epic's selection.
 */
export function EpicPanel({ epic, n, dots, onSelect }: EpicPanelProps) {
  const { t } = useTranslation();
  // FILL: openDialog — the face's dialog opener (`RoadmapFaceContext`), which the menu's dialogs and Add a feature open through.
  // FILL: writes — `useRoadmapWrites()`: the menu's Unblock and the features' drop write through it.

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
      // FILL: openDialog add plan — openDialog({ dialog: 'add', kind: 'plan', parent: epic }).
      onSelect: () => {},
    },
    {
      key: 'edit',
      label: t('roadmap.menu.edit'),
      icon: Pencil,
      // FILL: openDialog edit — openDialog({ dialog: 'edit', kind: 'arc', item: epic }).
      onSelect: () => {},
    },
    {
      key: 'move',
      label: t('roadmap.menu.moveToMilestone'),
      icon: FolderInput,
      // FILL: openDialog move — openDialog({ dialog: 'move', kind: 'arc', name: epic.name }).
      onSelect: () => {},
    },
    epic.blocked === null
      ? {
          key: 'block',
          label: t('roadmap.menu.markBlocked'),
          icon: Ban,
          // FILL: openDialog block — openDialog({ dialog: 'block', kind: 'arc', item: epic }).
          onSelect: () => {},
        }
      : {
          key: 'unblock',
          label: t('roadmap.menu.unblock'),
          icon: CircleCheck,
          // FILL: writes.unblock — writes.unblock({ kind: 'arc', name, itemTitle }).
          onSelect: () => {},
        },
    ...(epic.features.length === 0
      ? [{
          key: 'delete',
          label: t('roadmap.menu.delete'),
          icon: Trash2,
          isDanger: true,
          showDividerBefore: true,
          // FILL: openDialog delete — openDialog({ dialog: 'delete', kind: 'arc', item: epic }).
          onSelect: () => {},
        }]
      : []),
  ];

  // FILL: sortable features — useSortable over the epic's features by name; a drop writes writes.move({ kind: 'plan', name, before: the feature it now stands before, else after: the one it follows, itemTitle }), as EpicCard's rows do.
  const sortable = null;

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
        // FILL: onSelect — a press on a feature's row selects it: onSelect({ kind: 'feature', name }).
        onSelect={() => {}}
      />

      <PanelAdd
        label={t('roadmap.menu.addFeature')}
        // FILL: openDialog add plan — openDialog({ dialog: 'add', kind: 'plan', parent: epic }).
        onPress={() => {}}
      />
    </>
  );
}
