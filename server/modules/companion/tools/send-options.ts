import { sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import { CLAUDE_MODEL_VALUE_BY_ALIAS, type ClaudeModelAlias } from '@/modules/providers/index.js';
import { isRecord } from '@/shared/document-fields.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * What a send she relays runs with, read the way the chat's own composer would have read it, so a brief she sends is
 * the turn he would have typed there and not a turn on defaults:
 *   - `model`, `effort` and `permissionMode`: the chat's own (`sessions.model`, `.effort`, `.permission_mode`). One the
 *     chat records none of is left out, as its composer would leave it to the default: the permission mode in
 *     particular is never borrowed from another chat for a chat that exists (a probe chat whose chip reads "Ask before
 *     every edit" must not run in bypass because the last chat he used did);
 *   - a `model` she CHOSE for this turn (one of the house's names, `CLAUDE_MODEL_VALUE_BY_ALIAS`) replaces the chat's own
 *     and wins over what is stored; the effort stays the chat's, which the runtime checks against the model the turn runs
 *     on and drops when that model has no such level. The turn records the model it ran on as the chat's from then on
 *     (`dispatchRun`, the one door every turn goes through);
 *   - a NEW chat has no choices of its own yet, so it has NO effort and takes the model she chose or none: the account's
 *     default is the caller's to name (`readAccountDefaultModelAlias`), because a turn sent with no model runs on the
 *     runtime's own default (`opus[1m]`), not on the account's. It does not borrow another chat's model or effort: a
 *     model chosen by what he happened to be working on last is not the model she chose for this brief. The permission
 *     mode of a new chat is the most recent of that provider (`latestPermissionMode`);
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

/**
 * What a send says besides the chat it goes to. `model` is the house's name she chose for this turn (the Claude family names;
 * the sender refuses it for another provider's chat before it gets here). `newChatName` is the name of a chat made just now,
 * which the notification for its first turn quotes. Consumed by `companion-send.ts`.
 */
export type SendBasis = { model?: ClaudeModelAlias; newChatName?: string };

/** What the composer sends when he has set no permissions: no rules, nothing skipped. */
const NO_TOOL_RULES = { allowedTools: [], disallowedTools: [], skipPermissions: false };

/** The model and effort a row of `provider` records, or null when it records no model (or the row is another provider's: its model is not this provider's to run). */
function recordedChoice(sessionId: string | null, provider: LLMProvider): { model: string; effort: string | null } | null {
  const row = sessionId === null ? undefined : sessionsDb.getSessionById(sessionId);
  return row?.model && row.provider === provider ? { model: row.model, effort: row.effort } : null;
}

/**
 * The options for a send to the chat `sessionId`, as `provider`; or, with `null`, for a chat made just now (`basis.newChatName`
 * is what it is called). `basis.model` replaces the model either way.
 *
 * Consumed by `companion-send.ts`: a chat that exists asks with its id, a new chat with `null` after it is made and named.
 */
export function sendOptionsFor(userId: number, sessionId: string | null, provider: LLMProvider, basis: SendBasis = {}): ChatSendOptions {
  const row = sessionId === null ? undefined : sessionsDb.getSessionById(sessionId);
  const recorded = recordedChoice(sessionId, provider);
  const model = basis.model ? CLAUDE_MODEL_VALUE_BY_ALIAS[basis.model] : recorded?.model;
  const permissionMode = sessionId === null ? sessionsDb.latestPermissionMode(provider) : row?.permission_mode;
  const stored = userPreferencesDb.getPreferences(userId)[`${provider}Permissions`];
  const toolsSettings = isRecord(stored) ? stored : NO_TOOL_RULES;

  return {
    ...(model ? { model, ...(recorded?.effort ? { effort: recorded.effort } : {}) } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    toolsSettings,
    skipPermissions: toolsSettings.skipPermissions === true,
    sessionSummary: sessionId === null ? basis.newChatName ?? '' : row?.custom_name ?? '',
  };
}
