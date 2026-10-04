import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { MilestonePath } from '@/modules/roadmap/MilestonePath';
import { RoadmapPicker } from '@/modules/roadmap/RoadmapPicker';
import type { Roadmap } from '@/shared/roadmap-types';
import { ActionMenu, Button } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { cn } from '@/shared/utils';

type RoadmapHeaderProps = {
  roadmap: Roadmap;
  /** The milestone on the stage below, outlined on the path. */
  focused: string | null;
  /** A station pressed: the stage shows that milestone. */
  onFocus: (name: string) => void;
};

/** One fact of the standing line, and whether it is said in the accent's ink (arrived) or in amber (needs the operator). */
type StandingFact = { key: string; text: string; ink?: 'accent' | 'warn' };

/**
 * The roadmap's top: which roadmap it is (the picker) and what can be done to it (its menu); then its
 * GOAL, the largest type on the screen — Instrument Serif, the house's display face, never bold —
 * because it is the one thing the operator wants in front of him above everything else; then where the
 * roadmap stands, in plain words and tabular figures; then the path itself, from here to the goal.
 *
 * The standing says the features' facts first — progress, then what needs the operator ("1 blocked", "2
 * waiting on you"), which count features because they follow them — and closes on the regression cases the
 * roadmap keeps, the count first and its state right after it ("5 cases · all holding", "5 cases · 2
 * broken"), so the pair is bound by adjacency and no feature fact reads as counting cases. "All holding" is
 * said only when every case holds; a roadmap whose cases have not all run yet, with none broken, says just
 * how many it keeps.
 *
 * A goal runs to three lines and offers Show all past them, so the longest one never pushes the path
 * below a phone's fold. A roadmap with no goal says so in the goal's own place, in the same serif, as
 * the press that writes it. A roadmap with no milestone draws no path: the stage below says how to start
 * one, and an empty rail to a flag would say it a second time.
 *
 * The menu offers Delete only while the roadmap holds no milestone — the store refuses the rest — and
 * never offers to make a roadmap: that is the picker's own last row.
 *
 * Used by `RoadmapPath`, keyed by the roadmap's name, so a switch starts its fold afresh.
 */
export function RoadmapHeader({ roadmap, focused, onFocus }: RoadmapHeaderProps) {
  const { t } = useTranslation();
  const { openDialog } = useContext(RoadmapFaceContext);
  // The goal's heading: the fold measures whether its three clamped lines hold all of it.
  const goalRef = useRef<HTMLHeadingElement>(null);
  // Whether the goal is drawn whole, once Show all is pressed. Local and never remembered: the header is
  // keyed by its roadmap's name, so another roadmap starts its goal folded again.
  const [goalWhole, showWholeGoal] = useState(false);
  // Whether the clamped goal runs past its three lines, so Show all is offered only when there is more to
  // show. A measurement of the laid-out heading (its content taller than its box), which no prop says: it
  // is read when the goal changes and again whenever the heading is resized, as the face is.
  const [goalLong, setGoalLong] = useState(false);
  useEffect(() => {
    const heading = goalRef.current;
    if (heading === null) return;
    // `observe` delivers a first reading of its own, so the fold is measured as soon as the heading is laid out.
    // More than half a line of content below the box is hidden lines; less is just the serif's glyphs
    // reaching past its tight leading (a one-line goal measures 3px over at 36px type).
    const observer = new ResizeObserver(() => {
      const line = Number.parseFloat(getComputedStyle(heading).lineHeight);
      setGoalLong(heading.scrollHeight - heading.clientHeight > line / 2);
    });
    observer.observe(heading);
    return () => observer.disconnect();
  }, [roadmap.goal]);

  const items: ActionMenuItem[] = [
    { key: 'edit', label: t('roadmap.menu.editRoadmap'), icon: Pencil, onSelect: () => openDialog({ dialog: 'edit', kind: 'roadmap', item: roadmap }) },
    { key: 'add-milestone', label: t('roadmap.menu.addMilestone'), icon: Plus, onSelect: () => openDialog({ dialog: 'add', kind: 'milestone', parent: roadmap }) },
    ...(roadmap.milestones.length === 0
      ? [{ key: 'delete', label: t('roadmap.menu.delete'), icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: () => openDialog({ dialog: 'delete', kind: 'roadmap', item: roadmap }) }]
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

  return (
    <header className="flex min-w-0 flex-col" data-roadmap-header={roadmap.name}>
      <div className="flex min-w-0 items-center gap-2">
        {/* The picker may shrink, and truncates when it does; capped, so the roadmap's name stays a label rather than a bar. */}
        <div className="w-64 min-w-0 max-w-full">
          <RoadmapPicker size="sm" />
        </div>
        <ActionMenu
          label={t('roadmap.menu.actions', { title: roadmap.title })}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="icon"
          className="ml-auto"
          triggerClassName="h-9 w-9"
        />
      </div>

      {/* A size and its leading are ONE class: `cn` drops a `leading-*` spelled before a later size. 1.15 keeps a clamped last line's descenders whole. */}
      <div className="mt-5 max-w-5xl">
        {roadmap.goal ? (
          <>
            <h2
              ref={goalRef}
              data-roadmap-goal
              className={cn('text-balance break-words font-serif text-[2rem]/[1.15] font-normal text-foreground md:text-[2.25rem]/[1.15]', !goalWhole && 'line-clamp-3')}
            >
              {roadmap.goal}
            </h2>
            {goalLong && !goalWhole && (
              <Button variant="link" size="sm" className="-ml-3 h-8" onClick={() => showWholeGoal(true)}>
                {t('roadmap.goal.showAll')}
              </Button>
            )}
          </>
        ) : (
          <h2 className="font-normal">
            <button
              type="button"
              onClick={() => openDialog({ dialog: 'edit', kind: 'roadmap', item: roadmap, goalFirst: true })}
              className="text-left font-serif text-[2rem]/[1.15] italic text-muted-foreground underline decoration-border decoration-dashed decoration-1 underline-offset-8 hover:text-foreground md:text-[2.25rem]/[1.15]"
            >
              {t('roadmap.goal.missing')}
            </button>
          </h2>
        )}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums text-muted-foreground" data-roadmap-standing>
        {facts.map((fact, index) => (
          <Fragment key={fact.key}>
            {index > 0 && <span aria-hidden="true">·</span>}
            <span data-roadmap-fact={fact.key} className={cn(fact.ink === 'accent' && 'font-medium text-accent-ink', fact.ink === 'warn' && 'font-medium text-warn-ink')}>{fact.text}</span>
          </Fragment>
        ))}
      </p>

      {roadmap.milestones.length > 0 && (
        <div className="mt-9">
          <MilestonePath roadmap={roadmap} focused={focused} onFocus={onFocus} size="full" />
        </div>
      )}
    </header>
  );
}
