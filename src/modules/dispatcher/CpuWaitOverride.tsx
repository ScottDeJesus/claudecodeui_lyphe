import { useTranslation } from 'react-i18next';

import { PaceHoldLine } from '@/modules/dispatcher/PaceLine';
import { useCpuRelease } from '@/shared/hooks/useCpuRelease';
import type { DispatcherCpuWait } from '@/shared/types';
import { Button } from '@/shared/ui';

/**
 * THE CARD'S DOOR TO THE RUNNER'S CPU WAIT: `Waiting for CPU · <why>` with `Override` beside it, composed from the usage pacer's own hold
 * line and press (`PaceHoldLine`, `PaceOverride`'s button). The runner holds back an agent it is about to start while the box's CPU is full
 * (`hooks/plan_runner/pacer/cpu_wait.py`); a card that said nothing would read as a stuck plan. The line draws what the document carries
 * (`plan.cpu_wait`, `arc.cpu_wait`, a planner entry's own) — the gate's own words — and composes none of it.
 *
 * ONE PRESS LETS THAT ONE AGENT START NOW, and does not switch the check off: the next agent is weighed as before (`useCpuRelease`,
 * `pacer cpu-release`). It is drawn against the wait alone, so a plan whose agent is not waiting draws neither the line nor the press, and
 * the wait is a fact about an AGENT: the plan's status, its usage-pacer hold and its override never move with it. Nothing is optimistic — the
 * next frame redraws from the marker the runner clears once the agent has started.
 *
 * Handles: `data-plan-cpu-wait` on the line, `data-cpu-wait-override` on the press and `data-launch-id` carrying the agent's launch id.
 *
 * Used by `PlanCard` (a phase's agent, or a planner outing aimed at the plan), by `DispatchArcDeck` (the epic's own planner outing) and by
 * `PlanningCard` (an outing whose subject has neither a card nor a deck on screen).
 */
export function CpuWaitOverride({ wait }: { wait: DispatcherCpuWait }) {
  const { t } = useTranslation();
  const { release, busy } = useCpuRelease(wait.launch);
  return (
    <PaceHoldLine hold={wait.words} kind="cpu">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 finger:h-11"
        disabled={busy}
        title={t('cpuWait.overrideTitle')}
        onClick={() => void release()}
        data-cpu-wait-override
        data-launch-id={wait.launch}
      >
        {t('dispatcher.override.press')}
      </Button>
    </PaceHoldLine>
  );
}
