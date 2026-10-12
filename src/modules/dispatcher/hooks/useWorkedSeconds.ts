import { useEffect, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/** Under a minute the figure says seconds; from a minute on it says minutes, hours or days and only ever changes on a whole one. */
const ONE_MINUTE = 60;

/**
 * The seconds a figure's WORDS change on: itself under a minute, its whole minute after. `humanizeDuration`
 * floors to the minute from 60s on, so the bucket and the figure are worded alike — and a tick whose
 * bucket did not move sets the state it already holds, which React does not draw.
 */
function wordBucket(seconds: number): number {
  return seconds < ONE_MINUTE ? seconds : Math.floor(seconds / ONE_MINUTE) * ONE_MINUTE;
}

/**
 * The figure as it stands at `nowMs`: the dispatcher's own while nothing is running, else that plus the
 * whole seconds since the reading arrived (never negative, so a clock stepped back draws the figure as it
 * stood).
 */
function standingAt(nowMs: number, runtimeS: number, running: boolean, readAtMs: number | null): number {
  if (!running || readAtMs === null) return runtimeS;
  return runtimeS + Math.max(0, Math.floor((nowMs - readAtMs) / 1000));
}

/**
 * The time agents have worked on a plan or an epic, ticking each second while one is out, as whole seconds.
 *
 * `runtimeS` is the dispatcher's figure as of its reading (`DispatcherPlan.runtime_s`) and `readAtMs` the
 * moment that reading reached THIS browser, on this browser's own clock (`DispatcherLanePicture.received_at`)
 * — never the server's stamp, which this browser's `Date.now()` would be subtracted from across two clocks.
 * While `running` — an agent is out on the thing
 * (`planAgentOut`, `arcAgentOut`) — the figure is `runtimeS` plus the seconds since `readAtMs`; otherwise
 * it is `runtimeS` as it stands, still. The lane does not send a frame for a figure moving alone (the
 * watcher compares pictures without it), so this is the only thing that moves it between frames, and
 * every frame that follows a change replaces the base it counts from.
 *
 * ONE INTERVAL AT MOST, and none for a figure that stands still, on the window the reader is in
 * (`useHostWindow`: a hidden opener throttles its timers to about one a minute).
 */
export function useWorkedSeconds(runtimeS: number, running: boolean, readAtMs: number | null): number {
  const hostWindow = useHostWindow();

  // The clock's own reading, as the bucket the words are made from. Essential and not derivable: nothing
  // else re-renders a card when a second passes, and a running figure changes for no other reason.
  const [bucket, setBucket] = useState(() => wordBucket(standingAt(Date.now(), runtimeS, running, readAtMs)));

  useEffect(() => {
    const read = () => setBucket(wordBucket(standingAt(Date.now(), runtimeS, running, readAtMs)));
    // A new frame, or a change of whether an agent is out, restarts the count from its own base.
    read();
    if (!running) return undefined;
    const timer = hostWindow.setInterval(read, 1000);
    return () => hostWindow.clearInterval(timer);
  }, [runtimeS, running, readAtMs, hostWindow]);

  return bucket;
}
