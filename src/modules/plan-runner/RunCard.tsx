import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
import { useRateChangeTick } from '@/shared/hooks/useRateChangeTick';
import { useRunnerVerbs } from '@/modules/plan-runner/hooks/useRunnerVerbs';
import { PhaseRow } from '@/modules/plan-runner/PhaseRow';
import { PipelineStrip } from '@/modules/plan-runner/PipelineStrip';
import { RepairBanner } from '@/modules/plan-runner/RepairBanner';
import { RunModelControl } from '@/modules/plan-runner/RunModelControl';
import { ScheduleControl } from '@/modules/plan-runner/ScheduleControl';
import {
  PHASE_GLYPH,
  phaseProgress,
  phaseStateTone,
  pipelineForRun,
  runLanes,
  runOutcomeTone,
  runOutcomeWord,
  runStateTone,
  runUnfinished,
  scheduleClock,
  seenStages,
  waveCompanions,
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
import { effectiveModelWord } from '@/shared/utils';

/** The last path segment of the plan the run walks — `cloudcli-docspace-embed.plan.md` — or the whole string when it has no slash. */
function planFileName(planPath: string): string {
  const cut = planPath.lastIndexOf('/');
  return cut === -1 ? planPath : planPath.slice(cut + 1);
}

/**
 * Where a QUEUED run is waiting until, in the reader's own clock: `10:00 AM`.
 *
 * The runner stores the epoch and prints its own UTC rendering for `/execute`'s line; here the
 * reader is a person looking at their own watch, and a window stated in UTC on a card in a
 * different zone is a time they have to convert. Nothing is invented when the runner named no
 * window: that case is the caller's other string.
 */
function queuedClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
 * that actually continues it. A QUEUED run offers Start, which is that same `resume` (`start` is
 * what created it parked; the runner's resume is the walk). An ENDED run offers Dismiss — the
 * operator asked to see a run finish and clear it themselves (2026-09-09) — and Resume too whenever
 * a phase is still blocked or pending, read off the PHASES and never off the receipt's word: the
 * runner's `complete` means something shipped, not that nothing is left (`runUnfinished`). Dismiss
 * is rendered only when the caller passes `onDismiss`: the card does not know the lane, and the
 * panel does.
 *
 * A FIX-IT SESSION IS SAID ABOVE EVERYTHING ELSE. When the runner sends an unblock at a blocked
 * phase, `RepairBanner` leads the card — repairing, then finished — so a blocked run that is being
 * worked on never reads the same as one nobody is touching.
 *
 * AN ENDED CARD SHOWS ITS OUTCOME where a moving run shows its state: the runner's own word for the
 * ending, in the outcome's tone, with how long ago it ended in place of how long it has run. The
 * strip lights no active stage — nothing is in flight — and keeps every stage the run walked.
 *
 * A QUEUED CARD SHOWS WHERE IT IS WAITING: the runner parked it before it ever walked (`start
 * --queue`, or DeepSeek's peak hours with the switch on), so the badge is QUEUED, the header's
 * clock is the time the window ends rather than an age, the strip lights nothing, and the footer's
 * one verb is Start — beside it `Start at …` (`ScheduleControl`), the same press made ahead of time,
 * and once scheduled the note leads with `starts <time>` and the button reads Cancel.
 *
 * A SWARMED CARD SHOWS ITS LANES: with the switch on the run walks several phases at once, and the
 * strip and the ◆ position can name only one of them, so EVERY live lane gets a row beneath the
 * strip naming its phase and its stage — the one the strip already follows included, since a lane
 * row is about the lane and not about what the strip picked. The block appears once the run carries
 * a second lane and not before (one lane says nothing the strip does not), it leads with the swarm
 * mark and the lane count so a swarming run is told apart at a glance, and it displaces nothing: the
 * phase list below still holds every phase of the run exactly as it did.
 *
 * `data-runner-card`, `data-run-id` and `data-run-state` are the browser harness's handles, and
 * they are on the ROOT so a probe can scope every reading to one run — the operator's own runs are
 * on screen at the same time and must never be acted on. `phase-25.mjs` asserts their ABSENCE from
 * the chat view; the Runner tab's probe is what reads them on a card. `data-runner-swarm` is the
 * same kind of handle on the lanes block's own header, where the swarm mark and its count are.
 */
/** Byte-for-byte `hooks/plan_runner/costs.py`'s `humanize`: "94.9M", "1M", "12.5k". */
function humanizeTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 999_950) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;   // the same cut
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

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
  const ended = run.state === 'ended';
  // A QUEUED run is nothing moving and nothing elapsed: it has an epoch it waits FOR, and the one
  // clock on this card would otherwise count up from a start that never happened.
  const queued = run.state === 'queued';
  // The resume verb's WORD travels into the hook: pressing Start and being answered under the
  // header "Resume" is the runner's own rule in this app's other name for it.
  const { stop, resume, setModel, schedule, busy } = useRunnerVerbs(run.run_id,
    queued ? t('runner.start') : t('runner.resume'));
  // One clock either way: since the run started while it moves, since it ended once it has.
  // A queued run's card holds no elapsed clock at all (`sinceEpochSeconds` `null` buys none), which
  // is why it passes null rather than an interval it would never read.
  const runElapsed = useElapsed(queued ? null : ended ? run.ended_at : run.started_at,
    ended ? 60_000 : 1_000);
  // The window the park waits for is the RUNNER's epoch, and it must close on the card without a
  // reload: the DeepSeek boundary clock (one timer, armed at the next boundary rather than ticking)
  // is that re-render, and it is the same rule the epoch was computed from.
  const peaked = useRateChangeTick();
  const windowClosed = queued && run.queued_until !== null && run.queued_until * 1000 <= peaked;
  const outcomeWord = ended ? runOutcomeWord(run) : '';
  const unfinished = ended && runUnfinished(run);
  // The operator's scheduled Start (`?? null` for a frame from an older server): it LEADS the note, and the
  // DeepSeek-peak sentence stays beside it when both apply; "not started" is dropped — a time says more.
  const startAt = run.start_at ?? null;
  let queuedNote = '';
  if (queued) {
    // PAST the window the note changes TENSE: the run is no longer waiting for anything, and the
    // present tense would be the one false thing on this card at the moment Start is decided.
    let peakNote = '';
    if (run.queued_until === null) peakNote = startAt === null ? t('runner.queuedManual') : '';
    else if (windowClosed) peakNote = t('runner.queuedWindowClosed', { time: queuedClock(run.queued_until) });
    else peakNote = t('runner.queuedUntil', { time: queuedClock(run.queued_until) });
    const starts = startAt === null ? '' : t('runner.schedule.starts', { time: scheduleClock(startAt) });
    queuedNote = [starts, peakNote].filter(Boolean).join(' · ');
  }

  const progress = phaseProgress(run);
  // No lane table on a serial run — which is every run until the switch is on; `runLanes` says `[]`.
  const lanes = runLanes(run);
  const alongside = waveCompanions(run);   // the plan's shared waves, whatever the switch reads
  const anyBlocked = run.phases.some((phase) => phase.state === 'blocked');
  const currentPhaseId = run.position?.phase_id ?? null;
  // The PLAN's spend leads once it has run more than once: a restart opens a new run at 0, and
  // the run's own counters alone read as a reset (operator, 2026-09-11). This run's share follows
  // beside its ceiling, because the ceiling is per run.
  // The PLAN's whole bill leads once anything outside this run was spent on it — the planner,
  // the review, a scout wave, an earlier run (operator, 2026-09-12: "I'd like to see totals").
  const outside = run.plan_planning_usd + run.plan_review_usd + run.plan_scouts_usd;
  // Tokens in the same unit and shape `hooks/plan_runner/costs.py` prints ("⛁ 94.9M tok"): every
  // token billed on the plan, all kinds.
  const tokens = run.plan_tokens > 0 ? ` · ${t('runner.tokens', { n: humanizeTokens(run.plan_tokens) })}` : '';
  const spend = (run.plan_runs > 1 || outside > 0
    ? `${t('runner.planTotal', { total: run.plan_total_usd.toFixed(2) })} · ${t('runner.planSplit', {
        planning: run.plan_planning_usd.toFixed(2), review: run.plan_review_usd.toFixed(2),
        scouts: run.plan_scouts_usd.toFixed(2), build: run.plan_cost_usd.toFixed(2), count: run.plan_runs })} · ${t('runner.thisRun', { used: run.spawns, max: run.max_spawns })}`
    : `${t('runner.spawns', { used: run.spawns, max: run.max_spawns })} · $${run.cost_usd.toFixed(2)}`) + tokens;

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
          {queued ? (
            // WHERE a moving run shows how long it has been going, a queued run shows WHEN it was
            // waiting for: nothing is elapsing, and the reason it is standing still is the window.
            <span className="flex-none font-mono text-xs text-muted-foreground">{queuedNote}</span>
          ) : runElapsed && (
            <span className="flex-none font-mono text-xs text-muted-foreground">
              {ended ? t('runner.ended', { elapsed: runElapsed }) : runElapsed}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-3 p-3 pt-0">
        {run.repair && <RepairBanner repair={run.repair} runLive={run.state === 'live'} />}
        <Meter
          percent={progress.percent}
          tone={anyBlocked ? 'warn' : 'accent'}
          label={t('runner.phases')}
          value={`${progress.shipped} / ${progress.total}`}
          sub={spend}
        />

        <PipelineStrip
          stages={pipelineForRun(run)}
          // An ended run and a QUEUED one both have nothing in flight: no stage lights, and no
          // clock ticks — the strip shows what the run walked and nothing more.
          active={ended || queued ? '' : (run.position?.stage ?? '')}
          detail={ended || queued ? '' : (run.position?.stage_detail ?? '')}
          seen={seenStages(run)}
        />

        {/* ONE ROW PER LANE, and only once a run walks MORE THAN ONE: with a single lane the strip
            above already says the same thing. The row speaks the card's own vocabulary — the
            running mark, the tone `phaseStateTone` gives a running phase, the runner's stage word.
            Keyed by its LANE ID, never by index: an index key would slide every row under a
            finished lane onto its neighbour's mark and stage.
            THE SWARM MARK LEADS THE BLOCK — the same `Network` glyph the settings row beside the
            switch wears — because the row of lanes alone reads as "this run has several phases"; the
            mark and its count are what say the run is walking them TOGETHER, at a glance, which is
            the one fact about a run this card could not show before. */}
        {lanes.length > 1 && (
          <div
            className="flex min-w-0 flex-col gap-0.5"
            role="group"
            aria-label={t('runner.phases')}
            data-runner-lanes
          >
            <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground" data-runner-swarm>
              <Network className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>{t('runner.lanesAtOnce', { count: lanes.length })}</span>
            </div>
            {lanes.map((lane) => (
              <div
                key={lane.lane}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs"
                data-runner-lane={lane.lane}
              >
                <span className="flex-none font-mono text-xs" aria-hidden="true">{PHASE_GLYPH.running}</span>
                <span className="flex-none font-mono text-xs text-muted-foreground">{lane.rank}</span>
                {/* The runner may not have composed a title yet; the id is the name of record then. */}
                <span className="min-w-0 flex-1 basis-40 break-words text-sm leading-snug">
                  {lane.title || lane.phase_id}
                </span>
                {lane.stage && (
                  <Badge tone={phaseStateTone('running')} className="min-w-0 break-words">
                    {lane.stage_detail ? `${lane.stage} · ${lane.stage_detail}` : lane.stage}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}

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
                // An ended or QUEUED run has no phase in flight, whatever `position` still says: no
                // row ticks. A queued run's position points at the phase it WOULD start with.
                isCurrent={!ended && !queued && phase.id === currentPhaseId}
                stageSince={ended || queued ? null : (run.position?.stage_since ?? null)}
                alongside={alongside.get(phase.id)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      <CardFooter className="flex-wrap gap-2 p-3 pt-0">
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
        ) : queued ? (
          // Start IS `resume`: the runner's `resume` re-opens the ledger and walks the run at its
          // stage, and a queued run has no stage yet — it begins where a fresh run does.
          // Beside it, the same Start made ahead of time: the watchdog presses it at the scheduled moment.
          <>
            <Button size="sm" disabled={busy !== null} onClick={() => void resume()} data-runner-start>
              {t('runner.start')}
            </Button>
            <ScheduleControl scope="run" startAt={startAt} busy={busy !== null}
              onSchedule={(when) => void schedule(when)} />
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
        {/* The run's own DeepSeek / Claude word, on every run a press could still move: a finished
            run has no next phase for the word to reach. A record with no word — or a frame from an older server — reads DeepSeek. */}
        {(!ended || unfinished) && (
          <div className="ml-auto">
            <RunModelControl scope="run" value={effectiveModelWord(run.model)} busy={busy !== null}
              onChoose={(choice) => void setModel(choice)} />
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
