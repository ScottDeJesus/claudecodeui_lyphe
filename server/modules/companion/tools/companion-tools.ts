import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionPhase, CompanionSessionRef } from '@/shared/companion-types.js';
import type { ToolTextResult } from '@/shared/tool-text-result.js';

import type { DraftSender } from '../companion-send.js';
import type { CompanionStore } from '../companion-store.js';
import { toolNames } from '../session/companion-prompt.js';

import { actTools } from './act-tools.js';
import { draftTools } from './draft-tools.js';
import { readTools } from './read-tools.js';
import { sessionTools } from './session-tools.js';

/**
 * The registry of her tools: the one place that says what she holds and what every tool file is handed.
 *
 * She has thirteen tools, named in her prompt's TOOLS section and in that order (`COMPANION_TOOL_NAMES`). The
 * definitions live in the tool files beside this one, each built with the SDK's `tool()` and zod, and
 * `buildCompanionTools` concatenates the files that exist — a later phase adds its file's line to it, and the
 * session's `init` check (`unexpectedTools`) compares the CLI's list against what is built here, so a tool
 * built and not listed, or listed and not built, is not hers to hold.
 *
 * WHAT THE DEPS ARE FOR. A tool file takes the account, its store, the runtime gateway and three helpers the
 * harness supplies rather than each tool doing for itself, so every tool behaves the same way:
 *   - `setFocus`: a tool that names a chat makes it her FOCUS. The harness infers it; there is no focus tool;
 *   - `withActivity`: while a tool runs it sets her activity (what the panel's status line says), and when
 *     the tool ends she is `thinking` again;
 *   - `openChatOnFloor`: "the app focuses that chat" happens on the page that holds the floor alone;
 *   - `refuse`: a refusal is `isError` text that says what to do next, never a throw.
 *
 * Consumers: `companion-account.ts` (builds the deps and the definitions for one account's session) and every
 * tool file of this folder (they take `CompanionToolDeps`).
 */

/**
 * The name her in-process MCP server is registered under; the SDK prefixes every tool with `mcp__<name>__`.
 * Defined beside the launch options that register it (`session/companion-launch.ts`, which names the tools
 * `allowedTools` lists), and re-exported here as the tools' own public name. Consumed by `.verify/companion-module.mjs`,
 * which reads her tool calls back out of her transcript by it.
 */
export { COMPANION_MCP_SERVER_NAME } from '../session/companion-launch.js';

/**
 * The thirteen names of her tools, in the order her prompt's TOOLS section lists them. Derived from the
 * prompt, so the list and the text she reads cannot differ. Consumed by `.verify/companion-module.mjs`, which
 * prints the names told beside the definitions built — the gap is the tool files the later phases add.
 */
export const COMPANION_TOOL_NAMES: readonly string[] = toolNames();

/**
 * The activities a tool may set: the ones that say what she is looking at. `idle` and `thinking` are the turn's
 * own. Consumed by `CompanionToolDeps.withActivity` below, whose `phase` it types — so by every tool file that
 * sets an activity — and by `tool-deps.ts`, which implements it.
 */
export type ToolActivityPhase = Exclude<CompanionPhase, 'idle' | 'thinking'>;

/**
 * Everything a tool file is handed for one account. `userId` is the account; `store` her record of it (the
 * draft, the walk, the notes, the log); `runtime` the gateway a chat is stopped, answered or sent to through.
 * `withActivity` sets her activity to `phase` about `chat` and `files` (each `null` when the phase has no such
 * subject) for as long as `run` takes, then puts her back to `thinking` (or to a parallel tool still running) — unless
 * the turn ended meanwhile (she was stopped), in which case the turn's own `idle` stands. `openChatOnFloor` is a no-op while no page holds
 * the floor. Consumed by every tool file of this folder; built by `companion-account.ts`.
 */
export type CompanionToolDeps = {
  userId: number;
  store: CompanionStore;
  runtime: ProviderRuntimeGateway;
  setFocus(chat: CompanionSessionRef): void;
  withActivity<T>(phase: ToolActivityPhase, chat: CompanionSessionRef | null, files: string[] | null, run: () => Promise<T>): Promise<T>;
  openChatOnFloor(sessionId: string): void;
  refuse(sentence: string): ToolTextResult;
  /** Sends the held draft as it stands (`companion-send.ts`): the one door `send_to_session` and `create_session` go through. */
  sendDraft: DraftSender;
};

/**
 * Her tools for one account: the definitions of every tool file that exists. Today that is `sessionTools()`
 * (`list_sessions`, `list_projects`), which names no chat and so needs no deps, `draftTools(deps)`
 * (`show_note`, `update_draft`, `walk`), `readTools(deps)` (`read_session`, `list_followups`, `ask_dactyl`)
 * and `actTools(deps)` (`stop_session`, `rename_session`, `answer_session`); each later tool file adds a line here
 * and takes `deps`. Consumed by `companion-account.ts`,
 * once per account.
 */
export function buildCompanionTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [...sessionTools(), ...readTools(deps), ...draftTools(deps), ...actTools(deps)];
}
