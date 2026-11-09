import { useEffect, useState } from 'react';
import type { AnimationEvent, ReactNode } from 'react';

import { cn } from '@/shared/utils';

/**
 * Where a piece of the scene arrives from and settles back toward: the middle (a scale), a rim's side, the dock below, or the
 * companion's core (a shrink into the dock). `stationScene.css` turns each into the offset the motion runs from.
 */
export type StationArrivalPlace = 'center' | 'rim-start' | 'rim-end' | 'dock' | 'core';

/** A piece's life: arriving on its spring, live, settling away, gone (drawn as nothing). */
type ArrivalPhase = 'arriving' | 'live' | 'settling' | 'gone';

/** How long each motion runs (the tokens' `--duration-lock`, `--duration-lobe` and `--duration-settle`), for the backstop below. */
const MOTION_MS = { lock: 520, lobe: 880, settle: 360 };

/** The backstop's grace past a motion's own length: a hidden tab or a `display: none` ancestor never fires `animationend`. */
const BACKSTOP_GRACE_MS = 160;

type StationArrivalProps = {
  /** Whether the piece is true now. True mounts it on its spring; false lets it linger, then settle away and unmount. */
  when: boolean;
  /** Its place in the scene: what it arrives from and settles toward. `center` when absent. */
  from?: StationArrivalPlace;
  /** `lock` (the default) for a thing that arrives and holds; `lobe` for a livelier pop. */
  spring?: 'lock' | 'lobe';
  /** How long, in ms, it stays after it stops being true, before it settles. None when absent. */
  linger?: number;
  className?: string;
  children: ReactNode;
};

/**
 * ARRIVE, LIVE, SETTLE: the scene's one motion for anything that is drawn only while it is true. While `when` holds it is
 * drawn, arriving from its place on the lock spring (`--ease-lock`); when `when` stops it lingers for `linger`, then settles
 * back toward its place (`--ease-settle`) still drawing what it last held, so it leaves as it stood rather than as an emptied
 * box, and then it is gone: nothing is drawn. True again while settling, it comes straight back.
 *
 * The phase is written on the box as `data-arrival` (`arriving`, `live`, `settling`) with `data-from` and `data-spring`, and
 * `stationScene.css` runs the motion from them; under reduced motion each is a fade. A place that makes room for the piece
 * reads the phase too (the dock's held row opens while its draft arrives and closes as it settles).
 *
 * Used by the station's dock: the companion's core (`StationHeadView`), Stop while a turn runs, and the draft held for your
 * Send (`StationDockView`).
 */
export function StationArrival({ when, from = 'center', spring = 'lock', linger = 0, className, children }: StationArrivalProps) {
  // The piece's phase. State, because the phase decides what is drawn (nothing once gone) and which motion runs.
  const [phase, setPhase] = useState<ArrivalPhase>(when ? 'arriving' : 'gone');
  // The `when` the piece last drew with. State, so a change of it is seen during the render it arrives in (React's way for state
  // that follows a prop) and the piece arrives in that same render rather than one later.
  const [drawnWhen, setDrawnWhen] = useState(when);
  // What the piece drew while it was last true, drawn again while it settles. State for the same reason: it follows `children`
  // while `when` holds, and stops following when it does not.
  const [lastTrue, setLastTrue] = useState<ReactNode>(children);

  if (when !== drawnWhen) {
    setDrawnWhen(when);
    // True again: arrive, or come straight back mid-settle.
    if (when && phase !== 'arriving' && phase !== 'live') setPhase('arriving');
  }
  if (when && lastTrue !== children) setLastTrue(children);

  // No longer true: linger, then settle.
  useEffect(() => {
    if (when || phase === 'settling' || phase === 'gone') return undefined;
    const lingering = window.setTimeout(() => setPhase((now) => (now === 'gone' ? now : 'settling')), Math.max(0, linger));
    return () => window.clearTimeout(lingering);
  }, [when, phase, linger]);

  // The motion's end moves the phase on: arriving to live, settling to gone.
  const finish = (which: ArrivalPhase) => {
    setPhase((now) => {
      if (now !== which) return now;
      if (now === 'arriving') return 'live';
      if (now === 'settling') return 'gone';
      return now;
    });
  };

  // The backstop for a motion whose end never fires.
  useEffect(() => {
    if (phase !== 'arriving' && phase !== 'settling') return undefined;
    const ms = (phase === 'arriving' ? MOTION_MS[spring] : MOTION_MS.settle) + BACKSTOP_GRACE_MS;
    const backstop = window.setTimeout(() => finish(phase), ms);
    return () => window.clearTimeout(backstop);
  }, [phase, spring]);

  if (phase === 'gone') return null;
  return (
    <div
      data-arrival={phase}
      data-from={from}
      data-spring={spring}
      className={cn('min-w-0', className)}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) finish(phase);
      }}
    >
      {when ? children : lastTrue}
    </div>
  );
}
