import type { SoulLaunchSnapshot } from '@/shared/types.js';

/**
 * When the souls lane must read again with no write to tell it: its backstop, a function of the picture it holds.
 *
 * Two things change a launch's snapshot with nothing written in the launch root, and each is the one
 * timer it needs, armed for an instant and never a cadence:
 *   - A LAUNCH LEAVING THE WINDOW. An ended launch is carried for `keepS` after its end (a running one
 *     after its start), and the lane drops it at the first reading past that edge. Nothing is written
 *     then, so the lane reads one second after the first carried launch reaches it.
 *   - A PROCESS DYING. A launcher or child that is killed writes no receipt; its pid simply stops
 *     being the process it names (`/proc/<pid>/cmdline`). A process exit of a stranger's pid offers
 *     this process no event, so while any launch is running the lane looks again every
 *     `LIVENESS_MS` — and never while none is.
 */

/** How long a killed launcher may read as running: thirty seconds, while a launch is out and only then. */
export const LIVENESS_MS = 30_000;

/** Read this far past a launch's keep edge, so the reading finds it over the edge and not on it. */
const KEEP_EDGE_MARGIN_MS = 1000;

export function nextLaunchReadMs(
  launches: readonly SoulLaunchSnapshot[] | null,
  nowS: number,
  keepS: number,
): number | null {
  if (launches === null || launches.length === 0) return null;
  const firstEdgeS = Math.min(...launches.map((launch) => (launch.ended_at ?? launch.started_at) + keepS));
  // Capped at the furthest a real edge can be: a stamp from the future (one written in ms) would overflow the timer.
  const latestEdgeMs = keepS * 1000 + KEEP_EDGE_MARGIN_MS;
  const untilEdgeMs = Math.min(latestEdgeMs, Math.max(0, Math.ceil((firstEdgeS - nowS) * 1000) + KEEP_EDGE_MARGIN_MS));
  const isAnyRunning = launches.some((launch) => launch.state === 'running');
  return isAnyRunning ? Math.min(LIVENESS_MS, untilEdgeMs) : untilEdgeMs;
}
