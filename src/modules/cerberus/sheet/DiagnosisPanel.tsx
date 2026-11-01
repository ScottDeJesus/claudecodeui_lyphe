import type { TFunction } from 'i18next';
import { memo, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useDiagnosis } from '@/modules/cerberus/hooks/useDiagnosis';
import { FixOutput } from '@/modules/cerberus/sheet/FixOutput';
import { MarkIcon } from '@/modules/cerberus/StatusMarks';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import { RUN_LOOK } from '@/modules/cerberus/utils/cerberusStatus';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCatalogEntryView, CerberusDiagnosisStep, CerberusDiagnosisView, CerberusRunView } from '@/shared/cerberus-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Badge, Button, CardFoldBody, Collapsible, CollapsibleTrigger, FoldChevron } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The card's frame and its eyebrows: Fix output's, so the two cards the sheet stacks read as one family. */
const FRAME = 'overflow-hidden rounded-xl border border-border bg-card';
const EYEBROW = 'm-0 text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground';

/** The proposal arrives just after the summary it follows from: the prototype's .18 s, inline so no class order resets it. */
const PROPOSAL_ENTER = { animationDelay: '180ms' } as const;

/** How a run of the proposal that started ended, as the "Ran once at …" line says it. A refusal never started: it has its own line. */
const RAN_RESULT = { ok: 'ok', failed: 'failed', timed_out: 'timedOut' } as const;

/** True while `at` (epoch ms) is still to come, false for null: one timeout at the moment turns it false, so nothing polls. */
function useStillAhead(at: number | null): boolean {
  const hostWindow = useHostWindow();
  // The `at` seen to pass: nothing else re-renders when a one-off expires. Seeded at mount, so a long-expired one never shows.
  const [passed, setPassed] = useState<number | null>(() => (at !== null && at <= Date.now() ? at : null));
  useEffect(() => {
    if (at === null) return undefined;
    const timer = hostWindow.setTimeout(() => setPassed(at), Math.max(0, at - Date.now()));
    return () => hostWindow.clearTimeout(timer);
  }, [at, hostWindow]);
  return at !== null && passed !== at;
}

/** The catalog entry a promoted diagnosis became, as the box says it: its current name and auto, or `retired` with the entry's id once it is gone. */
type PromotedEntry = { retired: false; name: string; auto: boolean } | { retired: true; name: string };

/**
 * `promotedTo` (an entry's id) resolved against the catalog the provider holds. The person may have renamed the entry
 * in the dialog, so the diagnosis's own `proposal.name` is not it. Null while the diagnosis was never promoted and
 * while the catalog has not been read: "not read yet" must not say the entry is retired. The catalog answers every
 * unretired entry, so an id it does not hold is a retired one.
 */
function promotedEntry(promotedTo: string | null, catalog: CerberusCatalogEntryView[] | null): PromotedEntry | null {
  if (promotedTo === null || catalog === null) return null;
  const entry = catalog.find((candidate) => candidate.id === promotedTo);
  return entry === undefined ? { retired: true, name: promotedTo } : { retired: false, name: entry.name, auto: entry.auto };
}

/** The pill: "Reading…" breathing in the info tone, "Ready 17:53:48" settled in neutral, "Failed" after a failed run's icon, in warn. */
function DiagnosisPill({ diagnosis, t }: { diagnosis: CerberusDiagnosisView; t: TFunction }) {
  if (diagnosis.status === 'running') {
    return (
      <Badge as="span" tone="info" className="whitespace-nowrap motion-safe:animate-[vv-pulse_1.6s_ease-in-out_infinite]">
        {t('cerberus.diagnosis.reading')}
      </Badge>
    );
  }
  if (diagnosis.status === 'failed') {
    return (
      <Badge as="span" tone={RUN_LOOK.failed.tone} className="gap-1.5 whitespace-nowrap motion-safe:animate-cerberus-check">
        <MarkIcon icon={RUN_LOOK.failed.icon} className="size-3.5" />
        <span>{t('cerberus.diagnosis.failed')}</span>
      </Badge>
    );
  }
  return (
    <Badge as="span" tone="neutral" className="whitespace-nowrap tabular-nums motion-safe:animate-cerberus-check">
      {t('cerberus.diagnosis.ready', { time: hms(diagnosis.endedAt ?? diagnosis.startedAt) })}
    </Badge>
  );
}

