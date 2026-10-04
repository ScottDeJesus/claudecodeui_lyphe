// The one spelling of "the newest conversation" — which timestamp a session is dated by, and the
// order a project's sessions are listed in. Two modules read this rule: the sidebar's lists, and
// project-workspace's `openProjectChat`, which answers a project's newest conversation. It lives in
// shared because a second copy would drift from the first, and then the sidebar's top row and the
// conversation a door opens would be two different sessions.
import type {
  LLMProvider,
  Project,
  ProjectSession,
  SessionWithProvider,
} from '@/shared/types';

/** Used by the sidebar to date a session that has no activity yet; the fallback of `getSessionDate` and `getSessionTime`. */
export const getCreatedTimestamp = (session: SessionWithProvider): string => {
  return String(session.createdAt || session.created_at || '');
};

/** Used by the sidebar's row time and `getSessionDate`: the session's last activity, empty when it has none. */
export const getUpdatedTimestamp = (session: SessionWithProvider): string => {
  return String(session.lastActivity || '');
};

/** Used by `getAllSessions` and by project-workspace's session normaliser to name the provider a session runs on; a session that names none is a Claude one. */
export const getSessionProvider = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim()
    ? provider as LLMProvider
    : 'claude';
};

/** Used by the sidebar's session rows, its project ordering and `getAllSessions`: when a session was last alive, by activity and then by creation. */
export const getSessionDate = (session: SessionWithProvider): Date => {
  return new Date(getUpdatedTimestamp(session) || getCreatedTimestamp(session) || 0);
};

/**
 * Cached against the project object, not its id.
 *
 * Every sidebar render asks for each project's sessions, and this builds a new
 * array of new session objects. Without the cache the array is a different
 * reference each time, which is enough on its own to defeat the memo boundary
 * on every project and session row. `useProjectsState` always replaces a
 * project rather than mutating it, so a stale entry is unreachable: a changed
 * project is a different key.
 */
const sortedSessionsByProject = new WeakMap<Project, SessionWithProvider[]>();

/** Used by the sidebar's project tree and controller, and by project-workspace's `openProjectChat`: a project's sessions, newest first, each tagged with its provider. Index 0 is "the newest conversation". */
export const getAllSessions = (project: Project): SessionWithProvider[] => {
  const cached = sortedSessionsByProject.get(project);
  if (cached) {
    return cached;
  }

  const sessions = (project.sessions || []).map((session) => ({
    ...session,
    __provider: getSessionProvider(session),
  })).sort(
    (a, b) => getSessionDate(b).getTime() - getSessionDate(a).getTime(),
  );

  sortedSessionsByProject.set(project, sessions);
  return sessions;
};
