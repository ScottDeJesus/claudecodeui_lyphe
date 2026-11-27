import { onSoulLaunchesChanged } from '@/modules/dispatch-souls/index.js';
import { onNotification } from '@/modules/notifications/index.js';
import {
  listSubagentRunningModels,
  listSubagentRunningSessionIds,
  subagentRunsLapseAt,
} from '@/modules/providers/services/session-subagent-runs.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { onSessionsFlushed } from '@/modules/providers/services/sessions-watcher.service.js';
import { broadcastToAll, chatRunRegistry } from '@/modules/websocket/index.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';
import type { RunningSessionsPayload, RunningSessionsStateEvent } from '@/shared/types.js';

/**
 * The running sessions, told rather than asked: the answer of `GET /api/providers/sessions/running` goes to every open socket
 * as `running_sessions_state` whenever it changes, so no tab reads it on a clock.
 *
 * The lane has no interval and no backstop (`backstopMs: null`). It reads when something that moves the answer is announced:
 *   - a run starts, ends, or raises, answers or withdraws an ask (`chatRunRegistry.onRunChanged` with `states` true); a streamed
 *     line (`states` false) is not a poke;
 *   - the sessions watcher flushes (`onSessionsFlushed`): a transcript moved, which is how an `Agent` call going out or reporting
 *     back reaches the subagent lists;
 *   - the launcher's souls change (`onSoulLaunchesChanged`): a hand-dispatched soul starting or ending;
 *   - a notification is raised (`onNotification`): an ask raised or settled outside a live run.
 * And one deadline, for the one change nothing writes: an agent still believed out stops being believed four hours after its
 * launch (`subagentRunsLapseAt`). After each reading one unref'd timer is armed to that instant, and its firing is a poke.
 */

/**
 * The shortest wait for the lapse deadline: a deadline already past (the pass that set it began before the lapse) waits this long
 * rather than firing at once, so it is never a tight loop.
 */
const LAPSE_SETTLE_MS = 2_000;

/**
 * The route's answer: the live runs, the conversations with agents out (and their models), and the asks waiting. `freshFrom`
 * is the instant the subagent answer must not predate (`runningNow`): the lane passes its reading's start, the route nothing.
 */
export async function readRunningSessions(freshFrom: number = 0): Promise<RunningSessionsPayload> {
  // The subagent pass first: it can take seconds (a transcript parse), and the registry is read after it, so a reading that was
  // already out when a run ended still answers with the run gone.
  const subagentSessionIds = await listSubagentRunningSessionIds(Date.now(), freshFrom);
  const subagentModels = await listSubagentRunningModels(Date.now(), freshFrom);
  const sessions = sessionsService.listRunningSessions();
  const awaitingInputSessionIds = sessionsService.listAwaitingInputSessionIds();
  return { sessions, subagentSessionIds, subagentModels, awaitingInputSessionIds };
}

/** The lane as its owner (`server/index.ts`) drives it. */
export type RunningSessionsLane = { start(): void; stop(): void };

export function createRunningSessionsLane(): RunningSessionsLane {
  let lapseTimer: NodeJS.Timeout | null = null;
  let unsubscribers: Array<() => void> = [];

  const lane = createPolledLane<RunningSessionsPayload, RunningSessionsStateEvent<RunningSessionsPayload>>({
    snapshot: async () => {
      // Every reading answers a poke, so it takes no subagent answer from a pass that began before the reading did.
      const payload = await readRunningSessions(Date.now());
      armLapse();
      return payload;
    },
    frame: (payload) => ({ kind: 'running_sessions_state', at: Date.now(), ...payload }),
    serialize: frameIdentity,
    broadcast: broadcastToAll,
    backstopMs: null,
    logError: (message) => console.error(`[RunningSessions] ${message}`),
  });

  /** One deadline, re-armed after every reading to the instant the last pass's answer lapses. */
  function armLapse(): void {
    if (lapseTimer !== null) clearTimeout(lapseTimer);
    lapseTimer = null;
    const lapseAt = subagentRunsLapseAt();
    if (lapseAt === null) return;
    // `+ 1`: the window keeps an agent while its age is not past the window, so the reading must land after the instant.
    lapseTimer = setTimeout(() => {
      lapseTimer = null;
      lane.poke();
    }, Math.max(LAPSE_SETTLE_MS, lapseAt - Date.now() + 1));
    lapseTimer.unref();
  }

  return {
    start(): void {
      lane.start();
      if (unsubscribers.length > 0) return;
      unsubscribers = [
        chatRunRegistry.onRunChanged((_sessionId, { states }) => {
          if (states) lane.poke();
        }),
        onSessionsFlushed(() => lane.poke()),
        onSoulLaunchesChanged(() => lane.poke()),
        onNotification(() => lane.poke()),
      ];
    },
    stop(): void {
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers = [];
      if (lapseTimer !== null) clearTimeout(lapseTimer);
      lapseTimer = null;
      lane.stop();
    },
  };
}

/**
 * What decides that a frame goes out: the answer without each run's `lastSeq` and `lastActivity`, which move with every streamed
 * line and every transcript write. A run that is merely talking changes neither the Running list nor a mark, so it sends nothing;
 * a frame that does go out carries both fields as they stand.
 */
function frameIdentity(payload: RunningSessionsPayload): string {
  return JSON.stringify({
    ...payload,
    sessions: payload.sessions.map((run) => [
      run.sessionId,
      run.provider,
      run.startedAt,
      run.cliVersion,
      run.projectId,
      run.projectPath,
      run.projectDisplayName,
      run.sessionTitle,
      run.awaitingInput,
    ]),
  });
}
