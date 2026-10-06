import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TreeLayout } from '@/modules/roadmap/utils/treeLayout';
import { ROADMAP_EPIC_WORD_KEYS, ROADMAP_FEATURE_WORD_KEYS, ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapTreeSelection } from '@/shared/types';

/** One item's words: the tip draws `head` over `line`, and a node's `aria-label` says the two as one. */
type TreeWords = { head: string; line: string };

/** What an item the picture no longer holds says: nothing. */
const NO_WORDS: TreeWords = { head: '', line: '' };

/** How a line's parts are joined, as the locale's own line keys join theirs. */
const JOIN = ' · ';

/**
 * The words the tree says of each item, in ONE place, so its tip and its nodes' accessible names never part:
 *
 * - the goal: "Goal", then the roadmap's goal (its "missing" words while it has none);
 * - a milestone: "Milestone n · <title>", then "<epics> epics · <word>";
 * - an epic: its title, then "<word> · x of y shipped", or the word alone while it holds no feature, with
 *   " · Blocked" while it carries its own blocked reason;
 * - a feature: its title, then its word, "x of y tasks" once it has a task, and its project, with " · Blocked"
 *   while its dot is blocked (its own reason, its epic's or its milestone's: the layout's rule).
 *
 * Every word is the dispatcher's, spelled through the locale's word keys, and every count is the picture's
 * own. Titles are whole: the drawing's wrapped lines are the layout's business. Used by the roadmap module's
 * tree, `tree/RoadmapTree`, for every node's `aria-label` and for its tip.
 */
export function useTreeWords(roadmap: Roadmap, layout: TreeLayout): (item: RoadmapTreeSelection) => TreeWords {
  const { t } = useTranslation();
  const goal = roadmap.goal;

  return useMemo(() => {
    const milestones = new Map(layout.milestones.map((spot) => [spot.milestone.name, spot]));
    const epics = new Map(layout.milestones.flatMap((spot) => spot.epics.map((row) => [row.epic.name, row.epic] as const)));
    const dots = new Map(layout.milestones.flatMap((spot) => spot.epics.flatMap((row) => row.dots.map((dot) => [dot.feature.name, dot] as const))));

    return (item: RoadmapTreeSelection): TreeWords => {
      if (item.kind === 'roadmap') return { head: t('roadmap.tree.goal'), line: goal ?? t('roadmap.goal.missing') };

      if (item.kind === 'milestone') {
        const spot = milestones.get(item.name);
        if (spot === undefined) return NO_WORDS;
        const { milestone } = spot;
        return {
          head: [t('roadmap.tree.milestone', { n: spot.n }), milestone.title].join(JOIN),
          line: t('roadmap.tree.epics', { count: milestone.standing.epics, word: t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]) }),
        };
      }

      if (item.kind === 'epic') {
        const epic = epics.get(item.name);
        if (epic === undefined) return NO_WORDS;
        const word = t(ROADMAP_EPIC_WORD_KEYS[epic.word]);
        const { features, shipped } = epic.standing;
        const standing = features === 0 ? word : t('roadmap.tree.epicLine', { word, shipped, count: features });
        return { head: epic.title, line: epic.blocked === null ? standing : [standing, t('roadmap.tree.blocked')].join(JOIN) };
      }

      const dot = dots.get(item.name);
      if (dot === undefined) return NO_WORDS;
      const { feature } = dot;
      const done = feature.tasks.filter((task) => task.status === 'done').length;
      const parts = [
        t(ROADMAP_FEATURE_WORD_KEYS[feature.word]),
        ...(feature.tasks.length > 0 ? [t('roadmap.feature.tasks', { done, count: feature.tasks.length })] : []),
        feature.project,
        ...(dot.state === 'blocked' ? [t('roadmap.tree.blocked')] : []),
      ];
      return { head: feature.title, line: parts.join(JOIN) };
    };
  }, [goal, layout, t]);
}
