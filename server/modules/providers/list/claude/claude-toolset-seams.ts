/**
 * The Claude runtime's seams to the tool sets it never imports.
 *
 * The runtime learns everything about a chat's tool sets through its context (`context.toolsets`,
 * `ProviderRuntimeContext`) and imports nothing from the toolsets module, which registers the hook
 * from the other side. Every body lives here so that claude-runtime.provider.js — far over the module
 * ceiling — takes call-in lines only:
 *
 * - the question "what does this chat's launch get?" asked of the hook (bounded, caught, inert when it
 *   fails), and the function that puts the answer's variables and prompt line on the launch;
 * - the digest a launch profile keeps of the tool-set map (only digests are kept, never the configs);
 * - the sync: one process's map of on-set servers pushed into its running CLI.
 *
 * ONE MECHANISM: a set's servers reach a CLI only through `Query.setMcpServers()`, handed the FULL map
 * of the chat's on-sets on every call, because the call REPLACES the servers it owns. They stay out of
 * the launch's `mcpServers` option (a launch argument: changing it replaces the process), and
 * `toggleMcpServer` is never called (it writes `disabledMcpServers` into the project's entry in
 * `~/.claude.json`, shared by every session in the folder). With one mechanism, on, off, a fresh
 * process and a re-adopted one are the same code.
 *
 * A set's server must not take a BASE server's name. Measured on Claude Code 2.1.301 (the 2.1.300 source
 * read said such a call is ignored; it is not): a `setMcpServers` naming a launch-option server takes
 * the name over, and the call that later leaves it out removes the operator's server. So a set server
 * named like one of the launch's `mcpServers` is left out of every call and reported in `errors`. A base
 * server that comes from a settings file or a plugin cannot be named here; that path is unmeasured.
 *
 * A sync never throws out of the process and never retires it: a server that fails to connect is
 * reported, and a slow http server is not a broken conversation.
 *
 * consumer: claude-runtime.provider.js
 */

import { createHash } from 'node:crypto';

import type { McpSetServersResult, Query } from '@anthropic-ai/claude-agent-sdk';

import type { ChatToolsetLaunch, ToolsetServerConfig, ToolsetSyncOutcome } from '@/shared/toolset-types.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

type ToolsetContext = Pick<ProviderRuntimeContext, 'toolsets'>;

// A hook that never settles must not hold the message: past this the launch is today's, and the next message asks again.
const LAUNCH_DEADLINE_MS = 2_000;

// How much of a CLI's complaint the journal keeps (the caller's outcome has all of it).
const JOURNAL_REASON_MAX = 200;

const inertLaunch = (): ChatToolsetLaunch => ({ env: {}, servers: null, promptLine: null });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A hook that fails the same way on every message says so once, not on every message of every chat.
const loggedFailures = new Set<string>();

function logFailureOnce(message: string): void {
  if (loggedFailures.has(message)) return;
  loggedFailures.add(message);
  console.warn(`[Claude SDK] ${message}; the launch carries no tool sets this time`);
}

type LaunchAnswer = { launch: ChatToolsetLaunch; failure: string | null };

/**
 * The hook's answer plus WHY it is inert when it failed: the launch cannot tell "nothing in play" from
 * "the hook broke", and a sync must (it answers the first confirmed and the second unconfirmed).
 */
