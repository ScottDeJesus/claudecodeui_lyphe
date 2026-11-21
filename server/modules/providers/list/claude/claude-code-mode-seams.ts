/**
 * The Claude runtime's seams to Code Mode for chats.
 *
 * A chat launched in Code Mode has ONE MCP server, `cm` (the house's search/execute server), and the
 * built-in tools the house's answer names. Its own MCP servers, and the servers of its on tool sets,
 * reach it only through the house's bridge (the chat's server.json, rewritten by
 * `context.codeMode.serversChanged`), never through `Query.setMcpServers`.
 *
 * The runtime learns about Code Mode through its context (`context.codeMode`, `ChatCodeModeHooks`) and
 * imports nothing from server/modules/code-mode/, which registers the hooks from the other side. Every
 * body lives here so that claude-runtime.provider.js, far over the module ceiling, takes call-in lines only.
 *
 * A failure of Code Mode must never break the message it rides on: any failure answers `{ on: false }`
 * and the chat launches as it does today. A chat's mode does not change for the life of its process; the
 * launch decides it, and a later switch of tool sets only changes what the bridge holds.
 *
 * consumer: claude-runtime.provider.js, claude-toolset-seams.ts
 */

import type { ChatCodeModeLaunch } from '@/shared/code-mode-types.js';
import type { ToolsetServerConfig, ToolsetSyncOutcome } from '@/shared/toolset-types.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

type CodeModeContext = Pick<ProviderRuntimeContext, 'codeMode'>;

export const CODE_MODE_SERVER_NAME = 'cm';
// The search tool is pre-allowed; execute is not, so it still reaches canUseTool.
export const CODE_MODE_SEARCH_TOOL = 'mcp__cm__search';

// The hook runs the house's verb, bounded at 12 s itself; past this the launch is today's.
const LAUNCH_DEADLINE_MS = 15_000;

// How much of a failure's message the journal keeps (the caller's outcome has all of it).
const JOURNAL_REASON_MAX = 200;

const BASE_NAME_REASON = "the name is used by a base server of this chat, so this set's server was not started";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// A hook that fails the same way on every message says so once, not on every message of every chat.
const loggedFailures = new Set<string>();

function logFailureOnce(message: string): void {
  if (loggedFailures.has(message)) return;
  loggedFailures.add(message);
  console.warn(`[Claude SDK] ${message}; the chat launches without Code Mode`);
}

/**
 * The hook's answer rebuilt field by field, or null when it is not a launch. Every list and record is
 * copied, so the runtime holds nothing the hook could still change.
 */
function rebuildLaunch(answer: unknown): ChatCodeModeLaunch | null {
  if (!isRecord(answer)) return null;
  if (answer.on === false) return { on: false };
  if (answer.on !== true) return null;
  const { tools, prompt, server, env } = answer;
  if (!isStringArray(tools) || typeof prompt !== 'string' || !isRecord(server) || !isRecord(env)) return null;
  const { command, args } = server;
  if (typeof command !== 'string' || command === '' || !isStringArray(args)) return null;
  const copiedEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') return null;
    copiedEnv[name] = value;
  }
  return { on: true, tools: [...tools], server: { command, args: [...args] }, prompt, env: copiedEnv };
}

/**
 * Asks the code-mode hook what this message's launch gets. A hook that throws, rejects, does not answer
 * within `deadlineMs`, or answers something that is not a launch yields `{ on: false }`, so a failure of
 * Code Mode can never break the message it rides on. Each distinct failure is logged once.
 */
export async function askCodeModeLaunch(
  context: CodeModeContext,
  input: { appSessionId: string | null; onNode: boolean; cwd: string; servers: Record<string, unknown> },
  deadlineMs = LAUNCH_DEADLINE_MS
): Promise<ChatCodeModeLaunch> {
  const off = (message: string): ChatCodeModeLaunch => {
    logFailureOnce(message);
    return { on: false };
  };
  let deadline: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      context.codeMode.launchFor(input),
      new Promise<'late'>((resolve) => {
        deadline = setTimeout(() => resolve('late'), deadlineMs);
        deadline.unref();
      })
    ]);
    if (answer === 'late') return off(`The Code Mode hook did not answer within ${deadlineMs} ms`);
    const launch = rebuildLaunch(answer);
    if (launch === null) return off('The Code Mode hook answered something that is not a launch');
    return launch;
  } catch (error) {
    return off(`The Code Mode hook failed (${reasonOf(error)})`);
  } finally {
    clearTimeout(deadline);
  }
}

type CodeModeOptionsShape = {
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  mcpServers?: Record<string, unknown>;
  strictMcpConfig?: boolean;
  env?: Record<string, string | undefined>;
  systemPrompt?: unknown;
  allowedTools?: string[];
};

