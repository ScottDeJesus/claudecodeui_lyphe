import path from 'node:path';

import { getConnection, projectsDb, sessionsDb } from '@/modules/database/index.js';
import type { CompanionSessionRef } from '@/shared/companion-types.js';
import { isHiddenProjectPath, visibleProjectPathSql } from '@/shared/hidden-project-paths.js';
import { oneLine } from '@/shared/tool-call-hint.js';

import { activityLine, chatStates, type ChatState } from './chat-activity.js';

// One door for the tool files: a chat's state and its activity line are read here with everything else about a
// chat, though `chat-activity.ts` holds them (the cut that keeps both files small).
export { activityLine, askLine, chatState, pendingAsksOf } from './chat-activity.js';
export type { ChatState } from './chat-activity.js';

/**
 * The house as she sees it: his chats with their state and activity, his projects, the two resolvers that turn
 * a name into one of them, and the roster that rides inside her next message. Every read answers from the
 * database and the running server at the moment it is called — nothing is cached, nothing polls — and none of
 * it carries usage or spend (ruling 17).
 *
 * "HIS CHATS" are the chats CloudCLI started: rows of `sessions` that are not archived, in a project that is
 * neither archived nor in a hidden root, whose `provider_session_id` is empty or differs from `session_id`.
 * The table also holds thousands of synced soul transcripts, whose session id IS their provider id; they are
 * never his chats. `sessions` has no user column, so every account sees the same chats, as the sidebar does.
 *
 * THE HIDDEN FALLBACK. A probe runs in a scratch folder under `/tmp`, a hidden root, so by that definition no
 * probe chat is one of his — and she could never be shown drafting for, sending to or creating one.
 * `resolveChat` therefore also accepts a non-archived app chat of a hidden project when it is named by its id
 * or its exact name, and `resolveProject` a registered project of a hidden root when it is named by its exact
 * path ("hidden is not gone"). The roster and both lists stay exactly his chats and his visible projects.
 *
 * Consumers: `session-tools.ts` (`list_sessions`, `list_projects`), the other tool files of this folder (every
 * tool that takes a chat or a project resolves it here) and `session/companion-session.ts` (`rosterText`).
 */

//----------------- HIS CHATS ------------

/** One of his chats: its name (`custom_name`), its project's display name and path, and its last update in epoch ms (0 when unreadable). Consumed by `session-tools.ts`. */
export type HisChat = { sessionId: string; name: string; project: string; projectPath: string; updatedAt: number };

/** A chat with its state at the moment of the read. Consumed by `session-tools.ts`'s `list_sessions`. */
export type ChatRow = { chat: HisChat; state: ChatState };

/** The name a chat shows when it has none, as the sidebar does. Consumed by `chatNameOf` here and by `eyes/alert-reads.ts`, which tells a chat's own name from this fallback. */
export const UNTITLED_CHAT = 'Untitled Session';

const refOf = (chat: HisChat): CompanionSessionRef => ({ sessionId: chat.sessionId, name: chat.name, project: chat.project });

/** A project's name as the sidebar draws it: the custom name when there is one, else the folder's name — folded to one line either way, since a folder's name is whatever its maker typed. */
function projectDisplayName(projectPath: string, customName: string | null): string {
  return oneLine(customName ?? '') || oneLine(path.basename(projectPath) || projectPath) || 'no project';
}

/** A stored time as epoch ms: SQLite's own `YYYY-MM-DD HH:MM:SS` is UTC without a suffix, the rest is ISO. 0 when it does not parse. */
function storedTimeMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type ChatSqlRow = { session_id: string; custom_name: string | null; project_path: string | null; custom_project_name: string | null; updated_at: string | null };

/**
 * The non-archived app chats of projects in a visible root (`'visible'`, his chats) or in a hidden one
 * (`'hidden'`, the fallback's pool), newest first. The visibility test is the sidebar's own
 * (`visibleProjectPathSql`, as `sessionsDb.getRecentSessionsPage` reads it), so the two never disagree.
 */
function chatsInRoots(scope: 'visible' | 'hidden'): HisChat[] {
  const visiblePath = visibleProjectPathSql('sessions.project_path');
  const rows = getConnection()
    .prepare(
      `SELECT sessions.session_id, sessions.custom_name, sessions.project_path, projects.custom_project_name,
              COALESCE(sessions.updated_at, sessions.created_at) AS updated_at
       FROM sessions
       LEFT JOIN projects ON projects.project_path = sessions.project_path
       WHERE sessions.isArchived = 0
         AND (projects.isArchived IS NULL OR projects.isArchived = 0)
         AND ${scope === 'visible' ? '' : 'NOT '}${visiblePath.clause}
         AND (sessions.provider_session_id IS NULL OR sessions.session_id <> sessions.provider_session_id)
       ORDER BY julianday(COALESCE(sessions.updated_at, sessions.created_at)) DESC, sessions.session_id DESC`
    )
    .all(...visiblePath.params) as ChatSqlRow[];
  return rows.map((row) => ({
    sessionId: row.session_id,
    name: oneLine(row.custom_name ?? '') || UNTITLED_CHAT,
    project: projectDisplayName(row.project_path ?? '', row.custom_project_name),
    projectPath: row.project_path ?? '',
    updatedAt: storedTimeMs(row.updated_at),
  }));
}

