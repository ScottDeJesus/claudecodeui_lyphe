import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionOpenTarget, CompanionPhase, CompanionSessionRef } from '@/shared/companion-types.js';
import type { ToolTextResult } from '@/shared/tool-text-result.js';

import type { DraftSender } from '../companion-send.js';
import type { CompanionStore } from '../companion-store.js';
import { alertReads } from '../eyes/alert-reads.js';
import { docReads } from '../eyes/doc-reads.js';
import { houseReads } from '../eyes/house-reads.js';
import { panelReads } from '../eyes/panel-reads.js';
import { roadmapReads } from '../eyes/roadmap-reads.js';
import { runReads } from '../eyes/run-reads.js';
import { handsTools } from '../hands/hands-tools.js';
import type { CompanionHouse } from '../house.js';
import { toolNames } from '../session/companion-prompt.js';

import { actTools } from './act-tools.js';
import { draftTools } from './draft-tools.js';
import { readTools } from './read-tools.js';
import { sessionTools } from './session-tools.js';

/**
 * The registry of her tools: the one place that says what she holds and what every tool file is handed.
 *
 * Her tools are the ones her prompt's TOOLS section names, listed in the prompt's order by `COMPANION_TOOL_NAMES` (the
 * order the definitions are BUILT in is `buildCompanionTools`' below, and nothing reads it). The definitions live in
 * the tool files beside this one and in the eyes' (`../eyes/*-reads.ts`), each built with the SDK's `tool()` and zod, and
 * `buildCompanionTools` concatenates them. A tool built without its line in the prompt's TOOLS section fails that
 * account's first use (`toolLine` throws inside `createCompanionAccount`, and the account is not stored), and the
 * session's `init` check (`unexpectedTools`) ends a launch
 * whose CLI lists a tool that is not built here, so what she holds is exactly what is built.
 *
 * WHAT THE DEPS ARE FOR. A tool file takes the account, its store, the runtime gateway, the house and three helpers the
 * harness supplies rather than each tool doing for itself, so every tool behaves the same way:
 *   - `setFocus`: a tool that names a chat makes it her FOCUS. The harness infers it; there is no focus tool;
 *   - `withActivity`: while a tool runs it sets her activity (what the panel's status line says), and when
 *     the tool ends she is `thinking` again;
 *   - `openOnFloor`: "the app brings that chat, card or page up" happens on the page that holds the floor alone;
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
 * The names of her tools, in the order her prompt's TOOLS section lists them. Derived from the prompt, so the list and
 * the text she reads cannot differ. Consumed by `.verify/companion-module.mjs`, which prints the names told beside the
 * definitions built.
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
 * draft, the walk, the notes, the log); `runtime` the gateway a chat is stopped, answered or sent to through;
 * `house` the readers only a module instance holds (the roadmap and dispatcher pictures, a card's text, the souls lane's
 * launches, Cerberus's overview and the heal service), built by the server entrypoint and the same for every account
 * (`house.ts`). A read through the house moves no activity of hers: an eyes read runs as `thinking`.
 * `withActivity` sets her activity to `phase` about `chat` and `files` (each `null` when the phase has no such
 * subject) for as long as `run` takes, then puts her back to `thinking` (or to a parallel tool still running) — unless
 * the turn ended meanwhile (she was stopped), in which case the turn's own `idle` stands. `openOnFloor` sends `companion_open` for
 * `target` to the page that holds the floor, and is a no-op while no page holds it. Consumed by every tool file of this folder; built
 * by `companion-account.ts`.
 */
export type CompanionToolDeps = {
  userId: number;
  store: CompanionStore;
  runtime: ProviderRuntimeGateway;
  house: CompanionHouse;
  setFocus(chat: CompanionSessionRef): void;
  withActivity<T>(phase: ToolActivityPhase, chat: CompanionSessionRef | null, files: string[] | null, run: () => Promise<T>): Promise<T>;
  openOnFloor(target: CompanionOpenTarget): void;
  refuse(sentence: string): ToolTextResult;
  /** Sends the held draft as it stands (`companion-send.ts`): the one door `send_to_session` and `create_session` go through. */
  sendDraft: DraftSender;
};

/**
 * Her tools for one account, built group by group in the order below (the names and their order, as she is told them, are
 * `COMPANION_TOOL_NAMES`): `sessionTools()` (`list_sessions`, `list_projects`), which
 * names no chat and so needs no deps, `readTools(deps)` (`read_session`, `list_followups`, `ask_dactyl`), `draftTools(deps)`
 * (`show_note`, `dismiss_note`, `update_draft`, `walk`, `send_to_session`, `create_session`), `actTools(deps)` (`stop_session`,
 * `rename_session`, `answer_session`), then the eyes (`eyes/*-reads.ts`): `roadmapReads(deps)` (`list_roadmap`, `read_card`),
 * `runReads(deps)` (`list_runs`, `read_run`), `docReads(deps)` (`search_docs`, `read_doc`),
 * `alertReads(deps)` (`list_alerts`), `panelReads(deps)` (`read_kanban`, `read_heal`, `read_notes`, `read_schedules`),
 * `houseReads(deps)` (`read_git`, `read_cerberus`, `read_memory`, `read_settings`), and last her hands (`hands/hands-tools.ts`):
 * `handsTools(deps)` (`prepare_action`, `take_action`, `cancel_action`). Consumed by
 * `companion-account.ts`, once per account.
 */
export function buildCompanionTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    ...sessionTools(),
    ...readTools(deps),
    ...draftTools(deps),
    ...actTools(deps),
    ...roadmapReads(deps),
    ...runReads(deps),
    ...docReads(deps),
    ...alertReads(deps),
    ...panelReads(deps),
    ...houseReads(deps),
    ...handsTools(deps),
  ];
}
