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
import { skillReads } from '../eyes/skill-reads.js';
import { handsTools } from '../hands/hands-tools.js';
import type { CompanionHouse } from '../house.js';
import { memoryTools } from '../memory/memory-tools.js';
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
 * WHAT THE DEPS ARE FOR. A tool file takes the account, its store, the runtime gateway, the house and the helpers the
 * harness supplies rather than each tool doing for itself, so every tool behaves the same way:
 *   - `setFocus`: a tool that names a chat makes it her FOCUS. The harness infers it; there is no focus tool;
 *   - `withActivity`: while a tool runs it sets her activity (what the panel's status line says), and when
 *     the tool ends she is `thinking` again;
 *   - `openOnFloor`: "the app brings that chat, card, page or check up" happens on the page that holds the floor alone;
 *   - `refuse`: a refusal is `isError` text that says what to do next, never a throw;
 *   - `inLastTurn`: true while her last turn before her conversation closes runs. `buildCompanionTools` reads it at each
 *     call and answers every tool but `recall` and `remember` with a refusal then (below), so the tool files never see it.
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
 * `target` to the page that holds the floor, with `label` the spoken name the door resolved, and is a no-op while no page holds it.
 * Consumed by every tool file of this folder (all but `inLastTurn`, which only `buildCompanionTools` reads); built
 * by `companion-account.ts`.
 */
export type CompanionToolDeps = {
  userId: number;
  store: CompanionStore;
  runtime: ProviderRuntimeGateway;
  house: CompanionHouse;
  setFocus(chat: CompanionSessionRef): void;
  withActivity<T>(phase: ToolActivityPhase, chat: CompanionSessionRef | null, files: string[] | null, run: () => Promise<T>): Promise<T>;
  openOnFloor(target: CompanionOpenTarget, label: string): void;
  refuse(sentence: string): ToolTextResult;
  /** True while her last turn runs (the one she closes her conversation with: she may recall and remember in it, and nothing else). Read at every tool call by `buildCompanionTools`. */
  inLastTurn(): boolean;
  /** Sends the held draft as it stands (`companion-send.ts`): the one door `send_to_session` and `create_session` go through. */
  sendDraft: DraftSender;
};

/** The two tools her last turn leaves open: her own memory, read and written. Everything else answers `LAST_TURN_REFUSAL` there. */
const OPEN_IN_LAST_TURN: ReadonlySet<string> = new Set(['recall', 'remember']);

/** What every other tool answers in her last turn: what is open, and what to do next. */
const LAST_TURN_REFUSAL = 'Not in this last turn: only recall and remember are open now. Keep what matters, then write your note.';

/**
 * Her tools for one account, built group by group in the order below (the names and their order, as she is told them, are
 * `COMPANION_TOOL_NAMES`): `sessionTools()` (`list_sessions`, `list_projects`), which
 * names no chat and so needs no deps, `readTools(deps)` (`read_session`, `list_followups`, `ask_dactyl`), `draftTools(deps)`
 * (`show_note`, `dismiss_note`, `update_draft`, `walk`, `send_to_session`, `create_session`), `actTools(deps)` (`stop_session`,
 * `rename_session`, `pin_session`, `close_session`, `reopen_session`, `answer_session`), then the eyes (`eyes/*-reads.ts`): `roadmapReads(deps)` (`list_roadmap`, `read_card`),
 * `runReads(deps)` (`list_runs`, `read_run`), `docReads(deps)` (`search_docs`, `read_doc`),
 * `alertReads(deps)` (`list_alerts`), `panelReads(deps)` (`read_kanban`, `read_heal`, `read_notes`, `read_schedules`),
 * `houseReads(deps)` (`read_git`, `read_cerberus`, `read_memory`, `read_settings`), `skillReads(deps)` (`lookup_skills`, the house's skills and agents as
 * pointers), and last her hands (`hands/hands-tools.ts`):
 * `handsTools(deps)` (`prepare_action`, `take_action`, `cancel_action`, `open`, `close_followup`), and last her own memory (`memory/memory-tools.ts`):
 * `memoryTools(deps)` (`recall`, `remember`, `forget`).
 *
 * THE LAST TURN'S GATE. Every definition is returned as `{ ...definition, handler }`: the name, the description and the schema
 * are the tool file's own, untouched, and only the handler is wrapped. While `deps.inLastTurn()` is true the wrapper answers every
 * tool but `recall` and `remember` with `LAST_TURN_REFUSAL` and runs nothing; otherwise it calls the definition's own handler,
 * except that `recall` is handed its input with `panel` read as false (its card would show his panel a turn he is never shown). The
 * refusal is in the handler and never in the list because the CLI records a conversation's tools once (name, description, schema)
 * and keeps them on every resume, and `sessionShapeOf` fingerprints exactly those: a tool dropped or reworded for her last turn
 * would be a new shape, and both accounts would start fresh. Consumed by `companion-account.ts`, once per account.
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
    ...skillReads(deps),
    ...handsTools(deps),
    ...memoryTools(deps),
  ].map((definition): SdkMcpToolDefinition<any> => ({
    ...definition,
    handler: (args, extra) => {
      if (!deps.inLastTurn()) return definition.handler(args, extra);
      if (!OPEN_IN_LAST_TURN.has(definition.name)) return Promise.resolve(deps.refuse(LAST_TURN_REFUSAL));
      // Nothing of her last turn is shown to him: a recall's `panel` (a card on his panel, and she is told only that it is there) is read as
      // false, so the card is never put up and she reads her memory herself, which is what the turn is for.
      return definition.handler(definition.name === 'recall' ? { ...args, panel: false } : args, extra);
    },
  }));
}