/** One step: ● breathing (info) on the current one, ✓ once a later one came, its text and time; memoised, so only an arriving step draws. */
const StepRow = memo(function StepRow({ step, current, startedAt }: { step: CerberusDiagnosisStep; current: boolean; startedAt: number }) {
  return (
    <li className="flex items-baseline gap-2.5 text-[13px] motion-safe:animate-cerberus-line">
      <span
        aria-hidden
        data-tone={current ? 'info' : undefined}
        className={cn('w-3 flex-none text-[11px]', current ? 'text-tone-ink motion-safe:animate-[vv-pulse_1.2s_ease-in-out_infinite]' : 'text-muted-foreground')}
      >
        {current ? '●' : '✓'}
      </span>
      <span className="min-w-0 flex-1 text-secondary-foreground [overflow-wrap:anywhere]">{step.text}</span>
      <span className="flex-none text-[11.5px] tabular-nums text-muted-foreground">{hms(startedAt + step.t * 1_000)}</span>
    </li>
  );
});

/** The one-off's line: running now; ran once, in its result's ink unless it succeeded; or refused, which never started. */
function RanLine({ run, t }: { run: CerberusRunView; t: TFunction }) {
  if (run.result === null) return <p className="text-[12.5px] text-muted-foreground">{t('cerberus.diagnosis.proposal.running')}</p>;
  const ok = run.result === 'ok';
  return (
    <p data-tone={ok ? undefined : RUN_LOOK[run.result].tone} className={cn('text-[12.5px]', ok ? 'text-muted-foreground' : 'text-tone-ink')}>
      {run.result === 'refused'
        ? t('cerberus.diagnosis.proposal.refused', { time: hms(run.endedAt ?? run.requestedAt) })
        : t('cerberus.diagnosis.proposal.ranOnce', {
          time: hms(run.startedAt ?? run.requestedAt),
          result: t(`cerberus.diagnosis.proposal.result.${RAN_RESULT[run.result]}`),
        })}
    </p>
  );
}

/** The card's shape, shimmering, while the diagnosis's first read is out: the eyebrow is known, so it is written. */
function ReadingDiagnosis({ eyebrowId, t }: { eyebrowId: string; t: TFunction }) {
  return (
    <section aria-labelledby={eyebrowId} aria-busy="true" className={FRAME}>
      <div className="flex items-center justify-between gap-2.5 border-b border-border px-3.5 py-3">
        <h4 id={eyebrowId} className={EYEBROW}>{t('cerberus.diagnosis.eyebrow')}</h4>
        <div className="vv-skeleton h-[22px] w-24 flex-none rounded-full" />
      </div>
      <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-3">
        <div className="vv-skeleton h-3 w-4/5" />
        {[0, 1, 2].map((row) => <div key={row} className="vv-skeleton h-3.5 w-2/3" />)}
      </div>
    </section>
  );
}

/** The card when the diagnosis's own read did not answer: its eyebrow, then the tab's one spelling of a read that failed. */
function UnreadDiagnosis({ eyebrowId, onRetry, t }: { eyebrowId: string; onRetry: () => void; t: TFunction }) {
  return (
    <section aria-labelledby={eyebrowId} className={FRAME}>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <h4 id={eyebrowId} className={EYEBROW}>{t('cerberus.diagnosis.eyebrow')}</h4>
        <UnreachableBanner onRetry={onRetry} />
      </div>
    </section>
  );
}

type DiagnosisPanelProps = {
  /** The diagnosis the sheet shows: the check's newest (`CerberusCheckDetail.diagnosis`), or the one a Needs-you card opened it on. */
  diagnosisId: string;
  /** Another run holds the check (a catalog fix's, not this diagnosis's one-off): Run it once waits, disabled, as `CheckFixes`' entries do. */
  held: boolean;
  /** Add to catalog, pressed: the root opens the Promote dialog on this diagnosis, in front of the sheet, as it does Mute. Absent, it is not offered: the sheet's host has no Promote dialog. */
  onPromote?: (diagnosis: CerberusDiagnosisView) => void;
};

/**
 * THE DIAGNOSIS, read-only (`design/cerberus/Cerberus Tab.dc.html` :447-487; the composition in full: MAN-7932), in
 * the check sheet between Fix output and "Fixes in the catalog": the pill ("Reading…" info, "Ready 17:53:48" neutral —
 * a document, not a health signal — "Failed" warn, with a failed run's icon) in the one polite region; the scope; the steps, folded into one
 * line once it is over so the answer stands near the top; the summary, the evidence and the Proposed fix box, with the
 * one-off's output straight under it, where "Running now — output below" points.
 *
 * For the check sheet (`CheckSheet`), which mounts it between Fix output and the catalog's fixes, keyed by the diagnosis.
 */
