import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RndEpicChoice } from '@/modules/rnd/AdoptDialog';
import { useRoadmap } from '@/modules/roadmap';

/**
 * The epics a proved candidate can be adopted under, from the roadmap picture the client already holds (RoadmapFeed), in the
 * roadmap's own order: each roadmap's milestones and their epics, then the epics under no milestone yet.
 */
export function useRndEpics(): RndEpicChoice[] {
  const { t } = useTranslation();
  const { picture } = useRoadmap();
  return useMemo(() => {
    if (picture === null) return [];
    const placed = picture.roadmaps.flatMap((roadmap) => roadmap.milestones.flatMap((milestone) => (
      milestone.epics.map((epic) => ({ name: epic.name, title: epic.title, milestone: milestone.title }))
    )));
    const unplaced = picture.unplaced.epics.map((epic) => ({ name: epic.name, title: epic.title, milestone: t('rnd.noMilestone') }));
    return [...placed, ...unplaced];
  }, [picture, t]);
}
