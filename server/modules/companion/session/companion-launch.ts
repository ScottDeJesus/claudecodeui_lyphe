import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSdkMcpServer, type Options, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import { launchAccountEnv } from '@/modules/providers/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { CompanionSettings } from '@/shared/companion-types.js';

import { fillSystemPrompt } from './companion-prompt.js';

/**
 * How her one streaming-input `query()` is launched: the options, and the check that its tool list is
 * what was asked for. She is built exactly like the Cerberus diagnosis agent
 * (`cerberus/diagnosis/diagnosis-agent.ts`), which runs in production, so READ-ONLY-BY-CONSTRUCTION is
 * true of her for the same reasons, each one an option below:
 *   - `systemPrompt` is a plain string, her own — never the Claude Code preset — so no house rule,
 *     CLAUDE.md or skill is ever put in front of her;
 *   - `settingSources: []` — nothing on disk widens what she may do;
 *   - `settings.autoMemoryEnabled: false` — the CLI keys a project's auto-memory (`MEMORY.md`, the
 *     operator's standing rules for coding agents) to the git root of the cwd, and hers sits inside
 *     `~/.claude`, so without this the file is in her context on every launch, whatever `settingSources` says;
 *   - `tools: []` — no built-in tool exists: no shell, no file edit, no web. Her tools are the one
 *     in-process MCP server, and `allowedTools` names exactly those, so a tool is never one prompt away;
 *   - `strictMcpConfig` — the operator's own MCP servers (`~/.claude.json`) are not loaded into her.
 * She differs from the diagnosis agent in four ways, each one a reason she lives longer than a call:
 *   - she PERSISTS: `persistSession` stays on and the CLI session id the caller holds is passed as
 *     `resume`, so her memory outlives the process (the idle closer ends it after two hours of silence);
 *   - her `cwd` is `~/.claude/state/companion/<user id>`, a hidden project root
 *     (`shared/hidden-project-paths.ts`): her conversation never reaches a project list, and the heal
 *     reads her turns as a program's, never as the operator's correction (INV-4352);
 *   - `includePartialMessages` feeds her text, delta by delta, to the sentence stream;
 *   - `maxTurns` is 30 PER TURN of hers (a turn is one answer to him, with every tool call inside it).
 * It is a Claude launch like any other, so it starts on the account the house chose, on the subscription.
 *
 * Consumers: `session/companion-session.ts` (every launch and relaunch) and `tools/companion-tools.ts`
 * (which re-exports `COMPANION_MCP_SERVER_NAME`, the one name her tools are registered under).
 */

/**
 * The name her in-process MCP server is registered under; the SDK prefixes every tool with
 * `mcp__<name>__`. Consumed by `tools/companion-tools.ts` (the tools' public names) and by this file
 * (`allowedTools` and the `init` check), so there is one spelling of it.
 */
export const COMPANION_MCP_SERVER_NAME = 'companion';

/** One of her turns may run at most this many model round-trips (tool calls included) before the CLI ends it. */
const COMPANION_MAX_TURNS = 30;

/**
 * `~/.claude/state/companion/<user id>`, made if absent: the folder her CLI is launched in. Nothing is
 * read from it; it exists so the CLI has a hidden root to file her conversation under. Consumed by
 * `companionQueryOptions` here and by the shows that read her JSONL back (the encoded path is the
 * folder's name under `~/.claude/projects/`).
 */
export function companionWorkingDirectory(userId: number): string {
  const directory = path.join(os.homedir(), '.claude', 'state', 'companion', String(userId));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The held CLI session id when it can be resumed, else `null`. The CLI refuses an id that is not a UUID
 * with a plain failure (`--resume requires a valid session ID`), not the "No conversation found" a
 * missing session gets, so a damaged `companion_state` row would fail every push for ever; the id is only
 * ever written from the CLI's own `init`, so one that is not UUID-shaped is damage and she starts fresh
 * (the first `init` of that launch writes the new id over it). Consumed by `session/companion-session.ts`.
 */
export function resumableSessionId(held: string | null): string | null {
  return held !== null && SESSION_ID_SHAPE.test(held) ? held : null;
}

/** Every tool name the CLI will list for her: the definitions' own names under the server's prefix. */
function companionToolNames(tools: ReadonlyArray<SdkMcpToolDefinition<any>>): string[] {
  return tools.map((definition) => `mcp__${COMPANION_MCP_SERVER_NAME}__${definition.name}`);
}

/**
 * The names in the CLI's `init` tool list that are NOT one of her tools — empty when the session is
 * what was asked for. The launch is ended on a non-empty answer before the model sees a turn, because a
 * session holding a shell or an editor is not the one this file describes, whatever option was meant to
 * prevent it. Consumed by `session/companion-session.ts`.
 */
export function unexpectedTools(listed: readonly string[], tools: ReadonlyArray<SdkMcpToolDefinition<any>>): string[] {
  const own = new Set(companionToolNames(tools));
  return listed.filter((name) => !own.has(name));
}

/**
 * The options of one launch of her conversation: `settings` give the model and the operator's name
 * (the system prompt's one slot), `tools` the definitions her MCP server carries (none is a valid
 * set — the probe runs without any), and `providerSessionId` the conversation to resume (`null` for a
 * fresh one: no `resume` key at all, never an empty one). Async because the account env is read from
 * the house's door at launch. Consumed by `session/companion-session.ts`.
 */
export async function companionQueryOptions(
  userId: number,
  settings: CompanionSettings,
  tools: Array<SdkMcpToolDefinition<any>>,
  providerSessionId: string | null
): Promise<Options> {
  const cwd = companionWorkingDirectory(userId);
  const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  const account = await launchAccountEnv();
  return {
    model: settings.model,
    systemPrompt: fillSystemPrompt(settings.operatorName),
    tools: [],
    mcpServers: { [COMPANION_MCP_SERVER_NAME]: createSdkMcpServer({ name: COMPANION_MCP_SERVER_NAME, tools }) },
    strictMcpConfig: true,
    allowedTools: companionToolNames(tools),
    settingSources: [],
    settings: { autoMemoryEnabled: false },
    includePartialMessages: true,
    cwd,
    maxTurns: COMPANION_MAX_TURNS,
    env: { ...userFacingEnv(), ...account.env },
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    ...(providerSessionId ? { resume: providerSessionId } : {}),
  };
}
