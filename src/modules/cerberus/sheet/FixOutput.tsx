import type { TFunction } from 'i18next';
import { memo, useId, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useClock } from '@/modules/cerberus/hooks/useClock';
import { useRunOutput } from '@/modules/cerberus/hooks/useRunOutput';
import { MarkIcon } from '@/modules/cerberus/StatusMarks';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import { RUN_LOOK } from '@/modules/cerberus/utils/cerberusStatus';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusRunLine, CerberusRunView } from '@/shared/cerberus-types';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The pill's word for where a run stands: Running, Succeeded, Failed · exit 1, Timed out, Refused. Its icon is `RUN_LOOK`'s. */
function pillWord(t: TFunction, run: CerberusRunView): string {
  switch (run.result) {
    case null:
      return t('cerberus.fix.output.running');
    case 'ok':
      return t('cerberus.fix.output.ok');
    case 'failed':
      return run.exit === null ? t('cerberus.fix.output.failed') : t('cerberus.fix.output.failedExit', { exit: run.exit });
    case 'timed_out':
      return t('cerberus.fix.output.timedOut');
    case 'refused':
      return t('cerberus.fix.output.refused');
  }
}

/** "Ran on its own · warden on eis1 · started 17:52:01", "You ran it · …"; a refusal never started, so it says when it was refused. */
function metaOf(t: TFunction, run: CerberusRunView): string {
  const who = t(run.by === 'auto' ? 'cerberus.fix.output.ranAuto' : 'cerberus.fix.output.ranYou');
  return run.result === 'refused'
    ? t('cerberus.fix.output.metaRefused', { who, node: run.node, time: hms(run.endedAt ?? run.requestedAt) })
    : t('cerberus.fix.output.meta', { who, node: run.node, time: hms(run.startedAt ?? run.requestedAt) });
}

/** "took 12 s" once it ended; the seconds so far while it runs; nothing for a refusal, which never started. */
function elapsedOf(t: TFunction, run: CerberusRunView, now: number): string | null {
  if (run.result === 'refused') return null;
  const from = run.startedAt ?? run.requestedAt;
  if (run.result === null) return t('cerberus.fix.output.elapsed', { count: Math.max(0, Math.floor((now - from) / 1_000)) });
  return t('cerberus.fix.output.took', { count: Math.max(0, Math.round(((run.endedAt ?? from) - from) / 1_000)) });
}

/**
 * One output line: "+04s <text>", rising in as it arrives, a ✓ line in the positive ink. Memoised on its
 * line, so a line added to the pane draws only itself: a replay of thousands of lines would otherwise redraw
 * every row already shown at each reveal.
 */
const OutputLine = memo(function OutputLine({ line }: { line: CerberusRunLine }) {
  const { t } = useTranslation();
  const ok = line.line.startsWith('✓');
  return (
    <p className="flex gap-3 motion-safe:animate-cerberus-line">
      <span className="flex-none text-muted-foreground">{t('cerberus.fix.output.offset', { seconds: String(Math.round(line.t)).padStart(2, '0') })}</span>
      <span data-tone={ok ? 'positive' : undefined} className={cn('min-w-0 [overflow-wrap:anywhere]', ok && 'text-tone-ink')}>{line.line}</span>
    </p>
  );
});

/** The card's frame and its head's eyebrow, shared by the run and its placeholder. */
const FRAME = 'overflow-hidden rounded-xl border border-border bg-card';
const EYEBROW = 'm-0 text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground';
/** The output pane: a well on the canvas, mono; past its height it scrolls. */
const PANE = 'flex max-h-[min(26rem,60vh)] min-h-[112px] flex-col overflow-y-auto bg-background px-3.5 py-3 font-mono text-xs leading-[1.75] text-secondary-foreground';

/** How near the pane's end, in px, still counts as reading the newest line: a reader there is followed as lines arrive. */
const FOLLOW_SLACK_PX = 8;

/** The card's shape, shimmering, while the run's first read is out: the eyebrow is known, so it is written. */
function ReadingRun({ eyebrowId }: { eyebrowId: string }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={eyebrowId} aria-busy="true" className={FRAME}>
      <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h4 id={eyebrowId} className={EYEBROW}>{t('cerberus.fix.output.title')}</h4>
          <div className="vv-skeleton h-[18px] w-3/5" />
          <div className="vv-skeleton h-3 w-4/5" />
        </div>
        <div className="vv-skeleton h-[22px] w-24 flex-none rounded-full" />
      </div>
      <div className={PANE}>
        <div className="flex flex-col gap-2 py-1">
          <div className="vv-skeleton h-3 w-2/3" />
          <div className="vv-skeleton h-3 w-1/2" />
        </div>
      </div>
    </section>
  );
}

/**
 * The card when the run's own read did not answer: its eyebrow, then "Cerberus can't be reached" with Try
 * again, the tab's one spelling of a read that failed. The sheet's banner speaks only for the check's read.
 */
function UnreadRun({ eyebrowId, onRetry }: { eyebrowId: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={eyebrowId} className={FRAME}>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <h4 id={eyebrowId} className={EYEBROW}>{t('cerberus.fix.output.title')}</h4>
        <UnreachableBanner onRetry={onRetry} />
      </div>
    </section>
  );
}

