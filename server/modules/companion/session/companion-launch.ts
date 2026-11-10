import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSdkMcpServer, type Options, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, readDeepseekApiKey } from '@/modules/deepseek/index.js';
import { launchAccountEnv } from '@/modules/providers/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { CompanionSettings } from '@/shared/companion-types.js';
import { companionProviderOf, type CompanionProvider } from '@/shared/companion-provider.js';

/**
 * How her one streaming-input `query()` is launched: the options, and the check that its tool list is
 * what was asked for. She is built exactly like the Cerberus diagnosis agent
 * (`cerberus/diagnosis/diagnosis-agent.ts`), which runs in production, so READ-ONLY-BY-CONSTRUCTION is
 * true of her for the same reasons, each one an option below:
 *   - `systemPrompt` is a plain string, her own (her soul pages, then her plumbing, composed by the session's plan: `companion-prompt.ts`) —
 *     never the Claude Code preset — so no house rule, CLAUDE.md or skill is ever put in front of her;
 *   - `settingSources: []` — nothing on disk widens what she may do;
 *   - `settings.autoMemoryEnabled: false` — the CLI keys a project's auto-memory (`MEMORY.md`, the
 *     operator's standing rules for coding agents) to the git root of the cwd, and hers sits inside
 *     `~/.claude`, so without this the file is in her context on every launch, whatever `settingSources` says;
 *   - `tools: []` — no built-in tool exists: no shell, no file edit, no web. Her tools are the one
 *     in-process MCP server, and `allowedTools` names exactly those, so a tool is never one prompt away;
 *   - `strictMcpConfig` — the operator's own MCP servers (`~/.claude.json`) are not loaded into her.
 * She differs from the diagnosis agent in five ways, each one a reason she lives longer than a call:
 *   - she PERSISTS: `persistSession` stays on and the CLI session id the caller holds is passed as
 *     `resume`, so her conversation outlives the process (the idle closer ends it after two hours of silence) — but only while her
 *     tools, prompt and model provider are what that conversation began with: the CLI records the tools and prompt once and keeps
 *     them on a resume, and an endpoint that did not open a conversation does not hold it, so
 *     `session/companion-session.ts` resumes a conversation only when its stored shape (`session/companion-shape.ts`) is the launch's own;
 *   - her `cwd` is `~/.claude/state/companion/<user id>`, a hidden project root
 *     (`shared/hidden-project-paths.ts`): her conversation never reaches a project list, and the heal
 *     reads her turns as a program's, never as the operator's correction (INV-4352);
 *   - `includePartialMessages` feeds her text, delta by delta, to the sentence stream;
 *   - `maxTurns` is 30 PER TURN of hers (a turn is one answer to him, with every tool call inside it).
 *   - her CLI NEVER COMPACTS HER: `DISABLE_COMPACT=1` in her env switches off its summary, automatic and manual alike (so no `compact_boundary` can
 *     reach her), and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` makes her window 500k tokens: the size her CLI's own reading measures her against
 *     (`session/companion-process.ts`), which her closing counts back from. It is NOT a refusal point: with compaction off the CLI sends a message that
 *     passes it (measured 2026-11-01 on a 100,000 window: messages read at 99,982 and at 100,122 tokens were both sent) and refuses only at the model's own
 *     limit (read from the CLI's code, not measured at her size). So her own closing (`session/companion-closing.ts`: a last turn to write herself a
 *     note, then a fresh conversation) is the only bound under her window, and the refusal that does come is handed over, never failed (`session/companion-events.ts`).
 *     The CLI reads its env at launch, so a change here applies from her next launch.
 * Her model picks her ENDPOINT, and the launch carries everything that goes with it (`launchEnvironment` below). On a Claude model it is
 * a Claude launch like any other: it starts on the account the house chose, on the subscription. On `deepseek` it is DeepSeek's
 * Anthropic-compatible endpoint under the DeepSeek key, with the model name `deepseek-flash` verbatim and none of the Claude
 * credentials in its env.
 *
 * Consumers: `session/companion-session.ts` (every launch and relaunch), `session/companion-handover.ts` (where the thread of a
 * conversation she drops is filed), `tools/companion-tools.ts` (which re-exports `COMPANION_MCP_SERVER_NAME`, the one name her tools
 * are registered under) and `eyes/settings-lines.ts` (which says `COMPANION_EFFORT` in `read_settings`).
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
 * The reasoning effort of every launch of hers: the deepest the CLI offers, on any model she may run (sonnet, fable, opus and haiku all accept `max`:
 * the CLI's model list, read 2026-11-09; `deepseek-flash` already runs at `max` on every other launch of the house's, the launch table's
 * `[deepseek] effort`, read 2026-11-10). Fixed here and no setting of his, so it applies from her next launch. Consumed by `companionQueryOptions`
 * below and by `eyes/settings-lines.ts`, which says it in `read_settings` from this same constant, so what she is told and what she runs cannot drift.
 */
export const COMPANION_EFFORT = 'max' satisfies Options['effort'];

/**
 * Her window: 500k tokens, half her models' 1M. With the CLI's compaction off (`DISABLE_COMPACT`, below) the CLI does not refuse at it — it sends past it —
 * so it is the size her CLI's reading measures her against and her closing counts back from; her own closing is what keeps her under it.
 */
