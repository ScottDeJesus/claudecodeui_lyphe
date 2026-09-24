import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
import { useRateChangeTick } from '@/shared/hooks/useRateChangeTick';
import { PhaseRow } from '@/modules/plan-runner/PhaseRow';
import { PipelineStrip } from '@/modules/plan-runner/PipelineStrip';
import { RepairBanner } from '@/modules/plan-runner/RepairBanner';
import {
  PHASE_GLYPH,
  phaseProgress,
  phaseStateTone,
  pipelineForRun,
  runLanes,
  runOutcomeTone,
  runOutcomeWord,
  runStateTone,
  scheduleClock,
  seenStages,
  waveCompanions,
} from '@/modules/plan-runner/runState';
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Meter,
} from '@/shared/ui';
import type { RunnerRunSnapshot } from '@/shared/types';

/**
 * A run as a card draws it, in pieces that carry no frame of their own: its word, its clock, and
 * how far it has got. What moves it is next door (`RunControls.tsx`).
 *
 * WHY THE PIECES ARE APART FROM `RunCard`. A run has TWO frames — the card in a run list
 * (`RunCard`, with the plan's file name over it) and the plan card of an arc deck (`ArcCard`,
 * where the card is already the plan's name and its title) — and both must show one run one way.
 * Composing each from its own copy of the meter, the strip and the clock is how the same run
 * ends up reading differently on two screens; these pieces are that display, in one place, and a
 * frame only decides whether the plan's own name leads above them and how wide they are drawn.
 *
 * EVERY STRING REACHES THE DOM AS A TEXT NODE. A plan title, a phase title, a stage word and the
 * runner's own stderr are all free text written by a program this app does not control, so none
 * of it is ever handed to a raw-HTML sink or run through a markdown renderer.
 */

/** Byte-for-byte `hooks/plan_runner/costs.py`'s `humanize`: "94.9M", "1M", "12.5k". */
function humanizeTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 999_950) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;   // the same cut
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
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
 * The one word a run wears: its STATE while it moves, and — once it has ended — its OUTCOME, since
 * the runner's word for the ending is what a reader came to the card for. Both tones are
 * `runStateTone`'s and `runOutcomeTone`'s, so no colour is spelled here.
 *
 * A queued run reads QUEUED rather than paused: the runner parked it before it ever walked, and
 * the badge is where that is said.
 *
 * Used by `RunCard`'s header (beside the plan's file name) and by `ArcCard`, which draws it at the
 * head of the run its plan card owns.
 */
export function RunStateBadge({ run }: { run: RunnerRunSnapshot }) {
  const { t } = useTranslation();
  if (run.state === 'ended') {
    // The runner's word, uppercased as a last resort when it is one this app has no string for.
    const outcome = runOutcomeWord(run);
    return (
      <Badge tone={runOutcomeTone(run)}>
        {t(`runner.outcome.${outcome}`, { defaultValue: outcome.toUpperCase() })}
      </Badge>
    );
  }
  return <Badge tone={runStateTone(run.state)}>{t(`runner.state.${run.state}`)}</Badge>;
}

/**
 * The run's own clock, and the only one on a card: how long it has been going while it moves, how
 * long ago it ended once it has, and — for a QUEUED run, which is nothing moving and nothing
 * elapsed — WHERE it is waiting instead, off `queued_until` and the operator's scheduled Start.
 *
 * PAST THE WINDOW THE NOTE CHANGES TENSE: the run is no longer waiting for anything, and the
 * present tense would be the one false thing on the card at the moment Start is decided. It must
 * also close on the card without a reload, so the DeepSeek boundary clock is what re-renders it —
 * the same rule the epoch was computed from.
 *
 * "not started" is dropped once a scheduled moment is known: a time says more.
 *
 * Used by `RunCard`'s header and by `ArcCard`, at the head of the run its plan card owns.
 */
export function RunClock({ run }: { run: RunnerRunSnapshot }) {
  const { t } = useTranslation();
  const ended = run.state === 'ended';
  const queued = run.state === 'queued';
  // One clock either way: since the run started while it moves, since it ended once it has.
  // A queued run's card holds no elapsed clock at all (`sinceEpochSeconds` `null` buys none).
  const elapsed = useElapsed(queued ? null : ended ? run.ended_at : run.started_at, ended ? 60_000 : 1_000);
  const peaked = useRateChangeTick();
  const startAt = run.start_at ?? null;   // `?? null`: a frame from a server older than the field

  let note = '';
  if (queued) {
    const windowClosed = run.queued_until !== null && run.queued_until * 1000 <= peaked;
    let peakNote: string;
    if (run.queued_until === null) peakNote = startAt === null ? t('runner.queuedManual') : '';
    else if (windowClosed) peakNote = t('runner.queuedWindowClosed', { time: queuedClock(run.queued_until) });
    else peakNote = t('runner.queuedUntil', { time: queuedClock(run.queued_until) });
    const starts = startAt === null ? '' : t('runner.schedule.starts', { time: scheduleClock(startAt) });
    note = [starts, peakNote].filter(Boolean).join(' · ');
  } else if (elapsed) {
    note = ended ? t('runner.ended', { elapsed }) : elapsed;
  }

  if (note === '') return null;
  return <span className="flex-none font-mono text-xs text-muted-foreground">{note}</span>;
}

