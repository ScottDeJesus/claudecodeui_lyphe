import { phaseStatusTone } from '@/modules/dispatcher/dispatcherState';
import type { DispatcherPhase, Tone } from '@/shared/types';

/** How a phase reads, decided once: its word's copy key, its tone, and its mark on the track. */
type PhaseWord = { key: 'running' | 'settling' | 'done' | 'notStarted'; copy: string; tone: Tone; mark: string };

/**
 * The word a phase wears, and the one place `settling` is decided. A `running` row whose walker is
 * no longer busy is a walk that ENDED and has not yet been settled by the rule — it is not moving,
 * so it must not wear the blue `running` a reader would take for work in flight: it is `neutral`,
 * and its mark is `…` rather than `▶︎`.
 *
 * The mark is the phase's sign on the plan's track: `✓` done, `▶︎` walking, `…` settling, and its
 * own position while it has not started — a number is what a reader counts along the row by.
 *
 * A module of its own, beside the components that read it, so each of their files exports
 * components only and keeps fast refresh.
 *
 * Used by `PlanPhaseRow`, by `PlanFace` for the track's nodes and by `PlanNow` for its lines, so
 * the three can never disagree about whether a phase is moving.
 */
export function phaseWord(phase: DispatcherPhase): PhaseWord {
  if (phase.status === 'running') {
    return phase.busy
      ? { key: 'running', copy: 'dispatcher.phase.running', tone: phaseStatusTone(phase), mark: '▶︎' }
      : { key: 'settling', copy: 'dispatcher.settling', tone: 'neutral', mark: '…' };
  }
  if (phase.status === 'done') return { key: 'done', copy: 'dispatcher.phase.done', tone: phaseStatusTone(phase), mark: '✓' };
  return { key: 'notStarted', copy: 'dispatcher.phase.notStarted', tone: phaseStatusTone(phase), mark: String(phase.position) };
}

/**
 * The phase a plan's track opens on when it has to scroll: the one WALKING now (`running`, busy), else
 * the first that is not done — settling or not started, the next thing the plan will do — else the last
 * once every phase is done, and `null` for a plan with none cut. Read off `phaseWord`, so it can never
 * disagree with the marks the track draws.
 *
 * Used by `PlanFace`, as its track's `current`.
 */
export function currentPhaseKey(phases: readonly DispatcherPhase[]): string | null {
  const walking = phases.find((phase) => phaseWord(phase).key === 'running');
  const next = phases.find((phase) => phaseWord(phase).key !== 'done');
  return (walking ?? next ?? phases[phases.length - 1])?.key ?? null;
}
