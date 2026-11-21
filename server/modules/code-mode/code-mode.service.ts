import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { sessionUserStateDb } from '@/modules/database/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import type { ChatCodeModeHooks, ChatCodeModeLaunch } from '@/shared/code-mode-types.js';

/**
 * Code Mode for chats: the two hooks the Claude runtime asks, each answered by the house's verb
 * `~/.claude/scripts/code-mode`.
 *
 * THE RULE THEY ALL KEEP: the verb decides what a chat's Code Mode is. This file passes it the chat's
 * own facts and stores one thing, the mode a chat was born in. A launch that cannot be answered
 * launches as it does today; it never guesses a mode and never throws into the runtime.
 *
 * Consumed by `code-mode.module.ts`, which registers `codeModeService` with the Claude runtime
 * (`useChatCodeMode`). Every other module is reached through its barrel.
 */

// Absolute, never a PATH lookup: the house's verb is the one this box means, and a same-named binary
// earlier on PATH must not answer for it.
const CODE_MODE_VERB = path.join(os.homedir(), '.claude', 'scripts', 'code-mode');
// A launch waits on the verb, so a hung verb must answer "off" in bounded time, not hold the first message.
const VERB_TIMEOUT_MS = 12_000;
// A runaway verb is cut off at this size, never buffered whole.
const VERB_OUTPUT_MAX_BYTES = 1024 * 1024;

/**
 * Kaylee's CLI is launched in `<this>/<user id>` (companion-launch.ts `companionWorkingDirectory`); her
 * conversation is never put in Code Mode, and the companion barrel exports nothing to ask, so the
 * folder is the test.
 */
const COMPANION_ROOT = path.join(os.homedir(), '.claude', 'state', 'companion');

const LOGGED_CAUSES_CAP = 200;
const LAUNCH_OFF = 'launches without Code Mode';
const LAUNCH_STORE = 'could not store the mode it launched in';
const SERVERS_UNSENT = 'could not hand its changed servers to the house';

/** A fresh object every answer, so no caller can change another's. */
const off = (): ChatCodeModeLaunch => ({ on: false });

/**
 * A chat keeps the mode it was started in: the stored word is passed as `--born` so the verb never
 * re-reads the switch for it, and only the switch's own answer is stored, and only for a chat
 * whose row held nothing. An off that carries the house's reason (not ready, no folder) is logged
 * once and stored nowhere, and its `prompt`, when the house sent one, rides the launch. Any
 * failure answers off and stores nothing; a chat the mode cannot serve launches as it does today.
 * A chat's mode is settled by its first message: once its row holds a conversation, an undecided
 * row reads born off.
 */
async function launchFor(input: {
  appSessionId: string | null;
  onNode: boolean;
  cwd: string;
  servers: Record<string, unknown>;
}): Promise<ChatCodeModeLaunch> {
  const id = input.appSessionId;
  if (!id || input.onNode || isKayleeChat(input.cwd)) return off();

  let born: ReturnType<typeof sessionUserStateDb.getCodeMode>;
  try {
    born = sessionUserStateDb.getCodeMode(id);
  } catch (error) {
    logOnce(LAUNCH_OFF, `could not read the stored mode: ${error instanceof Error ? error.message : String(error)}`, id);
    return off();
  }

  const argv = ['config', '--chat', id, '--cwd', input.cwd];
  if (born !== null) argv.push('--born', born ? 'on' : 'off');

  let stdout: string;
  try {
    stdout = await runVerb(argv, JSON.stringify(input.servers));
  } catch (error) {
    logOnce(LAUNCH_OFF, error instanceof Error ? error.message : String(error), id);
    return off();
  }

  const line = lastLine(stdout);
  const parsed = parseLaunch(line);
  if (!parsed) {
    logOnce(LAUNCH_OFF, `the verb answered a line that is not a launch: ${line.slice(0, 200)}`, id);
    return off();
  }
  const { launch, why } = parsed;

  if (why !== '') {
    logOnce(LAUNCH_OFF, why, id);
    return launch;
  }

  if (born === null) {
    try {
      if (!sessionUserStateDb.setCodeMode(id, launch.on)) logOnce(LAUNCH_STORE, 'no session row has this id', id);
    } catch (error) {
      logOnce(LAUNCH_STORE, error instanceof Error ? error.message : String(error), id);
    }
  }
  return launch;
}

/**
 * A rewrite the house could not make (the verb exits 2 for a chat with no `server.json`, a timeout, a
 * crash) is logged once and REJECTED with the verb's reason, so the runtime's sync answers the switch
 * unconfirmed instead of counting the set as connected.
 */