/**
 * Puts a Code Mode launch on the chat's options. An `{ on: false }` launch changes nothing.
 */
export function applyCodeModeLaunch(sdkOptions: CodeModeOptionsShape, launch: ChatCodeModeLaunch): void {
  if (launch.on === false) return;
  // The list replaces the claude_code preset, so every built-in it does not name is off.
  sdkOptions.tools = [...launch.tools];
  // Replaced, not added to: `cm` is the chat's only MCP server, so nothing else the launch would carry reaches the CLI.
  sdkOptions.mcpServers = { [CODE_MODE_SERVER_NAME]: { command: launch.server.command, args: [...launch.server.args] } };
  // Servers named in a settings file would load beside `cm` without this.
  sdkOptions.strictMcpConfig = true;
  sdkOptions.env = { ...sdkOptions.env, ...launch.env };
  const { systemPrompt } = sdkOptions;
  if (isRecord(systemPrompt)) {
    const existing = typeof systemPrompt.append === 'string' ? systemPrompt.append : '';
    systemPrompt.append = existing === '' ? launch.prompt : `${existing}\n\n${launch.prompt}`;
  }
  const allowed = sdkOptions.allowedTools ?? [];
  sdkOptions.allowedTools = allowed.includes(CODE_MODE_SEARCH_TOOL) ? allowed : [...allowed, CODE_MODE_SEARCH_TOOL];
}

export type CodeModeServerSync = {
  push(setServers: Record<string, ToolsetServerConfig>, boundMs: number): Promise<ToolsetSyncOutcome>;
};

/**
 * What a tool-set switch does in a Code Mode chat, where the toolset sync would call `setMcpServers`: the
 * on-sets' servers go to the bridge, alongside the chat's own base servers. Never throws.
 */
export function createCodeModeServerSync(deps: {
  context: CodeModeContext;
  appSessionId: string;
  baseServers: Record<string, unknown>;
  initialSetNames: readonly string[];
}): CodeModeServerSync {
  const { appSessionId, baseServers } = deps;
  const baseNames = Object.keys(baseServers);
  // The set names the bridge holds as of the last confirmed push; added and removed are measured against it.
  let previous: readonly string[] = [...deps.initialSetNames];
  // Pushes run one at a time, in call order, so two racing switches leave the bridge holding the last.
  let tail: Promise<unknown> = Promise.resolve();

  const runPush = async (setServers: Record<string, ToolsetServerConfig>, boundMs: number): Promise<ToolsetSyncOutcome> => {
    const startedAt = Date.now();
    const accepted: Record<string, ToolsetServerConfig> = {};
    const errors: Record<string, string> = {};
    for (const [name, config] of Object.entries(setServers)) {
      if (baseNames.includes(name)) {
        errors[name] = BASE_NAME_REASON;
      } else {
        accepted[name] = config;
      }
    }
    const servers = { ...accepted, ...baseServers };
    let timer: NodeJS.Timeout | undefined;
    let request: Promise<void> | undefined;
    try {
      request = deps.context.codeMode.serversChanged({ appSessionId, servers });
      await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`serversChanged was not answered within ${boundMs} ms`)), boundMs);
          timer.unref();
        })
      ]);
    } catch (error) {
      const reason = reasonOf(error);
      console.log(
        `[Claude SDK] Tool sets for session ${appSessionId} (Code Mode): unconfirmed: ${reason.slice(0, JOURNAL_REASON_MAX)} (${Date.now() - startedAt} ms)`
      );
      return { live: true, confirmed: false, reason };
    } finally {
      clearTimeout(timer);
      // A request abandoned at the bound may still reject later; that must not surface as unhandled.
      request?.catch(() => {});
    }
    const sent = Object.keys(accepted);
    const added = sent.filter((name) => !previous.includes(name));
    const removed = previous.filter((name) => !sent.includes(name));
    previous = sent;
    console.log(
      `[Claude SDK] Tool sets for session ${appSessionId} (Code Mode): +${added.join(',')} -${removed.join(',')} errors=${Object.keys(errors).join(',')} (${Date.now() - startedAt} ms)`
    );
    return { live: true, confirmed: true, added, removed, errors };
  };

  return {
    push(setServers, boundMs) {
      const run = tail
        .then(() => runPush(setServers, boundMs))
        .catch((error): ToolsetSyncOutcome => {
          // Unreachable by construction (every step above is caught); here so a surprise still never throws out.
          console.warn(`[Claude SDK] The Code Mode tool-set sync for session ${appSessionId} failed:`, reasonOf(error));
          return { live: true, confirmed: false, reason: reasonOf(error) };
        });
      tail = run;
      return run;
    }
  };
}
