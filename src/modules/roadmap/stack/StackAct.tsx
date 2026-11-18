import { ListChecks, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDispatcherPlans, useDispatcherVerbs } from '@/modules/dispatcher';
import { dismissFinished } from '@/modules/roadmap/utils/ringFinished';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapStackWall } from '@/shared/types';
import { Button } from '@/shared/ui';

type StackActProps = {
  roadmap: Roadmap;
  /** The wall that faces the operator. */
  wall: RoadmapStackWall;
  /** Opens the wall's card: the one way to a press that must be read first (an Accept). */
  onOpen: () => void;
};

/** Under a finger a press is its icon alone in a 44 px square; its word stays its name. */
const PRESS = 'pointer-events-auto finger:h-11 finger:w-11 finger:px-0';

/**
 * THE ONE PRESS THE FACING WALL OFFERS, under its words: the way on for what can be started and the way off for what is
 * finished, without opening its card.
 *
 * - Finished: Dismiss. It leaves the ring (`utils/ringFinished`); nothing of the feature changes.
 * - Held for its Start: Start, the dispatcher's own `resume`, the same press as the card's.
 * - Stopped (paused, or stalled): Resume, the same verb under the card's own word.
 * - Still being cut: Accept when cut, the dispatcher's own arming press (it starts by itself when its cut lands); once
 *   armed it says so and offers nothing (Cancel is on its card).
 * - Cut and waiting on its Accept: Review. An Accept approves exactly what its census shows (the lock law: the press
 *   is one made with the census in front of him), so the ring never accepts by itself; this opens the card at it.
 * - Being built: nothing. Stop is on its card.
 *
 * Which of Start and Resume a plan takes is read off the dispatcher's own plan, as its card reads it (`PlanControls`);
 * a feature the lane does not carry offers neither.
 *
 * Used by `stack/RoadmapStack`, under the reading.
 */
export function StackAct({ roadmap, wall, onOpen }: StackActProps) {
  const { t } = useTranslation();
  const { feature } = wall;
  const { plans } = useDispatcherPlans();
  const plan = plans.find((item) => item.name === feature.name) ?? null;
  const starts = plan !== null && (plan.status === 'queued' || (plan.status === 'scheduled' && !plan.launched));
  const stops = plan !== null && (plan.status === 'paused' || plan.status === 'stalled' || (plan.status === 'scheduled' && plan.launched));
  const { resume, armAccept, busy } = useDispatcherVerbs(feature.name, 'plan', starts ? t('runner.start') : t('runner.resume'));
  const held = busy !== null;

  const press = (act: string, label: string, icon: ReactNode, onClick: () => void, variant: 'default' | 'outline' = 'default') => (
    <Button data-roadmap-stack-act={act} size="sm" variant={variant} className={PRESS} disabled={held} aria-label={label} title={label} onClick={onClick}>
      {icon}
      <span className="finger:hidden">{label}</span>
    </Button>
  );

  if (wall.kind === 'finished') {
    const features = roadmap.milestones.flatMap((milestone) => milestone.epics.flatMap((epic) => epic.features));
    return press('dismiss', t('roadmap.stack.dismiss'), <X aria-hidden="true" />, () => dismissFinished(roadmap.name, feature, features), 'outline');
  }
  if (starts) return press('start', t('runner.start'), <Play aria-hidden="true" />, () => void resume());
  if (stops) return press('resume', t('runner.resume'), <Play aria-hidden="true" />, () => void resume());
  if (feature.step === 'accept') return press('review', t('roadmap.stack.review'), <ListChecks aria-hidden="true" />, onOpen);
  if (feature.step === 'cutting' && plan !== null) {
    if (plan.accept_armed) {
      return <span data-roadmap-stack-act="armed" className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{t('dispatcher.acceptWhenCutArmed')}</span>;
    }
    if (plan.state === 'designed' && Boolean(plan.design_loaded_at)) {
      return press('arm', t('dispatcher.acceptWhenCut'), <Play aria-hidden="true" />, () => void armAccept(plan.design_loaded_at ?? ''), 'outline');
    }
  }
  return null;
}