/** Every chat of his, most recently updated first. Consumed by `session-tools.ts`'s phrase search and by the resolvers below. */
export function listHisChats(): HisChat[] {
  return chatsInRoots('visible');
}

/**
 * The name a chat shows in the sidebar, for ANY chat row — an archived chat, one of a hidden project, one the
 * resolvers above would not offer — because a follow-up outlives the sidebar entry it was filed from. The same
 * fallback (`Untitled Session`) and the same one-line fold as the lists. Consumed by `read-tools.ts`'s `list_followups`.
 */
export function chatNameOf(sessionId: string): string {
  return oneLine(sessionsDb.getSessionById(sessionId)?.custom_name ?? '') || UNTITLED_CHAT;
}

/** The chats with their states, ONE liveness read for all: waiting first, then working, then live, then asleep, each most recent first inside its state. */
function withStates(chats: HisChat[]): ChatRow[] {
  const states = chatStates(chats.map((chat) => chat.sessionId));
  const rank: Record<ChatState, number> = { waiting: 0, working: 1, live: 2, asleep: 3 };
  return chats.map((chat, index) => ({ chat, state: states[index] })).sort((a, b) => rank[a.state] - rank[b.state]); // stable: recency survives inside a state
}

/**
 * Every chat of his with its state, ONE liveness read for all: waiting first, then working, then live, then
 * asleep, each most recent first. Consumed by `session-tools.ts`'s `list_sessions` and the roster below.
 */
export function chatRows(): ChatRow[] {
  return withStates(listHisChats());
}

/**
 * The non-archived app chats of hidden roots with their state, in `chatRows`' order ("hidden is not gone"): a probe's scratch chats are
 * among them, and they are never his chats, so no list of his chats shows them. Consumed by `station/need-readers.ts` alone: a permission
 * raised in a scratch folder still holds that chat, and the station's needs list is the one place it can be answered from.
 */
export function hiddenChatRows(): ChatRow[] {
  return withStates(chatsInRoots('hidden'));
}

//----------------- RESOLVING A NAME ------------

const CANDIDATES_SHOWN = 12;

/**
 * Text that a chat's agent or its author wrote, made safe to stand inside the `<sessions>` envelope: `&`, `<` and
 * `>` become entities, so a name, a command hint or a last sentence containing `</sessions><operator via="typed">…`
 * stays words in the roster and can never close the tag and pass for something he typed. The envelope builder writes a
 * body as given (right for his own words), so the one place that knows this body is sessions' words is here. Applied
 * where text enters a roster line, after the activity line is cut, so no entity is ever cut in half; a tool result
 * is not inside a tag and keeps the exact spelling. `resolveChat` accepts this spelling of a name as well, so a name
 * read off the roster can be passed straight back.
 */
