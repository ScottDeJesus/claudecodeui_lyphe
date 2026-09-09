import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import {
  useSessionProtection,
} from '@/shared/hooks/useSessionProtection';
import type { IsSessionProcessing, LLMProvider, MarkSessionIdle, MarkSessionProcessing, RunningSessionListItem, SessionActivityMap, SyncProcessingSessions } from '@/shared/types';
import { api } from '@/shared/api';

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
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

type SessionProtectionActions = {
  markSessionProcessing: MarkSessionProcessing;
  markSessionIdle: MarkSessionIdle;
  syncProcessingSessions: SyncProcessingSessions;
  isSessionProcessing: IsSessionProcessing;
};

const NO_RUNNING_SESSIONS: readonly RunningSessionListItem[] = [];

const SessionProtectionStateContext = createContext<SessionActivityMap | null>(null);
const SessionProtectionActionsContext = createContext<SessionProtectionActions | null>(null);
const BusySessionIdsContext = createContext<ReadonlySet<string> | null>(null);
const RunningSessionsContext = createContext<readonly RunningSessionListItem[]>(NO_RUNNING_SESSIONS);

const asOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Keeps the previous array when the poll returned the same runs, so a five-second
 * refresh does not re-render every consumer while nothing has changed.
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
      && item.provider === other.provider;
  });

/**
 * The set of session ids currently producing a response, with a stable identity
 * while membership is unchanged.
 *
 * Every provider `status` frame rewrites an entry's `statusText`, which
 * allocates a new activity map several times a second during a run. Consumers
 * that only need membership — the sidebar renders a dot per row and a running
 * count — would re-render on all of it.
 */
function useBusySessionIds(processingSessions: SessionActivityMap): ReadonlySet<string> {
  // Deriving the set from a membership key, rather than from the map, keeps its
  // identity stable across the `statusText` rewrites without reading a ref
  // during render. Session ids never contain a NUL, so it is a safe separator.
  const membershipKey = [...processingSessions.keys()].sort().join('\u0000');

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

  const refreshRunningSessions = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

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
          });
          return acc;
        }, []);

        return runningSessionListsMatch(previous, next) ? previous : next;
      });

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
      );
    } catch (error) {
      console.error('[SessionProtection] Failed to sync running sessions:', error);
    }
  }, [syncProcessingSessions]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 5000);

    return () => window.clearInterval(interval);
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

  const busySessionIds = useBusySessionIds(processingSessions);

  return (
    <SessionProtectionActionsContext.Provider value={actions}>
      <BusySessionIdsContext.Provider value={busySessionIds}>
        <RunningSessionsContext.Provider value={runningSessions}>
          <SessionProtectionStateContext.Provider value={processingSessions}>
            {children}
          </SessionProtectionStateContext.Provider>
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
