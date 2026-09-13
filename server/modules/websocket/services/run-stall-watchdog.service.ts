/**
 * Watches every live run for silence and turns it into one `session.stuck`
 * notification.
 *
 * A provider run that hangs — a CLI waiting on a prompt nobody sees, a network
 * call that never returns, a process that died without an exit event — looks
 * exactly like a run that is thinking hard: the session stays busy and nothing
 * arrives. The registry already knows when each run last produced an event;
 * this is the one place that decides how long is too long and tells the user.
 *
 * It is deliberately a poller over `chatRunRegistry.listRunningRuns()` rather
 * than a timer armed per run: runs come and go, and one interval that reads the
 * whole list cannot leak a timer for a run that ended. It lives in the
 * websocket module because the registry owns runs — no provider knows it exists.
 */

import { appConfigDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
// The pending-approval list: it is what tells a hung run apart from one that is
// waiting for a person. Read inside the sweep, never at load — this import closes
// the websocket/providers cycle that already exists in the other direction.
import { providerRuntimeService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';

/**
 * The orchestrator is JavaScript, so TypeScript reads each optional parameter's
 * type from its default value: `sessionId = null` and `dedupeKey = null` are
 * inferred as `null | undefined` and reject the real strings the function is
 * documented to accept. This alias states the contract the orchestrator actually
 * implements — the JavaScript is left alone, and the call below stays honest.
 */
const buildStuckEvent = createNotificationEvent as (input: {
  provider: string;
  sessionId: string | null;
  kind: 'error';
  code: 'session.stuck';
  meta: { silentForMs: number };
  severity: 'warning';
  dedupeKey: string | null;
}) => object;

/** How often the running list is swept. Far below any sensible stall threshold. */
const DEFAULT_INTERVAL_MS = 15_000;

/** The silence that counts as stuck when nothing overrides it: 15 minutes. */
const DEFAULT_STALL_MS = 15 * 60_000;

/** The `app_config` key an operator (or a probe) sets to shorten the threshold. */
const STALL_MS_CONFIG_KEY = 'run_stall_ms';

/**
 * The silence threshold, read fresh on every sweep — a change to the config row
 * or the environment takes effect on the next tick rather than at the next boot.
 * `Number(null)` and `Number('')` are 0, so a missing or blank value falls
 * through to the next source on its own.
 */
function readStallMs(): number {
  const configured = Number(appConfigDb.get(STALL_MS_CONFIG_KEY));
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  const fromEnvironment = Number(process.env.CLOUDCLI_STALL_MS);
  if (Number.isFinite(fromEnvironment) && fromEnvironment > 0) {
    return fromEnvironment;
  }

  return DEFAULT_STALL_MS;
}

/**
 * Starts the sweep and returns the function that stops it.
 *
 * Called once from the server entrypoint after `listen`; the returned stop is
 * called on shutdown. The timer is `unref`ed, so it never holds the process open.
 */
export function startRunStallWatchdog(options: { intervalMs?: number } = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  /**
   * When this watchdog last announced each session, keyed by app session id.
   * What was sent is the sender's memory, not the registry's — so a second
   * stall in one run is `notifiedAt < lastEventAt` (events resumed, then
   * stopped again) rather than a reset written at the event site.
   */
  const notifiedAt = new Map<string, number>();

  const sweep = (): void => {
    const stallMs = readStallMs();
    const now = Date.now();
    const running = chatRunRegistry.listRunningRuns();

    for (const run of running) {
      const silentForMs = now - run.lastEventAt;
      if (silentForMs < stallMs) {
        continue;
      }

      // Already told about this silence: only events arriving since the notice
      // (which push `lastEventAt` past it) can earn a second one.
      if ((notifiedAt.get(run.sessionId) ?? 0) >= run.lastEventAt) {
        continue;
      }

      // Waiting for you is not stuck. A run parked on a tool approval is silent
      // by construction — the request went out and nothing more can happen until
      // a human answers, and the plan/question hook allows a full day for that —
      // so the person already holds the one push this session owes them.
      if (providerRuntimeService.getPendingApprovalsForSession(run.sessionId).length > 0) {
        continue;
      }

      try {
        // Synchronous by contract: the orchestrator fans out to the channels and
        // catches each channel's own failure, so nothing here can be left hanging.
        notifyUserIfEnabled({
          userId: run.userId,
          event: buildStuckEvent({
            provider: run.provider,
            sessionId: run.sessionId,
            kind: 'error',
            code: 'session.stuck',
            meta: { silentForMs },
            severity: 'warning',
            dedupeKey: `${run.provider}:stuck:${run.sessionId}:${now}`,
          }),
        });
        // Recorded only once the notice is actually out: a throw above must leave
        // this session unmarked so the next sweep tries again.
        notifiedAt.set(run.sessionId, now);
      } catch (error) {
        // One run's bad news is not the other runs' problem, and it must not cost
        // this tick its remaining runs or its prune.
        const message = error instanceof Error ? error.message : String(error);
        console.error('[RunStallWatchdog] Could not announce a stalled run', {
          sessionId: run.sessionId,
          error: message,
        });
      }
    }

    // Forget runs that are no longer running: the map is a cache about live
    // runs, and a session that starts again deserves a fresh verdict.
    const liveSessionIds = new Set(running.map((run) => run.sessionId));
    for (const sessionId of [...notifiedAt.keys()]) {
      if (!liveSessionIds.has(sessionId)) {
        notifiedAt.delete(sessionId);
      }
    }
  };

  const timer = setInterval(() => {
    try {
      sweep();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RunStallWatchdog] Sweep failed', { error: message });
    }
  }, intervalMs);

  // A watchdog is never a reason to keep the process alive.
  timer.unref?.();

  return () => clearInterval(timer);
}
