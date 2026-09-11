import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/modules/plan-runner/hooks/useElapsed';
import { useRunnerVerbs } from '@/modules/plan-runner/hooks/useRunnerVerbs';
import { PhaseRow } from '@/modules/plan-runner/PhaseRow';
import { PipelineStrip } from '@/modules/plan-runner/PipelineStrip';
import {
  PHASE_GLYPH,
  phaseProgress,
  pipelineForRun,
  runOutcomeTone,
  runOutcomeWord,
  runStateTone,
  runUnfinished,
  seenStages,
} from '@/modules/plan-runner/runState';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Meter,
} from '@/shared/ui';
import type { RunnerRunSnapshot } from '@/shared/types';

/** The last path segment of the plan the run walks — `cloudcli-docspace-embed.plan.md` — or the whole string when it has no slash. */
function planFileName(planPath: string): string {
  const cut = planPath.lastIndexOf('/');
  return cut === -1 ? planPath : planPath.slice(cut + 1);
}

/**
 * One plan-runner run, whole: what it is, how far it has got, where it is standing, and the one
 * verb that applies to it.
 *
 * IT COMPOSES AND DOES NOT DRAW. The bar is `Meter`, the state word is `Badge`, the stages are
 * `Chip` + `Shimmer`, the two disclosures are `Collapsible` (design doctrine :85 — screens pull
 * the library together; they do not declare or style). Nothing here spells a colour: tone travels
 * as `tone=` and reaches the paint through the token blocks, which is why a sixth state would be
 * a token block rather than an edit in this file.
 *
 * EVERY STRING REACHES THE DOM AS A TEXT NODE. A plan title, a phase title, a stage word and the
 * runner's own stderr are all free text written by a program this app does not control, so none
 * of it is ever handed to a raw-HTML sink or run through a markdown renderer.
 *
 * THE FOOTER OFFERS THE VERBS THAT APPLY, chosen by state rather than by all being present and
 * some disabled. Only a LIVE run can be stopped: `plan-runner stop` looks for a lock naming the run
 * and refuses without one, so a stale run — whose daemon is gone — has literally nothing to stop,
 * and offering the button would be inviting a refusal. A parked or dead run offers Resume, the verb
 * that actually continues it. An ENDED run offers Dismiss — the operator asked to see a run finish
 * and clear it themselves (2026-09-09) — and Resume too whenever a phase is still blocked or
 * pending, read off the PHASES and never off the receipt's word: the runner's `complete` means
 * something shipped, not that nothing is left (`runUnfinished`). Dismiss is rendered only
 * when the caller passes `onDismiss`: the card does not know the lane, and the panel does.
 *
 * AN ENDED CARD SHOWS ITS OUTCOME where a moving run shows its state: the runner's own word for the
 * ending, in the outcome's tone, with how long ago it ended in place of how long it has run. The
 * strip lights no active stage — nothing is in flight — and keeps every stage the run walked.
 *
 * `data-runner-card`, `data-run-id` and `data-run-state` are the browser harness's handles, and
 * they are on the ROOT so a probe can scope every reading to one run — the operator's own runs are
 * on screen at the same time and must never be acted on. `phase-25.mjs` asserts their ABSENCE from
 * the chat view; the Runner tab's probe is what reads them on a card.
 */