async function askToolsetLaunchChecked(
  context: ToolsetContext,
  input: { appSessionId: string | null; onNode: boolean },
  deadlineMs: number
): Promise<LaunchAnswer> {
  const failed = (message: string): LaunchAnswer => {
    logFailureOnce(message);
    return { launch: inertLaunch(), failure: message };
  };
  let deadline: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      context.toolsets.launchFor(input),
      new Promise<'late'>((resolve) => {
        deadline = setTimeout(() => resolve('late'), deadlineMs);
        deadline.unref();
      })
    ]);
    if (answer === 'late') return failed(`The tool-set hook did not answer within ${deadlineMs} ms`);
    if (!isRecord(answer)) return failed('The tool-set hook answered something that is not a launch');
    return {
      launch: {
        env: isRecord(answer.env) ? { ...(answer.env as Record<string, string>) } : {},
        servers: isRecord(answer.servers) ? (answer.servers as ChatToolsetLaunch['servers']) : null,
        promptLine: typeof answer.promptLine === 'string' && answer.promptLine !== '' ? answer.promptLine : null
      },
      failure: null
    };
  } catch (error) {
    return failed(`The tool-set hook failed (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Asks the toolsets hook what this message's launch gets. A hook that throws, rejects or does not
 * answer within `deadlineMs` answers the inert launch — a failure of the tool sets must never be able
 * to break the message it rides on. Each distinct failure is logged once.
 */
export async function askToolsetLaunch(
  context: ToolsetContext,
  input: { appSessionId: string | null; onNode: boolean },
  deadlineMs = LAUNCH_DEADLINE_MS
): Promise<ChatToolsetLaunch> {
  return (await askToolsetLaunchChecked(context, input, deadlineMs)).launch;
}

type LaunchOptionsShape = {
  env?: Record<string, string | undefined>;
  systemPrompt?: unknown;
};

/**
 * Puts the hook's answer on the launch: its variables into `sdkOptions.env` (set by the option mapper,
 * which replaces — not overlays — the host's environment) and its pointer after the surface prompt
 * already in `systemPrompt.append`. An inert launch (`{ env: {}, promptLine: null }`) leaves both
 * exactly as they were. The servers are not here: they ride `setMcpServers`, never the launch.
 */
export function applyToolsetLaunch(sdkOptions: LaunchOptionsShape, launch: ChatToolsetLaunch): void {
  if (Object.keys(launch.env).length > 0) {
    sdkOptions.env = { ...sdkOptions.env, ...launch.env };
  }
  const { promptLine } = launch;
  const systemPrompt = sdkOptions.systemPrompt;
  if (promptLine && isRecord(systemPrompt)) {
    const existing = typeof systemPrompt.append === 'string' ? systemPrompt.append : '';
    systemPrompt.append = existing === '' ? promptLine : `${existing} ${promptLine}`;
  }
}

/**
 * The digest of a tool-set map: null for null (nothing in play), '' for `{}` (in play, no server), and
 * otherwise the sha256 of the map's JSON. The hook makes the key order canonical (set-name order), so
 * the same sets give the same digest. Only digests are kept, never the configs — a config can carry a
 * token.
 */
export function toolsetDigest(servers: ChatToolsetLaunch['servers'] | undefined): string | null {
  if (servers === null || servers === undefined) return null;
  if (Object.keys(servers).length === 0) return '';
  return createHash('sha256').update(JSON.stringify(servers)).digest('hex');
}

export type ToolsetSyncDeps = {
  /** The process's query, or null before it exists. */
  getQuery: () => Pick<Query, 'setMcpServers'> | null;
  isClosing: () => boolean;
  context: ToolsetContext;
  appSessionId: string | null;
  onNode: boolean;
  /** Records the digest the process now holds: the map's, or null when that is no longer known. */
  setApplied: (digest: string | null) => void;
  /** The names of the BASE servers the process was launched with (its `mcpServers` option); none when omitted. */
  baseServerNames?: () => readonly string[];
};

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const BASE_NAME_REASON = "the name is used by a base server of this chat, so this set's server was not started";

/** Awaits `request`, rejecting when it has not settled within `waitMs`; the abandoned request's late rejection is swallowed. */
async function withinBound<T>(request: Promise<T>, waitMs: number, boundMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`setMcpServers was not answered within ${boundMs} ms`)), waitMs);
        timer.unref();
      })
    ]);
  } finally {
    clearTimeout(timer);
    request.catch(() => {});
  }
}

/**
 * The map the CLI is handed: the hook's, less any server named like a base server (reported in
 * `rejected`), and a stdio server given the `args` the CLI's own spread needs — the box file makes `args`
 * optional, and the CLI's `setMcpServers` path fails a stdio server without one.
 */
function shapeForCli(servers: Record<string, ToolsetServerConfig>, baseNames: readonly string[]) {
  const sendable: Record<string, ToolsetServerConfig> = {};
  const rejected: Record<string, string> = {};
  for (const [name, config] of Object.entries(servers)) {
    if (baseNames.includes(name)) {
      rejected[name] = BASE_NAME_REASON;
    } else if ((config.type === undefined || config.type === 'stdio') && !Array.isArray(config.args)) {
      sendable[name] = { ...config, args: [] };
    } else {
      sendable[name] = config;
    }
  }
  return { sendable, rejected };
}

type CliResult = { added: string[]; removed: string[]; errors: Record<string, string> };

const readResult = (raw: McpSetServersResult | undefined): CliResult => ({
  added: Array.isArray(raw?.added) ? [...raw.added] : [],
  removed: Array.isArray(raw?.removed) ? [...raw.removed] : [],
  errors: isRecord(raw?.errors) ? ({ ...raw.errors } as Record<string, string>) : {}
});

/** Two calls of one sync as one answer; a name removed only to retry it is not reported as removed. */
function mergeResults(first: CliResult, second: CliResult, retried: readonly string[]): CliResult {
  const added = [...new Set([...first.added, ...second.added])];
  const removed = [...new Set([...first.removed, ...second.removed])].filter((name) => !retried.includes(name) && !added.includes(name));
  return { added, removed, errors: { ...first.errors, ...second.errors } };
}

/**
 * The sync of ONE process, as its handle answers it. Runs are chained — one at a time, in the order they
 * were asked — and each re-asks the hook when its turn comes, so two racing switches (the model's command
 * and the operator's press) leave the CLI holding what the row says last.
 */
export function createToolsetSync(deps: ToolsetSyncDeps): { sync(boundMs: number): Promise<ToolsetSyncOutcome> } {
  const key = deps.appSessionId ?? 'NEW';
  let tail: Promise<unknown> = Promise.resolve();
  // Servers the CLI could not connect. It treats a repeat of an identical map as a no-op and stops
  // reporting the failure, so a later sync that still wants one takes it out first and puts it back.
  let failedNames: string[] = [];

  const record = (digest: string | null): void => {
    try {
      deps.setApplied(digest);
    } catch (error) {
      console.warn(`[Claude SDK] Could not record the tool sets of session ${key}:`, reasonOf(error));
    }
  };

  // `boundMs` bounds the WHOLE run (the hook's ask and every `setMcpServers`): the spawn's prompt waits on it.
  const runOnce = async (boundMs: number): Promise<ToolsetSyncOutcome> => {
    if (deps.isClosing()) return { live: false };
    const startedAt = Date.now();
    const remainingMs = (): number => Math.max(1, boundMs - (Date.now() - startedAt));
    const { launch, failure } = await askToolsetLaunchChecked(
      deps.context, { appSessionId: deps.appSessionId, onNode: deps.onNode }, Math.min(LAUNCH_DEADLINE_MS, boundMs)
    );
    // The hook can take a while; the process may have closed in the meantime.
    if (deps.isClosing()) return { live: false };
    // A hook that failed is not "nothing in play": nothing was sent, and the caller must not read it as done.
    if (failure !== null) return { live: true, confirmed: false, reason: failure };
    const { servers } = launch;
    // Nothing in play for this chat (the hook has said why when it was worth saying): no request, no line.
    if (servers === null) return { live: true, confirmed: true, added: [], removed: [], errors: {} };
    const query = deps.getQuery();
    if (!query) return { live: false };

    const { sendable, rejected } = shapeForCli(servers, deps.baseServerNames?.() ?? []);
    const retried = failedNames.filter((name) => Object.hasOwn(sendable, name));
    let result: CliResult;
    try {
      // THE FULL MAP of the chat's on-sets, on every call: the call REPLACES the servers it owns. It
      // also replaces every IN-PROCESS SDK server (operator, measured 2026-10-15: a call that passed
      // only the new set tore down the SDK server hosting the switch tool in the middle of its own
      // call, "Connection closed"). No CloudCLI chat launch carries one today; the day one does, it
      // must be re-passed in `sendable` on every call, here, or this call tears it down. Base servers
      // (launch `mcpServers`, settings files, plugins) are not this call's and keep running.
      const without = Object.fromEntries(Object.entries(sendable).filter(([name]) => !retried.includes(name)));
      const first = retried.length > 0 ? readResult(await withinBound(query.setMcpServers(without), remainingMs(), boundMs)) : null;
      const second = readResult(await withinBound(query.setMcpServers(sendable), remainingMs(), boundMs));
      result = first ? mergeResults(first, second, retried) : second;
    } catch (error) {
      // What the CLI holds is no longer known; the next joining message asks again.
      record(null);
      const reason = reasonOf(error);
      console.log(`[Claude SDK] Tool sets for session ${key}: unconfirmed: ${reason.slice(0, JOURNAL_REASON_MAX)} (${Date.now() - startedAt} ms)`);
      return { live: true, confirmed: false, reason };
    }
    failedNames = Object.keys(result.errors);
    // A server the CLI could not connect leaves the digest unknown, so the next message asks again; a
    // name left out for a base server's sake is settled for this process (a changed base map respawns it).
    record(failedNames.length > 0 ? null : toolsetDigest(servers));
    const errors = { ...rejected, ...result.errors };
    console.log(`[Claude SDK] Tool sets for session ${key}: +${result.added.join(',')} -${result.removed.join(',')} errors=${Object.keys(errors).join(',')} (${Date.now() - startedAt} ms)`);
    return { live: true, confirmed: true, added: result.added, removed: result.removed, errors };
  };

  return {
    sync(boundMs) {
      const run = tail.then(() => runOnce(boundMs)).catch((error): ToolsetSyncOutcome => {
        // Unreachable by construction (every step above is caught); here so a surprise still never throws out.
        console.warn(`[Claude SDK] The tool-set sync for session ${key} failed:`, reasonOf(error));
        return { live: true, confirmed: false, reason: reasonOf(error) };
      });
      tail = run;
      return run;
    }
  };
}