export function DiagnosisPanel({ diagnosisId, held, onPromote }: DiagnosisPanelProps) {
  const { t } = useTranslation();
  const eyebrowId = useId();
  const { catalog, runProposal } = useCerberus();
  // The diagnosis as center answers it, with every step: the read's own, then each `cerberus_diag_step` frame as it lands.
  const { diagnosis, failed, refresh } = useDiagnosis(diagnosisId);
  const promoted = promotedEntry(diagnosis?.promotedTo ?? null, catalog);
  const steps = diagnosis?.steps ?? [];
  // Whether Run it once's press is out. Essential: `runProposal` answers once the warden has accepted the run, and the
  // button reads "Running…" for that wait — and for the diagnosis's own re-read after it, since a button that came back
  // before the run showed under the box would take a second press, which center refuses.
  const [starting, setStarting] = useState(false);
  const runOnce = async () => {
    if (diagnosis === null) return;
    setStarting(true);
    await runProposal(diagnosis.id);
    await refresh();
    setStarting(false);
  };
  // Add to catalog goes up to the root's Promote dialog, in front of the sheet.
  const promote = () => {
    if (diagnosis !== null) onPromote?.(diagnosis);
  };
  const oneOffLive = useStillAhead(diagnosis?.oneOffExpiresAt ?? null);
  // Whether the steps show once it is over: the person's press on their one line. While it runs they always show.
  const [stepsOpen, setStepsOpen] = useState(false);

  if (diagnosis === null) {
    return failed ? <UnreadDiagnosis eyebrowId={eyebrowId} onRetry={() => void refresh()} t={t} /> : <ReadingDiagnosis eyebrowId={eyebrowId} t={t} />;
  }
  const running = diagnosis.status === 'running';
  const proposal = diagnosis.status === 'done' ? diagnosis.proposal : null;
  const offerRun = proposal !== null && diagnosis.run === null && oneOffLive;
  const offerPromote = proposal !== null && diagnosis.promotedTo === null && onPromote !== undefined;
  // Never run, and its one-off ran out or never reached the warden: the box says why Run it once is gone.
  const oneOffGone = proposal !== null && diagnosis.run === null && !oneOffLive;
  // What the buttons on screen mean: both, Add to catalog alone, or nothing once only Run it once is left.
  const note = offerRun && offerPromote ? 'cerberus.diagnosis.proposal.note' : offerPromote ? 'cerberus.diagnosis.proposal.noteAdd' : null;
  const first = steps[0];
  const last = steps[steps.length - 1];

  return (
    <section aria-labelledby={eyebrowId} className={cn(FRAME, 'motion-safe:animate-[vv-pop_.5s_theme(transitionTimingFunction.enter)_both]')}>
      <div className="flex items-center justify-between gap-2.5 border-b border-border px-3.5 py-3">
        <h4 id={eyebrowId} className={EYEBROW}>{t('cerberus.diagnosis.eyebrow')}</h4>
        <div role="status">
          {/* Keyed by where it stands, so the pill an ended diagnosis lands on springs in, once. */}
          <DiagnosisPill key={diagnosis.status} diagnosis={diagnosis} t={t} />
        </div>
      </div>

      <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-3">
        {/* A diagnosis that was not given the node's reads says so: its answer rests on Cerberus's record alone. */}
        <p className="text-[12.5px] text-muted-foreground">
          {diagnosis.scope === 'history'
            ? t('cerberus.diagnosis.scopeHistory', { node: diagnosis.node })
            : t('cerberus.diagnosis.scope', { node: diagnosis.node })}
        </p>

        {first !== undefined && last !== undefined && (
          // Open while it runs; once over, the one line opens it. `CardFoldBody` takes a folded trail out of the tab order and the accessibility tree.
          <Collapsible open={running || stepsOpen} onOpenChange={setStepsOpen}>
            {!running && (
              <CollapsibleTrigger className="flex items-center gap-1.5 text-left text-[12.5px] text-muted-foreground hover:text-foreground finger:min-h-11">
                <FoldChevron collapsed={!stepsOpen} />
                {t('cerberus.diagnosis.steps', {
                  count: steps.length,
                  from: hms(diagnosis.startedAt + first.t * 1_000),
                  to: hms(diagnosis.startedAt + last.t * 1_000),
                })}
              </CollapsibleTrigger>
            )}
            <CardFoldBody>
              <div role="log" aria-labelledby={eyebrowId}>
                <ol className={cn('flex flex-col gap-1', !running && 'pt-2')}>
                  {steps.map((step, index) => (
                    <StepRow key={step.n} step={step} current={running && index === steps.length - 1} startedAt={diagnosis.startedAt} />
                  ))}
                </ol>
              </div>
            </CardFoldBody>
          </Collapsible>
        )}

        {diagnosis.status === 'done' && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3 motion-safe:animate-shape-rise">
            {diagnosis.summary !== null && (
              <p className="font-serif text-xl leading-[1.3] text-foreground [overflow-wrap:anywhere] [text-wrap:pretty]">{diagnosis.summary}</p>
            )}
            {diagnosis.evidence.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {diagnosis.evidence.map((line, index) => (
                  // A piece of evidence is the data's own line, and the list never changes once the diagnosis is done.
                  <li key={index} className="flex gap-1.5 text-[13px] text-muted-foreground">
                    <span aria-hidden className="flex-none">↳</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {diagnosis.status === 'failed' && diagnosis.error !== null && (
          <p data-tone={RUN_LOOK.failed.tone} className="border-t border-border pt-3 text-[13px] text-tone-ink [overflow-wrap:anywhere] motion-safe:animate-shape-rise">
            {diagnosis.error}
          </p>
        )}

        {proposal !== null && (
          <div
            className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-background p-3.5 motion-safe:animate-[vv-pop_.55s_theme(transitionTimingFunction.enter)_both]"
            style={PROPOSAL_ENTER}
          >
            <h5 className={EYEBROW}>{t('cerberus.diagnosis.proposal.title')}</h5>
            <div className="flex flex-col gap-1">
              <p className="text-[14.5px] font-medium [overflow-wrap:anywhere]">{proposal.name}</p>
              <p className="font-mono text-[11.5px] text-secondary-foreground [overflow-wrap:anywhere]">{t('cerberus.fix.command', { cmd: proposal.cmd })}</p>
            </div>
            {(offerRun || offerPromote) && (
              <div className="flex flex-wrap items-center gap-2">
                {offerRun && (
                  // Press out: busy, as `disabled` would drop the pressing hand's focus. Held: disabled, as `CheckFixes` holds its entries.
                  <Button
                    size="sm"
                    disabled={held && !starting}
                    busy={starting}
                    className="min-w-28 finger:h-11"
                    onClick={() => void runOnce()}
                  >
                    {starting ? t('cerberus.catalog.running') : t('cerberus.diagnosis.proposal.runOnce')}
                  </Button>
                )}
                {offerPromote && (
                  <Button variant="tonal" size="sm" className="finger:h-11" onClick={promote}>
                    {t('cerberus.diagnosis.proposal.addToCatalog')}
                  </Button>
                )}
              </div>
            )}
            {diagnosis.run !== null && <RanLine run={diagnosis.run} t={t} />}
            {oneOffGone && (
              <p className="text-[12.5px] text-muted-foreground">
                {diagnosis.oneOffExpiresAt === null
                  ? t('cerberus.diagnosis.proposal.unpublished', { node: diagnosis.node })
                  : t('cerberus.diagnosis.proposal.expired', { time: hms(diagnosis.oneOffExpiresAt) })}
              </p>
            )}
            {/* A retired entry is no longer in the catalog: said plainly, muted, never the positive ✓. */}
            {promoted !== null && (promoted.retired ? (
              <p className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{t('cerberus.diagnosis.proposal.promotedRetired', { name: promoted.name })}</p>
            ) : (
              <p data-tone="positive" className="text-[12.5px] text-tone-ink [overflow-wrap:anywhere]">
                <span aria-hidden>✓ </span>
                {t(promoted.auto ? 'cerberus.diagnosis.proposal.promotedOn' : 'cerberus.diagnosis.proposal.promotedOff', { name: promoted.name })}
              </p>
            ))}
            {note !== null && <p className="text-xs text-muted-foreground">{t(note)}</p>}
          </div>
        )}
        {/* Keyed by the run, so another run's output starts blank and replays as its own. */}
        {proposal !== null && diagnosis.run !== null && <FixOutput key={diagnosis.run.id} runId={diagnosis.run.id} />}

        {diagnosis.status === 'done' && proposal === null && (
          <p className="text-[12.5px] text-muted-foreground">{t('cerberus.diagnosis.proposal.none')}</p>
        )}
      </div>
    </section>
  );
}
