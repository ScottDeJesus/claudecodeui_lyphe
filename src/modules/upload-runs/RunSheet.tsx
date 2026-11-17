import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { HealCard, HealItem } from '@/modules/heal';
import { RunAfter } from '@/modules/upload-runs/RunAfter';
import { RunBumps } from '@/modules/upload-runs/RunBumps';
import { RunEvents } from '@/modules/upload-runs/RunEvents';
import { RunFrictionSection } from '@/modules/upload-runs/RunFrictionSection';
import { RunSheetHead } from '@/modules/upload-runs/RunSheetHead';
import { RunWalks } from '@/modules/upload-runs/RunWalks';
import type { RunSheetRead } from '@/modules/upload-runs/utils/uploadsModel';
import { verdictHeading } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunSummary } from '@/shared/upload-runs-types';
import { Banner, Button, Sheet } from '@/shared/ui';

type RunSheetProps = {
  /** The run as the overview listed it, so the head stands while the run's own read is out; null when the window no longer lists it. */
  summary: UploadRunSummary | null;
  /** The run's own read. */
  sheet: RunSheetRead;
  /** The step the live run's walk stands at, when this sheet is on the live run; null otherwise. */
  walkStep: string | null;
  now: number;
  onClose: () => void;
  onShowEarlier: () => void;
  onRetry: () => void;
  onOpenFriction: (item: HealItem) => void;
  onOpenBrief: (heal: HealCard) => void;
};

const SECTIONS = ['bumps', 'events', 'walks', 'after', 'friction'] as const;

/**
 * ONE RUN, in the shared Sheet over the tab: one at a time, closed by Escape, its ✕ or a press on the scrim.
 *
 * Its heading is the verdict as a plain sentence ("This run hit a hiccup"), with no accent word: the Sheet paints an
 * accent in the accent green, and a state must not be said in a colour that is not its tone. The verdict's badge, right
 * under the heading, carries the tone. Under it the head (the ending sentence, the
 * facts, how far the upload got), then five sections in the order a person asks them: what stood against it (Speed
 * bumps), what happened inside it (Inside the run), which flow it walked and how each step went (The flow it walked),
 * what a person did with what it prepared (After the run), and what tripped the agent and what healed it (The agent's own
 * friction).
 *
 * THE STATES. While the run's own read is out, the head already stands from the overview's row and the five sections
 * are drawn as their eyebrows over shimmering rows, so nothing moves when the answer lands. When that read failed, the
 * lane's own sentence stands under the head with Try again, and no section is drawn empty in its place. READ-ONLY: the
 * sheet has no footer, since Cerberus starts, answers and stops nothing.
 *
 * Used by this module's root, `UploadsView`, which mounts it only while a run is open and the view is shown.
 */
export function RunSheet({ summary, sheet, walkStep, now, onClose, onShowEarlier, onRetry, onOpenFriction, onOpenBrief }: RunSheetProps) {
  const { t } = useTranslation();
  const s = 'cerberus.uploads.sheet';
  const whole = sheet.whole;
  const run = whole?.run ?? summary;
  const heading = run === null ? t(`${s}.heading.reading`) : verdictHeading(t, run);

  return (
    <Sheet open onClose={onClose} title={heading} width="min(680px, 100%)">
      <div className="flex min-w-0 flex-col gap-[22px] pb-safe-area-inset-bottom" data-uploads-sheet={sheet.phase}>
        {run !== null && <RunSheetHead run={run} whole={whole} now={now} />}

        {sheet.phase === 'trouble' ? (
          // The run's read failed: the lane's sentence and the way back. The head above, from the overview, still stands.
          <div role="alert">
            <Banner
              tone="warn"
              action={<Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>{t('cerberus.uploads.trouble.retry')}</Button>}
            >
              <p className="text-sm font-medium">{t(`${s}.trouble`)}</p>
              {sheet.trouble !== null && <p className="mt-0.5 text-xs">{sheet.trouble}</p>}
            </Banner>
          </div>
        ) : whole === null || run === null ? (
          // The run's read is out: the five eyebrows over shimmering rows, shaped as what will land under each.
          <div aria-busy="true" className="flex flex-col gap-[22px]">
            {SECTIONS.map((section) => (
              <SheetSection key={section} title={t(`${s}.${section}.title`)}>
                {(section === 'events' ? [0, 1, 2, 3] : [0, 1]).map((row) => <div key={row} className="vv-skeleton h-7" />)}
              </SheetSection>
            ))}
          </div>
        ) : (
          <>
            <SheetSection title={t(`${s}.bumps.title`)}><RunBumps run={run} /></SheetSection>
            <SheetSection title={t(`${s}.events.title`)}>
              {/* Keyed by the run, so another run's feed starts at its own foot with no line open. */}
              <RunEvents key={run.session_id} events={sheet.events} total={run.counts.events} hasEarlier={sheet.hasEarlier} live={sheet.live} imported={run.imported} onShowEarlier={onShowEarlier} />
            </SheetSection>
            <SheetSection title={t(`${s}.walks.title`)}><RunWalks walks={whole.walks} live={sheet.live} walkStep={walkStep} /></SheetSection>
            <SheetSection title={t(`${s}.after.title`)}><RunAfter walks={whole.walks} after={whole.after} presses={whole.presses} /></SheetSection>
            <SheetSection title={t(`${s}.friction.title`)}>
              <RunFrictionSection
                friction={sheet.friction}
                frictionFailed={sheet.frictionFailed}
                noSession={run.claude_session_id === null}
                now={now}
                onRetry={onRetry}
                onOpenFriction={onOpenFriction}
                onOpenBrief={onOpenBrief}
              />
            </SheetSection>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** One of the sheet's sections: its eyebrow, then what it holds. */
function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5">
      <h3 id={headingId} className="m-0 text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