/**
 * FIX OUTPUT: one run of a fix as it happens, or as it happened (`design/cerberus/Cerberus Tab.dc.html`
 * :429-449). In the check sheet, under the check and its actions.
 *
 * The head: the eyebrow "Fix output", the fix's name, who started it on which warden and when ("Ran on its
 * own · warden on eis1 · started 17:52:01"); on the right the pill (`Badge`, `RUN_LOOK`'s tone and icon)
 * — Running (its wrench breathing), Succeeded, Failed · exit 1, Timed out, Refused — and "took
 * 12 s", or the seconds so far while it runs. The pill is the one polite region, so the end of a run is
 * heard; the seconds are not.
 *
 * The pane: "$ <cmd>", then each line as "+04s <text>", rising in as it arrives (`cerberus-line`); a line
 * the command opens with ✓ is in the positive ink. The sentence a run ended on that its command did not
 * print — a refusal's reason, "The warden restarted while it ran; …" — follows in the result's ink and
 * the body face. While it runs, the caret blinks after the last line (still, with motion reduced). The
 * pane holds at most 26rem, so a long run never pushes the rest of the sheet away: past it, it scrolls. It
 * opens on the newest line and follows each one that arrives while you are at the bottom; scrolled back to
 * read, it holds still under you until you return.
 *
 * Until its read answers, the card's shape shimmers. A read that did not answer keeps the frame and says
 * so, with Try again (`UnreadRun`).
 *
 * For the check sheet (`CheckSheet`), keyed by the run: the run it was opened on, else the check's latest; and
 * for the diagnosis panel (`DiagnosisPanel`), which draws its proposal's one-off run straight under the proposal.
 */
export function FixOutput({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const eyebrowId = useId();
  const nameId = useId();
  // The run as center last answered it (null until its first read, `failed` when that did not answer) and its
  // lines: streamed as they arrive, or a run that ended replayed at the pace it ran.
  const { run, lines, replaying, failed, refresh } = useRunOutput(runId);
  // The seconds so far count from the run's start, once a second while it goes; an ended run needs no tick,
  // so its clock waits an hour between them.
  const now = useClock(run !== null && run.result === null ? 1_000 : 3_600_000);
  const onRetry = () => {
    refresh();
  };

  // The pane, and whether its reader is at the newest line. Arriving lines are followed only then, so a
  // person reading back holds still; it starts there, so a run opens on its newest line. A ref, not state:
  // it steers the scroll and changes nothing drawn.
  const paneRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane !== null && followingRef.current) pane.scrollTop = pane.scrollHeight;
  });
  const onScroll = () => {
    const pane = paneRef.current;
    if (pane !== null) followingRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight <= FOLLOW_SLACK_PX;
  };

  if (run === null) return failed ? <UnreadRun eyebrowId={eyebrowId} onRetry={onRetry} /> : <ReadingRun eyebrowId={eyebrowId} />;
  const going = run.result === null;
  const look = RUN_LOOK[run.result ?? 'going'];
  const elapsed = elapsedOf(t, run, now);

  return (
    <section aria-labelledby={eyebrowId} className={cn(FRAME, 'motion-safe:animate-[vv-pop_.5s_theme(transitionTimingFunction.enter)_both]')}>
      <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <h4 id={eyebrowId} className={EYEBROW}>{t('cerberus.fix.output.title')}</h4>
          <p id={nameId} className="text-[14.5px] font-medium [overflow-wrap:anywhere]">{run.name}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{metaOf(t, run)}</p>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <div role="status">
            {/* Keyed by the result, so the pill an ended run lands on springs in, once. While it runs only the
                wrench breathes, so the word never dims under the eye. */}
            <Badge
              key={run.result ?? 'going'}
              as="span"
              tone={look.tone}
              className={cn('gap-1.5 whitespace-nowrap', !going && 'motion-safe:animate-cerberus-check')}
            >
              <MarkIcon icon={look.icon} className={cn('size-3.5', going && 'motion-safe:animate-cerberus-breathe')} />
              <span>{pillWord(t, run)}</span>
            </Badge>
          </div>
          {elapsed !== null && <span className="text-[11.5px] tabular-nums text-muted-foreground">{elapsed}</span>}
        </div>
      </div>
      <div ref={paneRef} role="log" aria-labelledby={nameId} onScroll={onScroll} className={PANE}>
        <p className="text-muted-foreground [overflow-wrap:anywhere]">{t('cerberus.fix.command', { cmd: run.cmd })}</p>
        {lines.map((line) => <OutputLine key={line.n} line={line} />)}
        {/* The sentence a run ended on follows its lines, so it waits for the last of them while they replay. */}
        {run.note !== null && !replaying && (
          <p data-tone={look.tone} className="mt-1 font-sans text-[12.5px] leading-normal text-tone-ink [overflow-wrap:anywhere]">{run.note}</p>
        )}
        {going && <span aria-hidden className="mt-1 inline-block h-3.5 w-[7px] flex-none self-start bg-secondary-foreground motion-safe:animate-cerberus-caret" />}
      </div>
    </section>
  );
}
