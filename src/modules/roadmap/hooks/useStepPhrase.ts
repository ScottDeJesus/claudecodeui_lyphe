import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_PICTURE } from '@/modules/roadmap/fake'; // FILL: fake — import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import type { RoadmapFeature, RoadmapFeatureStep, RoadmapPicture } from '@/shared/roadmap-types';
import { formatShortDate, roadmapFeatureIndex } from '@/shared/utils';

/** The steps the locale has a phrase for, as `roadmap.step.<step>` keys. `waiting` and `shipped` are spelled apart: each needs a value. */
const PLAIN_STEPS: ReadonlySet<RoadmapFeatureStep> = new Set<RoadmapFeatureStep>([
  'idea', 'proposed', 'designing', 'questions', 'cutting', 'accept', 'parked', 'building', 'queued', 'paused', 'starting',
]);

/**
 * A feature's step in plain words: `being designed`, `waiting on you: Accept`, `waiting on The day
 * sheet`, `shipped Oct 3`. Used by `FeatureRow`, which shows it beside the feature's step line and hands
 * it to `StateLine` for its label, and by `FeatureFacts` (`FeatureDialog`'s body), under the large step
 * line.
 *
 * `building` names no count: the row's meter, right under it, carries "3 of 13 tasks", and the dialog's
 * task list does. A `waiting` feature names the first feature it waits on that has not shipped, found
 * anywhere in the picture; one the picture cannot name — a feature under an epic no milestone holds is
 * in neither `roadmaps` nor `unplaced` — reads "waiting on another feature", never its slug. A step this
 * screen has no phrase for is the dispatcher's own word, shown as it is (`report_roadmap.feature_word`
 * reads a state it has no step for as that state, "so a new state shows itself instead of hiding").
 */
export function useStepPhrase(feature: RoadmapFeature): string {
  const { t } = useTranslation();
  const picture: RoadmapPicture | null = FAKE_PICTURE; // FILL: picture — useRoadmap().picture: the whole picture, so a wait on a feature of another roadmap still has its title

  const waitingOn = useMemo(() => {
    if (feature.step !== 'waiting' || picture === null) return null;
    const index = roadmapFeatureIndex(picture);
    return feature.waits_on.map((name) => index.get(name)).find((item) => item !== undefined && item.word !== 'shipped')?.title ?? null;
  }, [feature.step, feature.waits_on, picture]);

  if (feature.step === 'waiting') {
    return waitingOn === null ? t('roadmap.step.waitingOnAnother') : t('roadmap.step.waiting', { title: waitingOn });
  }
  if (feature.step === 'shipped') {
    const date = formatShortDate(feature.shipped_at);
    return date === null ? t('roadmap.step.shippedUndated') : t('roadmap.step.shipped', { date });
  }
  return PLAIN_STEPS.has(feature.step) ? t(`roadmap.step.${feature.step}`) : feature.step;
}
