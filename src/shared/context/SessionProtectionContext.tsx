import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { createStableContext } from '@/shared/context/stableContext';
import { SubagentModelsContext } from '@/shared/context/subagentModelsContext';
import {
  useSessionProtection,
} from '@/shared/hooks/useSessionProtection';
import type { IsSessionProcessing, LLMProvider, MarkSessionIdle, MarkSessionProcessing, RunningSessionListItem, SessionActivityMap, SyncProcessingSessions } from '@/shared/types';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { useServerFrame } from '@/shared/hooks/useServerFrame';

/** The frame the server's running-sessions lane sends: the route's whole answer, at the frame's top level. */
const RUNNING_SESSIONS_STATE_KIND = 'running_sessions_state';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
  provider?: unknown;
  projectId?: unknown;
  projectPath?: unknown;
  projectDisplayName?: unknown;
  sessionTitle?: unknown;
  lastActivity?: unknown;
  awaitingInput?: unknown;
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: unknown;
    /**
     * Conversations with a subagent still running, whether or not they carry a live run. Beside
     * `sessions` rather than on it, because the chat this is usually about has no run left: its
     * turn ended and its backgrounded agent did not.
     */
    subagentSessionIds?: unknown;
    /**
     * For each of those conversations, the model of every agent it has running (`''` for one whose model is not recorded yet).
     * Absent from a server older than the field, and then every such conversation simply has no models named.
     */
    subagentModels?: unknown;
    /**
     * Conversations with a question or permission prompt waiting, whether or not they carry a live
     * run. Beside `sessions` for the same reason: a prompt outlives the turn that raised it, and a
     * row can only light if this list reaches the sessions the registry has forgotten.
     */
    awaitingInputSessionIds?: unknown;
  };
};

type SessionProtectionActions = {
  markSessionProcessing: MarkSessionProcessing;
  markSessionIdle: MarkSessionIdle;
  syncProcessingSessions: SyncProcessingSessions;
  isSessionProcessing: IsSessionProcessing;
};

const NO_RUNNING_SESSIONS: readonly RunningSessionListItem[] = [];
const NO_SESSION_IDS: readonly string[] = [];

/**
 * The running-sessions payload's `subagentModels` as sorted `[sessionId, models]` pairs, with anything that is not a session id
 * holding a list of strings left out. Sorted by id so that an order the server is free to change is not read as a change.
 */
const parseSubagentModels = (value: unknown): [string, string[]][] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value)
    .filter((entry): entry is [string, unknown[]] => entry[0].length > 0 && Array.isArray(entry[1]))
    .map(([sessionId, models]): [string, string[]] => [sessionId, models.filter((model): model is string => typeof model === 'string')])
    .filter(([, models]) => models.length > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
};

/** How long a read of the running list that has not settled blocks the next read: the api's 30 s request ceiling (`REQUEST_TIMEOUT_MS`) and five seconds past it. */
const RUNNING_READ_GUARD_MS = 35_000;

/** Whether two id lists name the same sessions, so a reading that moved nothing keeps the previous array. */
const sessionIdListsMatch = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const SessionProtectionStateContext = createStableContext<SessionActivityMap | null>(import.meta.hot, 'SessionProtectionStateContext', null);
const SessionProtectionActionsContext = createStableContext<SessionProtectionActions | null>(import.meta.hot, 'SessionProtectionActionsContext', null);
const BusySessionIdsContext = createStableContext<ReadonlySet<string> | null>(import.meta.hot, 'BusySessionIdsContext', null);
const RunningSessionsContext = createStableContext<readonly RunningSessionListItem[]>(import.meta.hot, 'RunningSessionsContext', NO_RUNNING_SESSIONS);
const SubagentRunningSessionIdsContext = createStableContext<ReadonlySet<string> | null>(import.meta.hot, 'SubagentRunningSessionIdsContext', null);
const AwaitingInputSessionIdsContext = createStableContext<ReadonlySet<string> | null>(import.meta.hot, 'AwaitingInputSessionIdsContext', null);

const asOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Keeps the previous array when a reading (the route's or a frame's) carries the same runs, so it
 * does not re-render every consumer while nothing has changed.
 */
