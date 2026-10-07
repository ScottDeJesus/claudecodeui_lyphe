import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { PanelAdd, PanelHead, PanelQuote, RowList } from '@/modules/roadmap/panel/PanelRows';
import { ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import type { Roadmap, RoadmapMilestoneWord } from '@/shared/roadmap-types';
import type { RoadmapDotState, RoadmapTreeSelection } from '@/shared/types';
import { ActionMenu } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A milestone row's dot: the shipped paint once reached, in flight while in progress, hollow before anything moved. */
const MILESTONE_DOT: Record<RoadmapMilestoneWord, RoadmapDotState> = {
  reached: 'shipped',
  'in progress': 'inFlight',
  'not started': 'idea',
  empty: 'idea',
};

/** One fact of the standing line, and whether it is said in the accent's ink (arrived) or in amber (needs the operator). */
type StandingFact = { key: string; text: string; ink?: 'accent' | 'warn' };

type RoadmapPanelProps = {
  roadmap: Roadmap;
  /** The open panel's heading id (`TreePanel`'s): the panel's frame is named by it. */
  headingId: string;
  /** A press on a milestone's row, which selects it. */
  onSelect: (selection: RoadmapTreeSelection) => void;
};

/**
 * What a press on the goal opens: the roadmap itself. Its title, then "Roadmap" and where it stands — the
 * features' facts first (progress, then what needs the operator, in amber), closing on the cases it keeps,
 * the count and its state side by side — then its goal quoted, or, with none, the press that writes it in
 * the goal's place; then its milestones as rows in path order, which are never reordered here (the
 * milestone's own menu moves it), each with its dot and "x of y features · <word>", and " · Blocked" while it
 * carries its own reason (the tree's milestone draws no mark of its own, so its row says it); then Add a milestone.
 *
 * The ⋯ menu edits the goal and title and adds a milestone; it offers Delete only while the roadmap holds no
 * milestone, since the store refuses the rest. Making a roadmap is the picker's own last row.
 *
 * Used by the roadmap module's panel, `panel/TreePanel`, for the goal's selection.
 */
export function RoadmapPanel({ roadmap, headingId, onSelect }: RoadmapPanelProps) {
  const { t } = useTranslation();
  // The face's dialog opener, which the menu, the goal's missing words and Add a milestone open through.
  const { openDialog } = useContext(RoadmapFaceContext);

  const items: ActionMenuItem[] = [
    {
      key: 'edit',
      label: t('roadmap.menu.editRoadmap'),
      icon: Pencil,
      onSelect: () => openDialog({ dialog: 'edit', kind: 'roadmap', item: roadmap }),
    },
    {
      key: 'add-milestone',
      label: t('roadmap.menu.addMilestone'),
      icon: Plus,
      onSelect: () => openDialog({ dialog: 'add', kind: 'milestone', parent: roadmap }),
    },
    ...(roadmap.milestones.length === 0
      ? [{
          key: 'delete',
          label: t('roadmap.menu.delete'),
          icon: Trash2,
          isDanger: true,
          showDividerBefore: true,
          onSelect: () => openDialog({ dialog: 'delete', kind: 'roadmap', item: roadmap }),
        }]
      : []),
  ];

  const { standing } = roadmap;
  const allReached = roadmap.word === 'every milestone reached';
  // The roadmap's cases by word, summed over its epics; a break and a regression are both what broke.
  const { cases } = standing;
  const casesBroken = cases.broken + cases.regressed;
  const facts: StandingFact[] = [
    roadmap.milestones.length === 0
      ? { key: 'word', text: t('roadmap.roadmapWord.noPath') }
      : { key: 'reached', text: t('roadmap.standing.reached', { reached: standing.reached, count: standing.milestones }), ink: allReached ? 'accent' : undefined },
    ...(standing.shipped > 0 ? [{ key: 'shipped', text: t('roadmap.standing.shipped', { count: standing.shipped }) }] : []),
    ...(standing.in_flight > 0 ? [{ key: 'inFlight', text: t('roadmap.standing.inFlight', { count: standing.in_flight }) }] : []),
    ...(standing.proposed > 0 ? [{ key: 'next', text: t('roadmap.standing.next', { count: standing.proposed }) }] : []),
    ...(standing.blocked > 0 ? [{ key: 'blocked', text: t('roadmap.standing.blocked', { count: standing.blocked }), ink: 'warn' as const }] : []),
    ...(standing.waiting_on_you > 0 ? [{ key: 'waiting', text: t('roadmap.standing.waiting', { count: standing.waiting_on_you }), ink: 'warn' as const }] : []),
    ...(cases.total > 0 ? [{ key: 'cases', text: t('roadmap.cases.total', { count: cases.total }) }] : []),
    ...(casesBroken > 0 ? [{ key: 'casesBroken', text: t('roadmap.cases.headerBroken', { count: casesBroken }), ink: 'warn' as const }] : []),
    ...(cases.total > 0 && cases.holding === cases.total ? [{ key: 'casesHolding', text: t('roadmap.cases.allHolding') }] : []),
  ];

  const rows = roadmap.milestones.map((milestone) => {
    const word = t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]);
    const { features, shipped } = milestone.standing;
    // The tree's own line under the milestone's ring, so the two say one thing: the word alone while it holds no feature.
    const line = features === 0 ? word : t('roadmap.tree.milestoneLine', { shipped, count: features, word });
    return {
      name: milestone.name,
      title: milestone.title,
      dot: MILESTONE_DOT[milestone.word],
      // Blocked in words, as an epic's row says it: the hollow dot alone would hide a reason every feature under it inherits.
      meta: milestone.blocked === null ? line : `${line} · ${t('roadmap.tree.blocked')}`,
    };
  });

  return (
    <>
      <PanelHead
        id={headingId}
        title={roadmap.title}
        sub={(
          <span data-roadmap-standing>
            {t('roadmap.panel.roadmap')}
            {facts.map((fact) => (
              <Fragment key={fact.key}>
                {' · '}
                <span data-roadmap-fact={fact.key} className={cn(fact.ink === 'accent' && 'font-medium text-accent-ink', fact.ink === 'warn' && 'font-medium text-warn-ink')}>{fact.text}</span>
              </Fragment>
            ))}
          </span>
        )}
        action={(
          <ActionMenu
            label={t('roadmap.menu.actions', { title: roadmap.title })}
            items={items}
            icon={MoreHorizontal}
            iconOnly
            variant="ghost"
            size="icon"
            triggerClassName="h-8 w-8"
          />
        )}
      />

      {roadmap.goal ? (
        <PanelQuote text={roadmap.goal} />
      ) : (
        // The goal's place, as the press that writes it: dashed, so it reads as a blank to fill, not as a goal.
        <div className="border-l-2 border-border pl-2">
          <button
            type="button"
            className="rounded-sm text-left text-sm italic text-muted-foreground underline decoration-border decoration-dashed underline-offset-4 hover:text-foreground"
            onClick={() => openDialog({ dialog: 'edit', kind: 'roadmap', item: roadmap, goalFirst: true })}
          >
            {t('roadmap.goal.missing')}
          </button>
        </div>
      )}

      <RowList
        rows={rows}
        sortable={null}
        empty={t('roadmap.roadmapWord.noPath')}
        onSelect={(name) => onSelect({ kind: 'milestone', name })}
      />

      <PanelAdd
        label={t('roadmap.menu.addMilestone')}
        onPress={() => openDialog({ dialog: 'add', kind: 'milestone', parent: roadmap })}
      />
    </>
  );
}
