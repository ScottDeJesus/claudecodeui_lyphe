import { sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import { isRecord } from '@/shared/document-fields.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * What a send she relays runs with, read the way the chat's own composer would have read it, so a brief she sends is
 * the turn he would have typed there and not a turn on defaults:
 *   - `model`, `effort` and `permissionMode`: the chat's own (`sessions.model`, `.effort`, `.permission_mode`). One the
 *     chat records none of is left out, as its composer would leave it to the default: the permission mode in
 *     particular is never borrowed from another chat for a chat that exists (a probe chat whose chip reads "Ask before
 *     every edit" must not run in bypass because the last chat he used did);
 *   - a NEW chat has no choices of its own yet, so it takes the focus chat's model and effort when a focus is held, else
 *     the most recent recorded on any chat of the same provider (`latestModelChoice`) — a chat with none runs on the catalog's default, which
 *     is not the model he has been working with — and the most recent permission mode of that provider (`latestPermissionMode`);
 *   - `toolsSettings` and `skipPermissions`: his provider permissions, read from the preference NOW (never a copy taken
 *     earlier), so a rule he added a minute ago governs this turn;
 *   - `sessionSummary`: the chat's name, which the notification for the turn quotes.
 *
 * Consumer: `companion-send.ts`, which hands the result to the run as the send's options.
 */

/** The options of one relayed send. Consumed by `companion-send.ts`. */
export type ChatSendOptions = {
  model?: string;
  effort?: string;
  permissionMode?: string;
  toolsSettings: Record<string, unknown>;
  skipPermissions: boolean;
  sessionSummary: string;
};

/** A chat made just now: the chat the conversation is about (its model and effort are borrowed) and the name it was given. Consumed by `companion-send.ts`, whose new-chat send builds one from the focus and the title. */
export type NewChatBasis = { focusSessionId: string | null; name: string };

/** What the composer sends when he has set no permissions: no rules, nothing skipped. */
const NO_TOOL_RULES = { allowedTools: [], disallowedTools: [], skipPermissions: false };

/** The model and effort a row of `provider` records, or null when it records no model (or the row is another provider's: its model is not this provider's to run). */
function recordedChoice(sessionId: string | null, provider: LLMProvider): { model: string; effort: string | null } | null {
  const row = sessionId === null ? undefined : sessionsDb.getSessionById(sessionId);
  return row?.model && row.provider === provider ? { model: row.model, effort: row.effort } : null;
}

/**
 * The options for a send to the chat `sessionId`, as `provider`; or, with `null`, for a chat made just now (`newChat`
 * says which chat it takes its model from and what it is called).
 *
 * Consumed by `companion-send.ts`: a chat that exists asks with its id, a new chat with `null` after it is made and named.
 */
export function sendOptionsFor(
  userId: number,
  sessionId: string | null,
  provider: LLMProvider,
  newChat: NewChatBasis = { focusSessionId: null, name: '' }
): ChatSendOptions {
  const row = sessionId === null ? undefined : sessionsDb.getSessionById(sessionId);
  const choice = sessionId === null ? recordedChoice(newChat.focusSessionId, provider) ?? sessionsDb.latestModelChoice(provider) : recordedChoice(sessionId, provider);
  const permissionMode = sessionId === null ? sessionsDb.latestPermissionMode(provider) : row?.permission_mode;
  const stored = userPreferencesDb.getPreferences(userId)[`${provider}Permissions`];
  const toolsSettings = isRecord(stored) ? stored : NO_TOOL_RULES;

  return {
    ...(choice ? { model: choice.model, ...(choice.effort ? { effort: choice.effort } : {}) } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    toolsSettings,
    skipPermissions: toolsSettings.skipPermissions === true,
    sessionSummary: sessionId === null ? newChat.name : row?.custom_name ?? '',
  };
}