const runningSessionListsMatch = (
  left: readonly RunningSessionListItem[],
  right: readonly RunningSessionListItem[],
): boolean =>
  left.length === right.length
  && left.every((item, index) => {
    const other = right[index];
    return other !== undefined
      && item.sessionId === other.sessionId
      && item.projectId === other.projectId
      && item.projectDisplayName === other.projectDisplayName
      && item.sessionTitle === other.sessionTitle
      && item.lastActivity === other.lastActivity
      && item.provider === other.provider
      && item.awaitingInput === other.awaitingInput;
  });

/**
 * A set of session ids with a stable identity while membership is unchanged — what every
 * membership-only consumer of the activity map and of the running-sessions list reads.
 *
 * Both sources rewrite themselves constantly: every provider `status` frame rewrites an entry's
 * `statusText`, allocating a new activity map several times a second during a run, and the
 * running list is rebuilt on every reading, whether or not anything moved. Consumers that only
 * need membership — the sidebar renders a dot per row and a running count — would re-render on all
 * of it. Deriving the set from a membership key, rather than from the collection, keeps its
 * identity stable without reading a ref during render. Session ids never contain a NUL, so it is a
 * safe separator.
 */
function useSessionIdSet(sessionIds: Iterable<string>): ReadonlySet<string> {
  const membershipKey = [...sessionIds].sort().join('\u0000');

  return useMemo(
    () => new Set(membershipKey ? membershipKey.split('\u0000') : []),
    [membershipKey],
  );
}

