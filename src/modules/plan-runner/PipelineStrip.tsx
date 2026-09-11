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
 * The stages of the phase a run is standing in, drawn as chips that WRAP onto as many rows as the
 * width needs.
 *
 * Every stage of the run's chain is drawn: the ones already walked carry the walked glyph, the one in
 * flight shimmers, and a stage word outside the chain (a re-run builder, a stage the runner grew
 * later) is shown after a separator rather than dropped. `seen` is read from the timeline the runner
 * wrote, never inferred from position — a fix-pass that never ran sits left of `checks` and must not
 * read as done.
 *
 * It wraps, and the card's height moves with the run. That is accepted: this strip lives only in the
 * Runner tab's own card list (`RunCard` → `RunnerPanel`, nothing else renders it), never under a chat
 * transcript, so a taller card shoves nothing a reader is following. A single scrolling row was tried
 * first and hid every stage past the fourth at 390px with nothing on screen saying more existed —
 * the operator could not read the strip at all (2026-09-10). It holds no tab stop of its own: it no
 * longer scrolls, and the chips are static spans by design (`Chip.tsx`), so there is nothing inside
 * it for focus to land on.
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
      className="flex flex-wrap items-center gap-1.5"
      data-runner-pipeline
      role="group"
      aria-label={t('runner.pipeline')}
    >
      {stages.map((stage) => {
        const isActive = stage === active;
        const walked = !isActive && seen.includes(stage);

        return (
          // `flex-none` on the wrapper, not the chip: a flex child shrinks to fit by default, which
          // would squash six stages into one row instead of letting them wrap whole.
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
