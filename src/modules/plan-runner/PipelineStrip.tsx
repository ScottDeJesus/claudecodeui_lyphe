import { useTranslation } from 'react-i18next';

import { Chip, Shimmer } from '@/shared/ui';

/**
 * The mark on a stage the runner has already walked in this phase.
 *
 * Spelled here rather than borrowed from `PHASE_GLYPH`: that map is the runner's PHASE vocabulary
 * and a stage is not a phase. The two happen to share a mark today, and if either ever moves it
 * should move alone.
 */
const STAGE_WALKED_GLYPH = '✅';

/**
 * The stages of the phase a run is standing in, as one scrolling row.
 *
 * ✅ COMES FROM THE TIMELINE, NEVER FROM POSITION. `seen` is `seenStages(run)` — the distinct
 * stage words the runner actually LOGGED for this phase — so a chip is marked walked because a
 * line in `runner.log` names it, not because it sits left of the active one. The difference is
 * the whole point of the strip: the runner skips `fix-pass` whenever Athena finds nothing, and a
 * strip that marked every chip before the active one would report a review that never ran on the
 * most common outcome there is.
 *
 * It is built from `Chip` because a chip with no `onClick` renders a static `<span>`
 * (`src/shared/ui/Chip.tsx`) — which is what a stage is. The toggle primitive beside it in the
 * barrel is a real `<button>` that demands an `onClick`, so drawing this with it would mean
 * handing every stage a no-op handler and a focus stop that leads nowhere.
 *
 * THE ACTIVE WORD IS NOT ALWAYS ONE OF THE SIX. `hooks/plan_runner/progress.py::_stage` falls back
 * to the RUN's own status — `running`, `complete`, `all-blocked`, `budget`, `halted`, `dry-run` —
 * whenever no phase holds a stage, which is every start-up and every gap between phases (measured:
 * `all-blocked`, `complete`, `halted` and `budget` are all on disk under `~/.claude/state/runner`
 * right now). Dropped, that word selects nothing and the card's one "what is happening now" signal
 * goes blank; drawn as a seventh chip it would claim to be a link in a chain it is not part of. So
 * it is drawn AFTER the chain, behind a separator, as what it is: the run's own word.
 *
 * Phone-first: the row scrolls sideways rather than wrapping. Six stages do not fit at 390px, and
 * a wrapped strip changes the card's HEIGHT as a run moves, which would shove the transcript
 * underneath it up and down while somebody is reading. Because it scrolls, it is also a FOCUSABLE
 * region with a name: the chips are static spans by design, so without a tab stop of its own a
 * keyboard-only reader has no way to reach the stages that start off-screen.
 */
export function PipelineStrip({
  stages,
  active,
  detail,
  seen,
}: {
  stages: string[];
  active: string;
  detail: string;
  seen: string[];
}) {
  const { t } = useTranslation();

  // The active word when it is not a stage of this run's chain. See the note above.
  const offChain = active !== '' && !stages.includes(active);

  if (stages.length === 0 && !offChain) return null;

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto"
      data-runner-pipeline
      role="group"
      aria-label={t('runner.pipeline')}
      tabIndex={0}
    >
      {stages.map((stage) => {
        const isActive = stage === active;
        const walked = !isActive && seen.includes(stage);

        return (
          // `flex-none` on the wrapper, not the chip: a flex child of a scrolling row shrinks to
          // fit by default, which would squash six stages into the width instead of scrolling.
          <span key={stage} className="flex-none">
            <Chip size="sm" selected={isActive}>
              {walked && <span aria-hidden="true">{STAGE_WALKED_GLYPH}</span>}
              {/* The shimmer is the only thing on the card that says "right now" without a
                  clock: the active stage reads as in motion even in a still screenshot. */}
              {isActive ? <Shimmer>{stage}</Shimmer> : stage}
              {isActive && detail ? <span className="text-muted-foreground">{detail}</span> : null}
            </Chip>
          </span>
        );
      })}

      {offChain && (
        <>
          {/* The separator says "not one of the above" without a word for it. */}
          <span className="flex-none text-muted-foreground" aria-hidden="true">·</span>
          <span className="flex-none">
            <Chip size="sm" selected>
              <Shimmer>{active}</Shimmer>
              {detail ? <span className="text-muted-foreground">{detail}</span> : null}
            </Chip>
          </span>
        </>
      )}
    </div>
  );
}