const COMPANION_WINDOW_TOKENS = 500_000;

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

/**
 * Where the CLI filed her conversation `sessionId`: `~/.claude/projects/<her working directory with every character but a letter, a digit
 * and `-` turned into `-`>/<id>.jsonl` (every login's `projects` is the same folder). `null` when the id is not a UUID (a damaged id never
 * reaches a path) or no such file stands. Consumed by `session/companion-handover.ts`, which hands the thread of a conversation she is
 * about to drop to the summarizer.
 */
export function companionTranscriptPath(userId: number, sessionId: string): string | null {
  if (resumableSessionId(sessionId) === null) return null;
  const folder = companionWorkingDirectory(userId).replace(/[^a-zA-Z0-9-]/g, '-');
  const transcript = path.join(os.homedir(), '.claude', 'projects', folder, `${sessionId}.jsonl`);
  return fs.existsSync(transcript) ? transcript : null;
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

/** The names that say "run me on this endpoint": a launch carries exactly its own pair, never one it inherited. */
const ENDPOINT_ENV_NAMES = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] as const;

/** The names a Claude launch rides on: the account's token and an API key. DeepSeek's endpoint must never be sent either of them. */
const CLAUDE_CREDENTIAL_ENV_NAMES = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;

/**
 * The environment her CLI is launched with, by the provider her model is served from. The server's own env (`userFacingEnv`) is the
 * start, and the endpoint pair is dropped from it FIRST, for every provider: the server can itself be running on DeepSeek (or be pointed
 * at another endpoint), and a Claude launch that inherited the pair would be answered by that endpoint under a Claude model name while
 * the CLI's tally still said Claude (measured 2026-09-15 on the house's plan-runner children; `deepseek.py`'s `ENDPOINT_ENV`).
 *   - `claude`: the account the house chose rides in as its token (`launchAccountEnv`), and nothing else is added.
 *   - `deepseek`: the Claude credentials are dropped (DeepSeek's endpoint under the operator's Claude token is a refused request, and
 *     the token has no business there), and the endpoint plus the DeepSeek key are put in. A key that cannot be read THROWS rather
 *     than falling back to Claude: the launch ends with her process's failure sentence, and nothing is sent to the subscription in its
 *     place (the save of the model is refused while no key is held, so this is only a key removed afterwards).
 */
async function launchEnvironment(provider: CompanionProvider): Promise<NodeJS.ProcessEnv> {
  const env = userFacingEnv();
  for (const name of ENDPOINT_ENV_NAMES) delete env[name];

  if (provider === 'claude') return { ...env, ...(await launchAccountEnv()).env };

  const key = await readDeepseekApiKey();
  if (!key) throw new Error('Her model is DeepSeek, but DEEPSEEK_API_KEY is not set, so her process cannot start on it.');
  for (const name of CLAUDE_CREDENTIAL_ENV_NAMES) delete env[name];
  return { ...env, ANTHROPIC_BASE_URL: DEEPSEEK_BASE_URL, ANTHROPIC_AUTH_TOKEN: key };
}

/**
 * The options of one launch of her conversation: `settings` give the model, `tools` the definitions her MCP server
 * carries (none is a valid set — the probe runs without any), `providerSessionId` the conversation to resume (`null` for a
 * fresh one: no `resume` key at all, never an empty one) and `systemPrompt` the prompt exactly as the launch's plan hashed it
 * (read nowhere here: a second read could differ from the one the shape was taken over). Async because the account env (or the DeepSeek key)
 * is read at launch. `settings.model` is the picker's word: a Claude alias goes to the CLI as it is, and `deepseek` goes as the vendor's
 * own model name, `deepseek-flash`, verbatim — a Claude alias at DeepSeek's endpoint is mapped by the vendor to some other model. A launch that cannot
 * be given its endpoint's credentials rejects. Consumed by `session/companion-process.ts`, which runs the launch.
 */
export async function companionQueryOptions(
  userId: number,
  settings: CompanionSettings,
  tools: Array<SdkMcpToolDefinition<any>>,
  providerSessionId: string | null,
  systemPrompt: string
): Promise<Options> {
  const cwd = companionWorkingDirectory(userId);
  const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  const provider = companionProviderOf(settings.model);
  const environment = await launchEnvironment(provider);
  return {
    model: provider === 'deepseek' ? DEEPSEEK_MODEL : settings.model,
    systemPrompt,
    tools: [],
    mcpServers: { [COMPANION_MCP_SERVER_NAME]: createSdkMcpServer({ name: COMPANION_MCP_SERVER_NAME, tools }) },
    strictMcpConfig: true,
    allowedTools: companionToolNames(tools),
    settingSources: [],
    settings: { autoMemoryEnabled: false },
    includePartialMessages: true,
    cwd,
    maxTurns: COMPANION_MAX_TURNS,
    effort: COMPANION_EFFORT,
    // Last, so neither the house's environment nor the endpoint's launch env can switch her CLI's compaction back on.
    env: { ...environment, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(COMPANION_WINDOW_TOKENS), DISABLE_COMPACT: '1' },
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    ...(providerSessionId ? { resume: providerSessionId } : {}),
  };
}