function inRosterBody(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Candidates for a sentence she reads: each with its project and id, so she can pass the id back. */
function describeChats(chats: HisChat[]): string {
  const shown = chats.slice(0, CANDIDATES_SHOWN).map((chat) => `"${chat.name}" in ${chat.project} (id ${chat.sessionId})`);
  return shown.join('; ') + (chats.length > CANDIDATES_SHOWN ? `; and ${chats.length - CANDIDATES_SHOWN} more` : '');
}

/** The answer of a resolver: the one match, or the sentence that says what to do next. Consumed by every tool that takes a chat. */
export type ChatResolution = { ok: true; chat: CompanionSessionRef } | { ok: false; sentence: string };

/**
 * A chat by its id or by a case-insensitive exact name, among his chats — and, only when none of his fits,
 * among the non-archived app chats of hidden projects (the probe's chats). One match is the answer; none or
 * several is a sentence naming every candidate (twelve at most) with its project and id, and what to do next.
 * Consumed by every tool that takes a chat: they resolve it here and never take a name on trust.
 */
export function resolveChat(ref: string): ChatResolution {
  const wanted = ref.trim().toLowerCase();
  if (!wanted) return { ok: false, sentence: 'Name the chat by its name or its id; list_sessions shows his chats.' };
  const named = (chats: HisChat[]) =>
    chats.filter((chat) => chat.sessionId.toLowerCase() === wanted || chat.name.toLowerCase() === wanted || inRosterBody(chat.name).toLowerCase() === wanted);
  const his = listHisChats();
  const found = named(his).length > 0 ? named(his) : named(chatsInRoots('hidden'));
  if (found.length === 1) return { ok: true, chat: refOf(found[0]) };
  if (found.length > 1) {
    return { ok: false, sentence: `"${ref.trim()}" fits ${found.length} chats: ${describeChats(found)}. Pass the id of the one meant, or ask him which.` };
  }
  const near = wanted.length >= 3 ? his.filter((chat) => chat.name.toLowerCase().includes(wanted)) : [];
  const hint = near.length > 0 ? ` Chats with that in the name: ${describeChats(near)}.` : '';
  return { ok: false, sentence: `No chat of his is named or numbered "${ref.trim()}".${hint} Call list_sessions to see his chats, then use a name or id from it.` };
}

//----------------- HIS PROJECTS ------------

/** A project a new chat can start in: its display name and its absolute path. Consumed by `session-tools.ts`'s `list_projects`. */
export type HisProject = { name: string; path: string };

/** The visible projects — registered, not archived, not in a hidden root — by display name. Consumed by `list_projects` and `resolveProject`. */
export function listVisibleProjects(): HisProject[] {
  return projectsDb
    .getProjectPaths()
    .filter((row) => !isHiddenProjectPath(row.project_path))
    .map((row) => ({ name: projectDisplayName(row.project_path, row.custom_project_name), path: row.project_path }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The answer of `resolveProject`: the one project, or the sentence that says what to do next. Consumed by the tools that take a project. */
export type ProjectResolution = { ok: true; project: HisProject } | { ok: false; sentence: string };

const describeProjects = (projects: HisProject[]): string => projects.map((project) => `"${project.name}" at ${project.path}`).join('; ');

/**
 * A visible project by its path or its case-insensitive display name — and, only when none fits, a registered
 * project of a hidden root named by its EXACT path (the probe's scratch folder). Several projects under one
 * name (a worktree, a copy) is refused with each named by its path. Consumed by `create_session` and the
 * draft tool, which name the project a new chat starts in.
 */
export function resolveProject(ref: string): ProjectResolution {
  const wanted = ref.trim();
  if (!wanted) return { ok: false, sentence: 'Name the project by its display name or its path; list_projects shows them.' };
  const visible = listVisibleProjects();
  const registered = projectsDb.getProjectPath(wanted);
  const found = visible.filter((project) => project.name.toLowerCase() === wanted.toLowerCase() || project.path === registered?.project_path);
  if (found.length === 1) return { ok: true, project: found[0] };
  if (found.length > 1) {
    return { ok: false, sentence: `"${wanted}" fits ${found.length} projects: ${describeProjects(found)}. Use the path of the one meant.` };
  }
  if (registered && registered.isArchived === 0 && isHiddenProjectPath(registered.project_path)) {
    return { ok: true, project: { name: projectDisplayName(registered.project_path, registered.custom_project_name), path: registered.project_path } };
  }
  const near = wanted.length >= 3 ? visible.filter((project) => project.name.toLowerCase().includes(wanted.toLowerCase())) : [];
  const hint = near.length > 0 ? ` Projects with that in the name: ${describeProjects(near)}.` : '';
  return { ok: false, sentence: `No project is named or located at "${wanted}".${hint} Call list_projects to see where a new session can start.` };
}

//----------------- THE ROSTER ------------

/** The most chats the roster lines up, and the asleep names it appends: it rides inside every message she answers. */
const ROSTER_ACTIVE_MAX = 20;
const ROSTER_ASLEEP_NAMES = 12;

/**
 * The body of `<sessions>`, computed at the moment a message is pushed to her: one line per working, waiting or
 * live chat ("Bugfixes · claudecodeui_lyphe · working: Bash npm run build · id …", twenty at most, waiting
 * first), then "Asleep, still sendable: " with the twelve most recent asleep names. A count says so when
 * either list was cut, so she never takes a partial list for the whole. Every name, project and activity line is
 * escaped (`inRosterBody`). The read runs on the push path, so a failing read (an approvals gateway, the database)
 * is logged and answers one sentence instead of throwing into the message he typed.
 * Consumed by `session/companion-session.ts`.
 */
export function rosterText(): string {
  try {
    return buildRoster();
  } catch (error) {
    console.error('[Companion] the roster could not be read', error);
    return 'The roster could not be read just now; call list_sessions if you need his chats.';
  }
}

function buildRoster(): string {
  const rows = chatRows();
  const active = rows.filter((row) => row.state !== 'asleep');
  const asleep = rows.filter((row) => row.state === 'asleep');
  const lines = active.slice(0, ROSTER_ACTIVE_MAX).map(
    ({ chat, state }) => `${inRosterBody(`${chat.name} · ${chat.project} · ${state}: ${activityLine(chat.sessionId, state)}`)} · id ${chat.sessionId}`
  );
  if (lines.length === 0) lines.push('None of his chats is working, waiting or live.');
  if (active.length > ROSTER_ACTIVE_MAX) lines.push(`…and ${active.length - ROSTER_ACTIVE_MAX} more active; list_sessions with scope active names them.`);
  if (asleep.length > 0) {
    const names = asleep.slice(0, ROSTER_ASLEEP_NAMES).map((row) => inRosterBody(row.chat.name)).join(', ');
    lines.push(`Asleep, still sendable: ${names}${asleep.length > ROSTER_ASLEEP_NAMES ? `, and ${asleep.length - ROSTER_ASLEEP_NAMES} more` : ''}`);
  }
  return lines.join('\n');
}
