import type { StationSession } from '@/shared/station-types.js';

import { activityLine, chatRows } from '../tools/house-reads.js';

/**
 * His chats as the station's left rail draws them: the very rows her roster is made of, so what he sees is what she sees. The
 * chats are `chatRows()`'s (his app chats, not archived, not in a hidden root), in its order (waiting, then working, then live,
 * then asleep, most recent first inside each state), and each carries `activityLine()`'s one line. The station adds no reading
 * of its own: a chat is never read here any other way, and a name, project or line is served as the house reads it, unescaped
 * (the roster's entity escaping guards a tag she reads, which a JSON field is not).
 *
 * `state` keeps the house's words; the page says "idle" for `live`. `updatedAt` is the chat's last update as ISO, `null` for a
 * chat whose time did not parse (`chatRows` reads it as 0). One liveness snapshot and the registry's in-memory reads, so the
 * read is cheap enough to answer every hint. It throws when the database or the approvals gateway cannot be read; the route
 * answers that. Consumed by `sessions.routes.ts`.
 */
export function stationSessions(): StationSession[] {
  return chatRows().map(({ chat, state }) => ({
    sessionId: chat.sessionId,
    name: chat.name,
    project: chat.project,
    state,
    activity: activityLine(chat.sessionId, state),
    updatedAt: chat.updatedAt > 0 ? new Date(chat.updatedAt).toISOString() : null,
  }));
}
