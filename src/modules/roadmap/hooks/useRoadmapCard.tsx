import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { useFeatureCases } from '@/modules/roadmap/hooks/useFeatureCases';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { FeatureCases } from '@/modules/roadmap/modals/FeatureCases';
import { dotStateOf } from '@/modules/roadmap/utils/treeLayout';
import type { RoadmapEpic, RoadmapFeature, RoadmapPicture } from '@/shared/roadmap-types';
import type { RoadmapDotState } from '@/shared/types';

/**
 * What the roadmap holds under one name, ready for the two drawings that show it. A `feature`: the feature, the picture its
 * waits are named from, and its Cases section as the feature dialog draws it (`null` when it keeps no case). An `epic`: the
 * epic, its milestone's 1-based place on its roadmap, and every one of its features' dot state, the tree's own.
 */
export type RoadmapCardFacts =
  | { kind: 'feature'; feature: RoadmapFeature; picture: RoadmapPicture; cases: ReactNode }
  | { kind: 'epic'; epic: RoadmapEpic; n: number; dots: ReadonlyMap<string, RoadmapDotState> };

/** The feature or the epic called `name` on any roadmap of the picture, with the place its drawing needs; null when none holds it. */
function findCard(picture: RoadmapPicture, name: string) {
  for (const roadmap of picture.roadmaps) {
    for (const [at, milestone] of roadmap.milestones.entries()) {
      for (const epic of milestone.epics) {
        const feature = epic.features.find((item) => item.name === name);
        if (feature) return { kind: 'feature' as const, feature };
        if (epic.name === name) {
          const dots = new Map(epic.features.map((item) => [item.name, dotStateOf(item, epic, milestone)] as const));
          return { kind: 'epic' as const, epic, n: at + 1, dots };
        }
      }
    }
  }
  return null;
}

/**
 * The roadmap's own facts of the feature or epic called `name`, for a page that draws them outside the Roadmap tab (the
 * station's stage, through `FeatureFacts` and `EpicPanel`). Read off the live picture, so a frame redraws it.
 *
 * Three answers: `undefined` while the picture has not landed (whether the roadmap holds the name is not known yet), `null`
 * once it has and holds no feature or epic of that name, else the facts. A `null` name asks nothing and reads nothing — the
 * caller has the name drawn some other way, and no cases are fetched for it. A feature that keeps cases reads them as the
 * feature dialog does (`useFeatureCases`), once per change of their counts.
 *
 * Exported through the roadmap barrel; its consumer is src/modules/station (`CardStage`).
 */
export function useRoadmapCard(name: string | null): RoadmapCardFacts | null | undefined {
  const { picture } = useRoadmap();
  const found = useMemo(() => (picture === null || name === null ? null : findCard(picture, name)), [picture, name]);
  const caseRead = useFeatureCases(name ?? '', found?.kind === 'feature' ? found.feature.cases : null);

  return useMemo(() => {
    if (picture === null) return undefined;
    if (found === null) return null;
    if (found.kind === 'epic') return found;
    const keepsCases = found.feature.cases.total > 0;
    const cases = keepsCases ? <FeatureCases cases={caseRead.cases} loading={caseRead.loading} failure={caseRead.failure} /> : null;
    return { kind: 'feature' as const, feature: found.feature, picture, cases };
  }, [picture, found, caseRead]);
}