export function RunCard({
  run,
  defaultOpen,
  onDismiss,
}: {
  run: RunnerRunSnapshot;
  defaultOpen: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const { stop, resume, busy } = useRunnerVerbs(run.run_id);
  const ended = run.state === 'ended';
  // One clock either way: since the run started while it moves, since it ended once it has.
  // One clock either way; an ended run's age is re-read once a minute, a moving run's every second.
  const runElapsed = useElapsed(ended ? run.ended_at : run.started_at, ended ? 60_000 : 1_000);
  const outcomeWord = ended ? runOutcomeWord(run) : '';
  const unfinished = ended && runUnfinished(run);

  const progress = phaseProgress(run);
  const anyBlocked = run.phases.some((phase) => phase.state === 'blocked');
  const currentPhaseId = run.position?.phase_id ?? null;
  // The PLAN's spend leads once it has run more than once: a restart opens a new run at 0, and
  // the run's own counters alone read as a reset (operator, 2026-09-11). This run's share follows
  // beside its ceiling, because the ceiling is per run.
  const spend = run.plan_runs > 1
    ? `${t('runner.planSpend', { spawns: run.plan_spawns, cost: run.plan_cost_usd.toFixed(2), count: run.plan_runs })} · ${t('runner.thisRun', { used: run.spawns, max: run.max_spawns })}`
    : `${t('runner.spawns', { used: run.spawns, max: run.max_spawns })} · $${run.cost_usd.toFixed(2)}`;

  return (
    <Card
      className="w-full min-w-0"
      data-runner-card
      data-run-id={run.run_id}
      data-run-state={run.state}
      data-run-outcome={ended ? outcomeWord : undefined}
    >
      <CardHeader className="gap-2 p-3 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* The PLAN FILE is the name (operator, 2026-09-10): it is what `/execute` was given, what
              `plan-runner status` prints and what the ship logs are filed under, so it is the one
              name every surface shares. The plan's own H1 sits beneath it as the description. */}
          <CardTitle className="w-full min-w-0 break-words font-mono text-sm leading-snug">
            {planFileName(run.plan_path)}
          </CardTitle>
          {run.plan_title && (
            // Three lines at most: a plan H1 on this host runs to 370 characters, and the file name above is the
            // title that must always read whole. The clamp clips the box only — the whole text stays in the
            // DOM and the accessibility tree.
            <p className="line-clamp-3 w-full min-w-0 break-words text-xs leading-snug text-muted-foreground">
              {run.plan_title}
            </p>
          )}
          {ended ? (
            // The runner's word, uppercased as a last resort when it is one this app has no string for.
            <Badge tone={runOutcomeTone(run)}>
              {t(`runner.outcome.${outcomeWord}`, { defaultValue: outcomeWord.toUpperCase() })}
            </Badge>
          ) : (
            <Badge tone={runStateTone(run.state)}>{t(`runner.state.${run.state}`)}</Badge>
          )}
          {runElapsed && (
            <span className="flex-none font-mono text-xs text-muted-foreground">
              {ended ? t('runner.ended', { elapsed: runElapsed }) : runElapsed}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-3 p-3 pt-0">
        <Meter
          percent={progress.percent}
          tone={anyBlocked ? 'warn' : 'accent'}
          label={t('runner.phases')}
          value={`${progress.shipped} / ${progress.total}`}
          sub={spend}
        />

        <PipelineStrip
          stages={pipelineForRun(run)}
          active={ended ? '' : (run.position?.stage ?? '')}
          detail={ended ? '' : (run.position?.stage_detail ?? '')}
          seen={seenStages(run)}
        />

        <Collapsible defaultOpen={defaultOpen} className="min-w-0">
          {/* The blocked mark lives OUT here, beside the count, not only on the phase row inside.
              A caller may pass `defaultOpen={false}`, and a reader of a folded card would then meet
              "a phase is blocked" as the meter's amber and nothing else — colour alone, which
              design doctrine :147-149 forbids. The glyph and the word travel with it. */}
          <div className="flex min-w-0 items-center gap-2">
            <CollapsibleTrigger className="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
              {t('runner.phaseCount', { count: run.phases.length })}
            </CollapsibleTrigger>
            {anyBlocked && <Badge tone="warn">{`${PHASE_GLYPH.blocked} ${t('runner.phase.blocked')}`}</Badge>}
          </div>
          <CollapsibleContent className="min-w-0">
            {run.phases.map((phase) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                // Filtered here rather than inside the row: the log is one list for the whole run,
                // and every row scanning all 200 entries would be five passes for one answer.
                timeline={run.timeline.filter((entry) => entry.phase_id === phase.id)}
                // An ended run has no phase in flight, whatever `position` still says: no row ticks.
                isCurrent={!ended && phase.id === currentPhaseId}
                stageSince={ended ? null : (run.position?.stage_since ?? null)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      <CardFooter className="gap-2 p-3 pt-0">
        {ended ? (
          <>
            {unfinished && (
              <Button size="sm" disabled={busy !== null} onClick={() => void resume()}>
                {t('runner.resume')}
              </Button>
            )}
            {onDismiss && (
              <Button variant="secondary" size="sm" onClick={onDismiss} data-runner-dismiss>
                {t('runner.dismiss')}
              </Button>
            )}
          </>
        ) : run.state === 'live' ? (
          <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void stop()}>
            {t('runner.stop')}
          </Button>
        ) : (
          <Button size="sm" disabled={busy !== null} onClick={() => void resume()}>
            {t('runner.resume')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
