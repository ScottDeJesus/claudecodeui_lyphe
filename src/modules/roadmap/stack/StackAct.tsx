import { Check, CircleParking, ListChecks, ListEnd, ListPlus, Play, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDispatcherPlans, useDispatcherVerbs, usePutAway } from '@/modules/dispatcher';
import type { RoadmapStackWall } from '@/shared/types';
import { Button } from '@/shared/ui';

type StackActProps = {
  /** The wall that faces the operator. */
  wall: RoadmapStackWall;
  /** Opens the wall's card: the one way to a press that must be read first (an answer, an Accept). */
  onOpen: () => void;
};

/** Under a finger a press is its icon alone in a 44 px square; its word stays its name. */
const PRESS = 'pointer-events-auto finger:h-11 finger:w-11 finger:px-0';

/**
 * WHAT THE FACING WALL OFFERS, under its words: to start it, to queue it, to hold it, or to put it away, without opening its
 * card. Every press is the plan card's own (`PlanControls`), sent through the same verbs under the same words, so the ring
 * and the In flight board cannot say two things; the ring only keeps the ones a glance can take, two at most.
 *
 * - A word owed (questions to answer, a cut to accept): Review. An answer is given with the question in front of him, and an
 *   Accept approves exactly what its census shows (the lock law), so the ring opens the card at it and presses nothing itself.
 * - Finished: Dismiss, the board's own put-away. It leaves the ring and the board; nothing of the feature changes.
 * - Being built: Stop (a pause: Resume picks it up). Stalled: Resume, and Stop.
 * - Waiting at the gate: Start (now), and Release (back on its turn in the queue). Scheduled and never started: Start.
 * - Stopped: Resume.
 * - Parked: Unpark, back to the queue.
 * - Still being cut: Accept when cut (it starts by itself when its cut lands; once armed it says so, and Cancel is on its
 *   card), and Park.
 *
 * Used by `stack/RoadmapStack`, under the reading.
 */
export function StackAct({ wall, onOpen }: StackActProps) {
  const { t } = useTranslation();
  const { plan } = wall;
  const { carriedNames } = useDispatcherPlans();
  const putAway = usePutAway(carriedNames);
  const starts = plan.status === 'queued' || (plan.status === 'scheduled' && !plan.launched);
  const stops = plan.status === 'paused' || (plan.status === 'scheduled' && plan.launched);
  const { stop, resume, release, park, unpark, armAccept, busy } = useDispatcherVerbs(plan.name, 'plan', starts ? t('runner.start') : t('runner.resume'));
  const held = busy !== null;

  const press = (act: string, label: string, icon: ReactNode, onClick: () => void, variant: 'default' | 'outline' = 'default') => (
    <Button key={act} data-roadmap-stack-act={act} size="sm" variant={variant} className={PRESS} disabled={held} aria-label={label} title={label} onClick={onClick}>
      {icon}
      <span className="finger:hidden">{label}</span>
    </Button>
  );
  const hold = () => press('stop', t('runner.stop'), <Square aria-hidden="true" />, () => void stop(), 'outline');

  let acts: ReactNode[] = [];
  if (plan.status === 'complete') {
    acts = [press('dismiss', t('roadmap.stack.dismiss'), <X aria-hidden="true" />, putAway.plan(plan), 'outline')];
  } else if (plan.asking !== null || (plan.status === 'idle' && (plan.state === 'questions' || plan.state === 'loaded'))) {
    acts = [press('review', t('roadmap.stack.review'), <ListChecks aria-hidden="true" />, onOpen)];
  } else if (plan.status === 'live') {
    acts = [hold()];
  } else if (plan.status === 'stalled') {
    acts = [press('resume', t('runner.resume'), <Play aria-hidden="true" />, () => void resume()), hold()];
  } else if (starts) {
    acts = [
      press('start', t('runner.start'), <Play aria-hidden="true" />, () => void resume()),
      ...(plan.status === 'queued' ? [press('release', t('runner.release'), <ListEnd aria-hidden="true" />, () => void release(), 'outline')] : []),
    ];
  } else if (stops) {
    acts = [press('resume', t('runner.resume'), <Play aria-hidden="true" />, () => void resume())];
  } else if (plan.status === 'parked') {
    acts = [press('unpark', t('dispatcher.unpark'), <ListPlus aria-hidden="true" />, () => void unpark())];
  } else if (plan.status === 'idle' && plan.state === 'designed') {
    const parks = press('park', t('dispatcher.park'), <CircleParking aria-hidden="true" />, () => void park(), 'outline');
    if (plan.accept_armed) {
      return (
        <div className="flex items-center gap-2">
          <span data-roadmap-stack-act="armed" className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{t('dispatcher.acceptWhenCutArmed')}</span>
          {parks}
        </div>
      );
    }
    acts = [
      ...(plan.design_loaded_at ? [press('arm', t('dispatcher.acceptWhenCut'), <Check aria-hidden="true" />, () => void armAccept(plan.design_loaded_at ?? ''))] : []),
      parks,
    ];
  }
  return acts.length === 0 ? null : <div className="flex items-center gap-2">{acts}</div>;
}
