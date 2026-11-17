import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DispatcherPace } from '@/shared/types';

/**
 * THE PACER'S PICTURE ON THE BOARD'S MASTER CONTROLLER — one line of the dispatcher's own words,
 * beside Pause all and its running readout, and never a second sentence composed here.
 *
 * ONE UNBREAKABLE PIECE IN A WRAPPING ROW: `flex-none` so the row wraps BETWEEN this line and the
 * controls and never inside it, `max-w-full break-words` so at 320px the sentence uses every pixel of
 * its row and wraps at its own spaces rather than pushing the row wider than the phone. The row is
 * `items-end`, so `pb-1.5` sits the line on the readout's baseline.
 *
 * DRAWN FROM THE FRAME AND NEVER GUESSED (`route.pace.words`): the dispatcher writes the sentence and
 * decides what it says — pacing with room, held, one start at a time while it probes — so the board
 * cannot disagree with the gate. A pace that is absent (an older dispatcher) or `null` (the document
 * saying there is no picture) or wordless draws NOTHING: the controls are exactly the row they were.
 *
 * A HOLD IS NOT AN ERROR (MAN-464): the line wears muted ink whatever it says, as a wait does
 * everywhere on the board; amber belongs to the error tone and never to the pacer's arithmetic.
 *
 * Handles: `data-pace-line` on the line, `data-pace-held` and `data-pace-probe` carrying the picture's
 * two facts for a probe.
 *
 * Used by `MasterController` (runner-tab), after its readout.
 */
export function PaceLine({ pace }: { pace?: DispatcherPace | null }) {
  const words = pace?.words?.trim();
  if (!words || !pace) return null;
  return (
    <span
      data-pace-line=""
      data-pace-held={String(pace.held > 0)}
      data-pace-probe={String(pace.probe)}
      className="min-w-0 max-w-full flex-none break-words pb-1.5 text-xs tabular-nums text-muted-foreground"
    >
      {words}
    </span>
  );
}

/**
 * THE HELD CARD'S PACE LINE, in the row where `queue_hold` draws — the dispatcher's
 * clause in the dispatcher's words, on the same rule as the queue's: the card says "Held by pace"
 * itself, so the `pace:` lead is stripped and never read twice.
 *
 * `kind="cpu"` IS THE SAME LINE FOR THE OTHER HOLD ON A START, the box's CPU being full (`CpuWaitOverride`): the card says
 * "Waiting for CPU" itself and the clause is the gate's own words (`cpu_wait.words`: `12.6 of 12 cores busy over the last minute`).
 * One line and one press beside it for both, so a wait for CPU reads as a hold does everywhere on the board — muted, never an error.
 *
 * The card draws whichever of the two holds arrived, both when both did (a plan the queue holds can carry the clause of a
 * planner outing aimed at it); a hold that is absent (an older dispatcher), empty, or only a lead draws nothing at all.
 *
 * `children` is the press that sits beside the clause (`PaceOverride`'s Override, `CpuWaitOverride`'s): the clause and its
 * press are one unbreakable pair in the card's wrapping row, and a hold that draws nothing draws no press.
 *
 * Handles: `data-plan-pace-hold` on the line, or `data-plan-cpu-wait` on a CPU wait's.
 *
 * Used by `PaceOverride` and `CpuWaitOverride` (this module), which `PlanCard`, `DispatchArcDeck` and `PlanningCard` draw.
 */
export function PaceHoldLine({ hold, kind = 'pace', children }: { hold?: string | null; kind?: 'pace' | 'cpu'; children?: ReactNode }) {
  const { t } = useTranslation();
  const clause = (hold ?? '').replace(/^pace:\s*/, '').trim();
  if (!clause) return null;
  const line = (
    <span
      {...(kind === 'cpu' ? { 'data-plan-cpu-wait': '' } : { 'data-plan-pace-hold': '' })}
      className="min-w-0 break-words text-xs text-muted-foreground"
    >
      {kind === 'cpu'
        ? t('cpuWait.line', { clause, defaultValue: 'Waiting for CPU · {{clause}}' })
        : t('dispatcher.paceHold', { clause, defaultValue: 'Held by pace · {{clause}}' })}
    </span>
  );
  if (!children) return line;
  return <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{line}{children}</span>;
}