async function serversChanged(input: { appSessionId: string; servers: Record<string, unknown> }): Promise<void> {
  try {
    await runVerb(['config', '--chat', input.appSessionId, '--servers'], JSON.stringify(input.servers));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logOnce(SERVERS_UNSENT, reason, input.appSessionId);
    throw new Error(`the house could not hand chat ${input.appSessionId} its changed servers: ${reason}`);
  }
}

export const codeModeService: ChatCodeModeHooks = { launchFor, serversChanged };

/** Kaylee's folder or anything under it; both sides resolve so a `..` or trailing slash cannot slip past. */
function isKayleeChat(cwd: string): boolean {
  const resolved = path.resolve(cwd);
  return resolved === COMPANION_ROOT || resolved.startsWith(COMPANION_ROOT + path.sep);
}

/**
 * Runs the verb with the server map on stdin, not argv: a map can carry a token in its env, and argv
 * shows in `ps`. Runs from home so the verb's relative reads never depend on where the server started.
 */
function runVerb(argv: string[], stdin: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      CODE_MODE_VERB,
      argv,
      {
        timeout: VERB_TIMEOUT_MS,
        maxBuffer: VERB_OUTPUT_MAX_BYTES,
        env: userFacingEnv(),
        cwd: os.homedir(),
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            reject(new Error(`printed more than ${VERB_OUTPUT_MAX_BYTES} bytes`));
            return;
          }
          if (error.killed) {
            reject(new Error(`timed out after ${VERB_TIMEOUT_MS / 1000} s`));
            return;
          }
          const detail = lastLine(stderr).slice(0, 200);
          reject(new Error(`exited ${error.code}${detail ? `: ${detail}` : ''}`));
          return;
        }
        resolve(stdout);
      },
    );
    // A verb that exits before reading stdin raises EPIPE on the pipe; its exit is the failure reported, through the callback.
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin);
  });
}

/** The last non-empty trimmed line: the verb's answer is its last line; anything before is its own logging. */
function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) ?? '';
}

/** A plain JSON object: non-null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The verb's last line as a launch, or null when it is not one. Every field is checked and the launch
 * is rebuilt field by field: the runtime installs what comes back, so a field the verb printed beyond
 * the contract must not ride into it. The verb's `why` is kept beside the launch, never inside it; a non-empty `why` is the house saying it could not serve this chat.
 * An off may carry `prompt`; an on may carry `agents`, kept only when it is an absolute path.
 */
function parseLaunch(line: string): { launch: ChatCodeModeLaunch; why: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.why !== undefined && typeof value.why !== 'string') return null;
  const why = typeof value.why === 'string' ? value.why.trim() : '';

  if (value.on === false) {
    const offPrompt = value.prompt;
    return { launch: typeof offPrompt === 'string' ? { on: false, prompt: offPrompt } : off(), why };
  }
  if (value.on !== true) return null;

  const { tools, server, prompt, env, agents } = value;
  if (!isStringArray(tools) || !isRecord(server) || typeof prompt !== 'string' || !isRecord(env)) return null;
  // Absolute only: the path becomes the CLI's `--agents` argument, and a relative path would resolve
  // against wherever the CLI starts.
  const agentsPath = typeof agents === 'string' && path.isAbsolute(agents) ? agents : undefined;

  const { command, args } = server;
  if (typeof command !== 'string' || command === '' || !isStringArray(args)) return null;

  const copiedEnv: Record<string, string> = {};
  for (const [name, item] of Object.entries(env)) {
    if (typeof item !== 'string') return null;
    copiedEnv[name] = item;
  }

  return {
    launch: {
      on: true,
      tools: [...tools],
      server: { command, args: [...args] },
      prompt,
      env: copiedEnv,
      ...(agentsPath !== undefined ? { agents: agentsPath } : {}),
    },
    why: '',
  };
}

const loggedCauses = new Set<string>();

/**
 * Every chat that launches meets the same broken verb, so one line per distinct cause, never one per
 * message. The verb's stderr can name the chat, so the key is the cause with the chat id taken out: the same failure in another chat repeats the key and is not logged again.
 */
function logOnce(what: string, cause: string, appSessionId: string): void {
  const key = `${what}: ${cause.split(appSessionId).join('<chat>')}`;
  if (loggedCauses.has(key)) return;
  if (loggedCauses.size >= LOGGED_CAUSES_CAP) loggedCauses.clear();
  loggedCauses.add(key);
  console.warn(`[code-mode] chat ${appSessionId} ${what}: ${cause}`);
}
