import { ArrowLeft, ArrowRight, Ban, CircleCheck, Layers, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useContext, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EpicCard } from '@/modules/roadmap/EpicCard';
import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { ROADMAP_MILESTONE_WORD_KEYS as WORD_KEYS } from '@/shared/constants';
import type { Roadmap, RoadmapMilestone } from '@/shared/roadmap-types';
import { ActionMenu, Badge, EmptyState } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { useSortable } from '@/shared/ui/sortable/useSortable';
import { cn } from '@/shared/utils';

/**
 * The epics' grid: as many 320px-or-wider columns as fit, never one wider than the face. `min()` keeps a
 * single column inside a face narrower than 320px rather than spilling past it.
 */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4';

/**
 * The stage under the path: the milestone in focus, what reaching it means, and the epics that make it,
 * as cards the operator drags into order. Used by `RoadmapPath`, for the focused milestone — the current
 * one unless the operator picked another station.
 *
 * `roadmap` is the milestone's own: its place in it is the eyebrow's number, and the milestones either
 * side are what Move earlier and Move later name, so the first cannot move earlier nor the last later.
 * A milestone is deleted only once it holds no epic (the store refuses the rest), so only then does its
 * menu offer it. An empty milestone's grid is the empty state with its one action; a milestone with
 * epics ends its grid on a dashed "Add an epic" tile.
 */
export function MilestoneFocus({ roadmap, milestone }: { roadmap: Roadmap; milestone: RoadmapMilestone }) {
  const { t } = useTranslation();
  // Move earlier, Move later, Unblock and the cards' drops write through the lane; the screen redraws from the frame that follows.
  const writes = useRoadmapWrites();
  const { openDialog, focus } = useContext(RoadmapFaceContext);
  const titleId = useId();
  const index = roadmap.milestones.findIndex((item) => item.name === milestone.name);
  const reached = milestone.word === 'reached';

  const keys = useMemo(() => milestone.epics.map((item) => item.name), [milestone.epics]);
  const byName = useMemo(() => new Map(milestone.epics.map((item) => [item.name, item])), [milestone.epics]);
  // A drop hands back the whole order; the store is told only which neighbour the card now stands before, else after.
  // The cards of an epic hold sortable lists of their own (its features): `useSortable` marks its items, so a press on a row never arms this list.
  const { order, attachList, itemProps } = useSortable({
    keys,
    // The promise lets `useSortable` keep the card where it was dropped until the frame that carries the move lands.
    onReorder: (carried, next) => {
      const at = next.indexOf(carried);
      const place = at < next.length - 1 ? { before: next[at + 1] } : { after: next[at - 1] };
      return writes.move({ kind: 'arc', name: carried, ...place, itemTitle: byName.get(carried)?.title });
    },
  });
  const cards = order.flatMap((name) => byName.get(name) ?? []);

  // Moving this milestone along the path keeps it on the stage: without a press of its own the stage follows
  // the current milestone, which a move can hand to its neighbour.
  const moveAlong = (place: { before: string } | { after: string }) => {
    focus(milestone.name);
    void writes.move({ kind: 'milestone', name: milestone.name, ...place, itemTitle: milestone.title });
  };

  const items: ActionMenuItem[] = [
    { key: 'edit', label: t('roadmap.menu.edit'), icon: Pencil, onSelect: () => openDialog({ dialog: 'edit', kind: 'milestone', item: milestone }) },
    { key: 'add-epic', label: t('roadmap.menu.addEpic'), icon: Plus, onSelect: () => openDialog({ dialog: 'add', kind: 'arc', parent: milestone }) },
    { key: 'earlier', label: t('roadmap.menu.moveEarlier'), icon: ArrowLeft, disabled: index <= 0, onSelect: () => moveAlong({ before: roadmap.milestones[index - 1].name }) },
    { key: 'later', label: t('roadmap.menu.moveLater'), icon: ArrowRight, disabled: index === roadmap.milestones.length - 1, onSelect: () => moveAlong({ after: roadmap.milestones[index + 1].name }) },
    milestone.blocked === null
      ? { key: 'block', label: t('roadmap.menu.markBlocked'), icon: Ban, onSelect: () => openDialog({ dialog: 'block', kind: 'milestone', item: milestone }) }
      : { key: 'unblock', label: t('roadmap.menu.unblock'), icon: CircleCheck, onSelect: () => void writes.unblock({ kind: 'milestone', name: milestone.name, itemTitle: milestone.title }) },
    ...(milestone.epics.length === 0
      ? [{ key: 'delete', label: t('roadmap.menu.delete'), icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: () => openDialog({ dialog: 'delete', kind: 'milestone', item: milestone }) }]
      : []),
  ];

  return (
    <section data-roadmap-focus={milestone.name} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs font-medium uppercase tracking-[0.14em]', reached ? 'text-accent-ink' : 'text-muted-foreground')}>
            {t('roadmap.milestone.eyebrow', { n: index + 1, word: t(WORD_KEYS[milestone.word]) })}
          </p>
          <h2 id={titleId} className="mt-1 font-serif text-2xl font-normal leading-tight text-foreground">
            {milestone.title}
          </h2>
          {milestone.goal && <p className="mt-1.5 line-clamp-3 max-w-prose text-sm text-muted-foreground">{milestone.goal}</p>}
          {/* Why it is blocked, whole: no other surface shows a milestone's reason, so it wraps — a warn sentence is a soft block, not a pill. */}
          {milestone.blocked !== null && (
            <Badge tone="warn" title={milestone.blocked} className="mt-2 max-w-prose rounded-lg text-left leading-snug">
              <span className="line-clamp-3 break-words">{t('roadmap.blocked', { why: milestone.blocked })}</span>
            </Badge>
          )}
        </div>
        <ActionMenu
          label={t('roadmap.menu.actions', { title: milestone.title })}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="icon"
          triggerClassName="h-8 w-8"
        />
      </header>

      {cards.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('roadmap.empty.noEpics')}
          actionLabel={t('roadmap.menu.addEpic')}
          onAction={() => openDialog({ dialog: 'add', kind: 'arc', parent: milestone })}
        />
      ) : (
        <ul ref={attachList} className={GRID}>
          {cards.map((item) => (
            <li key={item.name} className="min-w-0" {...itemProps(item.name)}>
              <EpicCard epic={item} />
            </li>
          ))}
          {/* Not one of the sortable's items: no key is registered for it, so no carry can land on or move it. */}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => openDialog({ dialog: 'add', kind: 'arc', parent: milestone })}
              className="vv-empty flex h-full min-h-36 w-full items-center justify-center text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('roadmap.menu.addEpic')}
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
