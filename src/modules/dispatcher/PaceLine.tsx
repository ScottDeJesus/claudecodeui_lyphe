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
 * THE HELD CARD'S PACE LINE, in the row where `queue_hold` and `wip_hold` draw — the dispatcher's
 * clause in the dispatcher's words, on the same rule as the queue's: the card says "Held by pace"
 * itself, so the `pace:` lead is stripped and never read twice.
 *
 * The gate sends one of the three holds at a time, so the card draws whichever one arrived; a hold
 * that is absent (an older dispatcher), empty, or only a lead draws nothing at all.
 *
 * Handles: `data-plan-pace-hold` on the line.
 *
 * Used by `PlanCard` (runner-tab), after its queue line and before its WIP line.
 */
export function PaceHoldLine({ hold }: { hold?: string | null }) {
  const { t } = useTranslation();
  const clause = (hold ?? '').replace(/^pace:\s*/, '').trim();
  if (!clause) return null;
  return (
    <span data-plan-pace-hold="" className="min-w-0 break-words text-xs text-muted-foreground">
      {t('dispatcher.paceHold', { clause, defaultValue: 'Held by pace · {{clause}}' })}
    </span>
  );
}