const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Mounted by the project-workspace route; tracks which sessions are producing a response so chat, sidebar and project-workspace agree on session activity. */
export function SessionProtectionProvider({ children }: { children: ReactNode }) {
  const {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
    isSessionProcessing,
  } = useSessionProtection();

  const [runningSessions, setRunningSessions] = useState<readonly RunningSessionListItem[]>(NO_RUNNING_SESSIONS);
  // Kept as its own list rather than hung on the runs above, because the sessions it names are
  // usually NOT among them: a backgrounded agent outlives the turn that launched it, so the chat
  // holding one has no run left to hang anything on.
  const [subagentSessionIds, setSubagentSessionIds] = useState<readonly string[]>(NO_SESSION_IDS);
  // The models of the agents each of those sessions has running, held as the JSON of its sorted pairs: a string is equal to the
  // last reading's exactly when nothing changed, so the map built from it below keeps its identity through a reading that moved nothing.
  const [subagentModelsKey, setSubagentModelsKey] = useState('[]');
  // Answered by the server's own approval map rather than read off the runs below, and that is the
  // whole point of it: a question outlives the turn that asked it, so the chat it waits in is
  // usually NOT among the runs — a backgrounded agent's completion wakes the CLI for a continuation
  // turn no run is registered for, and a re-adopted host re-issues the prompt it was parked on.
  const [awaitingInputSessionIds, setAwaitingInputSessionIds] = useState<readonly string[]>(NO_SESSION_IDS);
  // A send still waiting in the socket's outbox has not reached the server, so the server cannot list
  // it yet. Its spinner stays, which keeps a second press on the composer's queue path instead of
  // becoming a second send the server would refuse.
  const { hasQueuedSend } = useWebSocket();

  // The read of the running list that is out, if any, and when it began. The server holds this read for as long as 76 s while a successor
  // waits for its predecessor to drain (`RUNS_READOPTED_WAIT_MS`, server/index.ts), and the reads below (a reconnect, a tab shown again) would otherwise
  // pile held reads up: six of them fill the browser's six connections to this origin, and every other request of the page (her speech,
  // her picture) waits behind them. One read at a time. A read older than the 30 s ceiling and five seconds past it no longer blocks the next one:
  // the ceiling ends it, and on a browser with no `AbortSignal.timeout` (iOS 15) a read that never settles has no ceiling at all.
  const refreshingRef = useRef<{ startedAt: number } | null>(null);

  // One answer, from the route or from a running_sessions_state frame (the same body, at the frame's top level).
  const applyRunningSessions = useCallback((payload: RunningSessionsApiPayload) => {
    const rawSessions = payload.data?.sessions;
    const sessions: RunningSessionApiItem[] = Array.isArray(rawSessions) ? rawSessions : [];

    // The same payload feeds two consumers: the activity map (membership and
    // status) and the sidebar's Running list, which needs the project each
    // run belongs to.
    setRunningSessions((previous) => {
      const next = sessions.reduce<RunningSessionListItem[]>((acc, session) => {
        if (typeof session.sessionId !== 'string' || !session.sessionId) {
          return acc;
        }

        acc.push({
          sessionId: session.sessionId,
          provider: (typeof session.provider === 'string' ? session.provider : 'claude') as LLMProvider,
          startedAt: parseStartedAt(session.startedAt),
          projectId: asOptionalString(session.projectId),
          projectPath: asOptionalString(session.projectPath),
          projectDisplayName: asOptionalString(session.projectDisplayName) ?? 'Unknown Project',
          sessionTitle: asOptionalString(session.sessionTitle) ?? session.sessionId,
          lastActivity: asOptionalString(session.lastActivity),
          awaitingInput: session.awaitingInput === true,
        });
        return acc;
      }, []);

      return runningSessionListsMatch(previous, next) ? previous : next;
    });

    // Sorted before it becomes state: the set below is built from a membership key, and an order
    // the server is free to change must not read as a change of membership.
    const subagents = (Array.isArray(payload.data?.subagentSessionIds)
      ? payload.data.subagentSessionIds
      : []
    ).filter((id): id is string => typeof id === 'string' && id.length > 0).sort();
    setSubagentSessionIds((previous) => (
      sessionIdListsMatch(previous, subagents) ? previous : subagents
    ));

    setSubagentModelsKey(JSON.stringify(parseSubagentModels(payload.data?.subagentModels)));

    const awaiting = (Array.isArray(payload.data?.awaitingInputSessionIds)
      ? payload.data.awaitingInputSessionIds
      : []
    ).filter((id): id is string => typeof id === 'string' && id.length > 0).sort();
    setAwaitingInputSessionIds((previous) => (
      sessionIdListsMatch(previous, awaiting) ? previous : awaiting
    ));

    syncProcessingSessions(
      sessions
        .map((session) => {
          if (typeof session.sessionId !== 'string' || !session.sessionId) {
            return null;
          }

          return {
            sessionId: session.sessionId,
            startedAt: parseStartedAt(session.startedAt),
            statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
            canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
          };
        })
        .filter((session): session is NonNullable<typeof session> => Boolean(session)),
      hasQueuedSend,
    );
  }, [hasQueuedSend, syncProcessingSessions]);

  const refreshRunningSessions = useCallback(async () => {
    const inFlight = refreshingRef.current;
    if (inFlight !== null && Date.now() - inFlight.startedAt < RUNNING_READ_GUARD_MS) {
      return;
    }
    const mine = { startedAt: Date.now() };
    refreshingRef.current = mine;
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      applyRunningSessions((await response.json()) as RunningSessionsApiPayload);
    } catch (error) {
      console.error('[SessionProtection] Failed to sync running sessions:', error);
    } finally {
      // A read the guard let past may have replaced this one's entry; only the read that owns it frees it.
      if (refreshingRef.current === mine) {
        refreshingRef.current = null;
      }
    }
  }, [applyRunningSessions]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  // The server sends the whole answer whenever it changes; a reconnect means frames were missed, so the route is read once.
  useServerFrame([RUNNING_SESSIONS_STATE_KIND], (event) => {
    if (event.kind !== RUNNING_SESSIONS_STATE_KIND) {
      void refreshRunningSessions();
      return;
    }
    applyRunningSessions({
      data: {
        sessions: event.sessions,
        subagentSessionIds: event.subagentSessionIds,
        subagentModels: event.subagentModels,
        awaitingInputSessionIds: event.awaitingInputSessionIds,
      },
    });
  });

  useEffect(() => {
    // A hidden tab may have slept through frames (a backgrounded phone drops its socket); read the moment it is looked at
    // again, so a spinner or a waiting-for-you dot is never stale on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshRunningSessions();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshRunningSessions]);

  const actions = useMemo<SessionProtectionActions>(
    () => ({
      markSessionProcessing,
      markSessionIdle,
      syncProcessingSessions,
      isSessionProcessing,
    }),
    [
      isSessionProcessing,
      markSessionIdle,
      markSessionProcessing,
      syncProcessingSessions,
    ],
  );

  const busySessionIds = useSessionIdSet(processingSessions.keys());
  const subagentRunningSessionIds = useSessionIdSet(subagentSessionIds);
  const subagentModels = useMemo<ReadonlyMap<string, readonly string[]>>(
    () => new Map(JSON.parse(subagentModelsKey) as [string, string[]][]),
    [subagentModelsKey],
  );
  // Both sources, because they answer different halves of the same question: the run-scoped flag
  // covers a question asked inside a live turn, the list covers one still waiting after the turn
  // that asked it ended. A runtime that answers only per-session keeps working through the first.
  const awaitingInputSessionIdSet = useSessionIdSet([
    ...runningSessions.filter((run) => run.awaitingInput).map((run) => run.sessionId),
    ...awaitingInputSessionIds,
  ]);

  return (
    <SessionProtectionActionsContext.Provider value={actions}>
      <BusySessionIdsContext.Provider value={busySessionIds}>
        <RunningSessionsContext.Provider value={runningSessions}>
          <SubagentRunningSessionIdsContext.Provider value={subagentRunningSessionIds}>
            <SubagentModelsContext.Provider value={subagentModels}>
              <AwaitingInputSessionIdsContext.Provider value={awaitingInputSessionIdSet}>
                <SessionProtectionStateContext.Provider value={processingSessions}>
                  {children}
                </SessionProtectionStateContext.Provider>
              </AwaitingInputSessionIdsContext.Provider>
            </SubagentModelsContext.Provider>
          </SubagentRunningSessionIdsContext.Provider>
        </RunningSessionsContext.Provider>
      </BusySessionIdsContext.Provider>
    </SessionProtectionActionsContext.Provider>
  );
}

/**
 * Membership-only view of the running sessions. Prefer this over
 * useProcessingSessions wherever the activity details are not rendered.
 */
export function useBusySessionIdSet(): ReadonlySet<string> {
  const busySessionIds = useContext(BusySessionIdsContext);
  if (!busySessionIds) {
    throw new Error('useBusySessionIdSet must be used within SessionProtectionProvider');
  }
  return busySessionIds;
}

/**
 * The sessions with a question or permission prompt waiting on the user, from the same 5-second
 * refresh. A sidebar row shows these as a yellow dot in place of its spinner — and, when the chat
 * has no run left to spin, as a dot on its own: a question outlives the turn that asked it, so the
 * set is the server's own approval map, not the runs.
 */
export function useAwaitingInputSessionIdSet(): ReadonlySet<string> {
  const awaitingInputSessionIds = useContext(AwaitingInputSessionIdsContext);
  if (!awaitingInputSessionIds) {
    throw new Error('useAwaitingInputSessionIdSet must be used within SessionProtectionProvider');
  }
  return awaitingInputSessionIds;
}

/**
 * The conversations with a subagent still running, from the same 5-second refresh. A sidebar row
 * shows one as a purple dot, which it wears ALONGSIDE its spinner or its yellow dot rather than in
 * place of them, and whether or not its own turn is still going.
 *
 * This is the only mark the sidebar has for work that outlives its own turn: a backgrounded agent
 * keeps running after the run that launched it has left the registry, and nothing in the chat's own
 * loaded rows says so.
 */
export function useSubagentRunningSessionIdSet(): ReadonlySet<string> {
  const subagentRunningSessionIds = useContext(SubagentRunningSessionIdsContext);
  if (!subagentRunningSessionIds) {
    throw new Error('useSubagentRunningSessionIdSet must be used within SessionProtectionProvider');
  }
  return subagentRunningSessionIds;
}

/**
 * The running runs the server knows about, each with the project it belongs to.
 *
 * Consumers that list running work read this rather than filtering the sessions
 * they have already loaded — the server's registry is the only place that knows
 * every run.
 */
export function useRunningSessions(): readonly RunningSessionListItem[] {
  return useContext(RunningSessionsContext);
}

export function useProcessingSessions(): SessionActivityMap {
  const processingSessions = useContext(SessionProtectionStateContext);
  if (!processingSessions) {
    throw new Error('useProcessingSessions must be used within SessionProtectionProvider');
  }
  return processingSessions;
}

export function useSessionProtectionActions(): SessionProtectionActions {
  const actions = useContext(SessionProtectionActionsContext);
  if (!actions) {
    throw new Error('useSessionProtectionActions must be used within SessionProtectionProvider');
  }
  return actions;
}