type RunFaceProps = {
  run: RunnerRunSnapshot;
  /** Whether the phase rows start unfolded — the run list's one variance (`RunCard`'s `defaultOpen`). */
  defaultOpen: boolean;
};

/**
 * Everything between a run's word and its verbs: the repair strip, how far the run has got, the
 * stages it is walking, its lanes, and the phases themselves.
 *
 * A FIX-IT SESSION IS SAID ABOVE EVERYTHING ELSE. When the runner sends an unblock at a blocked
 * phase, `RepairBanner` leads the block — repairing, then finished — so a blocked run that is
 * being worked on never reads the same as one nobody is touching.
 *
 * THE PLAN'S SPEND LEADS ONCE IT HAS RUN MORE THAN ONCE: a restart opens a new run at 0, and the
 * run's own counters alone read as a reset (operator, 2026-09-11). The plan's whole bill leads
 * once anything outside this run was spent on it — the planner, the review, a scout wave, an
 * earlier run (operator, 2026-09-12: "I'd like to see totals"). This run's share follows beside
 * its ceiling, because the ceiling is per run; the tokens are the plan's, in the unit and shape
 * `hooks/plan_runner/costs.py` prints.
 *
 * A SWARMED RUN SHOWS ITS LANES: with the switch on the run walks several phases at once, and the
 * strip and the ◆ position can name only one of them, so EVERY live lane gets a row beneath the
 * strip naming its phase and its stage — the one the strip already follows included, since a lane
 * row is about the lane and not about what the strip picked. The block appears once the run
 * carries a second lane and not before (one lane says nothing the strip does not) and it displaces
 * nothing.
 *
 * AN ENDED RUN LIGHTS NO STAGE and a QUEUED one has no stage yet: the strip shows what the run
 * walked and nothing more, and no row ticks — a queued run's position points at the phase it WOULD
 * start with.
 *
 * Used by `RunCard` (inside its card's body) and by `ArcCard`, for the run a plan card owns.
 */
export function RunFace({ run, defaultOpen }: RunFaceProps) {
  const { t } = useTranslation();
  const ended = run.state === 'ended';
  const queued = run.state === 'queued';
  const inert = ended || queued;
  const progress = phaseProgress(run);
  // No lane table on a serial run — which is every run until the switch is on; `runLanes` says `[]`.
  const lanes = runLanes(run);
  const alongside = waveCompanions(run);   // the plan's shared waves, whatever the switch reads
  const anyBlocked = run.phases.some((phase) => phase.state === 'blocked');
  const currentPhaseId = run.position?.phase_id ?? null;
  const outside = run.plan_planning_usd + run.plan_review_usd + run.plan_scouts_usd;
  const tokens = run.plan_tokens > 0 ? ` · ${t('runner.tokens', { n: humanizeTokens(run.plan_tokens) })}` : '';
  const spend = (run.plan_runs > 1 || outside > 0
    ? `${t('runner.planTotal', { total: run.plan_total_usd.toFixed(2) })} · ${t('runner.planSplit', {
        planning: run.plan_planning_usd.toFixed(2), review: run.plan_review_usd.toFixed(2),
        scouts: run.plan_scouts_usd.toFixed(2), build: run.plan_cost_usd.toFixed(2), count: run.plan_runs })} · ${t('runner.thisRun', { used: run.spawns, max: run.max_spawns })}`
    : `${t('runner.spawns', { used: run.spawns, max: run.max_spawns })} · $${run.cost_usd.toFixed(2)}`) + tokens;

  return (
    <div className="flex min-w-0 flex-col gap-3">
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
        active={inert ? '' : (run.position?.stage ?? '')}
        detail={inert ? '' : (run.position?.stage_detail ?? '')}
        seen={seenStages(run)}
      />

      {/* ONE ROW PER LANE, and only once a run walks MORE THAN ONE: with a single lane the strip
          above already says the same thing. The row speaks the card's own vocabulary — the
          running mark, the tone `phaseStateTone` gives a running phase, the runner's stage word.
          Keyed by its LANE ID, never by index: an index key would slide every row under a
          finished lane onto its neighbour's mark and stage.
          THE SWARM MARK LEADS THE BLOCK — the same `Network` glyph the settings row beside the
          switch wears — because the row of lanes alone reads as "this run has several phases";
          the mark and its count are what say the run is walking them TOGETHER, at a glance. */}
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
            A caller may pass `defaultOpen={false}`, and a reader of a folded run would then meet
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
              isCurrent={!inert && phase.id === currentPhaseId}
              stageSince={inert ? null : (run.position?.stage_since ?? null)}
              alongside={alongside.get(phase.id)}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
