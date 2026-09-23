/**
 * One Claude CLI per conversation: the pieces that let a message join the process that is
 * already running for its conversation instead of starting another one.
 *
 * Three rules this file exists to keep:
 * - The prompt stream never ends on its own. The SDK closes the CLI's stdin the moment its input
 *   iterable is exhausted and the CLI reads that EOF as "wind down", so the queue parks between
 *   messages and ends only when `end()` is called.
 * - The idle clock measures silence since the last MESSAGE, not since the last turn ended, and it
 *   never closes a process that is busy — a turn in flight, a background task, a watcher. Busy is
 *   re-asked every minute until it clears; the process is closed only then.
 * - A setting the SDK can apply to a running query is applied; one it cannot forces a fresh
 *   process. Which is which is decided here, in one place, from the SDK's real surface: `setModel`,
 *   `applyFlagSettings` (effort) and `setPermissionMode` are live, and so is GROWING the allowed
 *   tool list (a newly allowed tool merely reaches `canUseTool`, which reads the live options).
 *   cwd, MCP servers, a resume anchor, a conversation restarted from scratch, any change to the
 *   disallowed list (it shapes the model's tool context at launch), a SHRUNK allowed list (the
 *   CLI holds the launch list as allow rules it resolves before ever asking `canUseTool`) and the
 *   installed CLI version (a running process is the build it was started with) are launch
 *   arguments and are not. The version is the one launch argument that is ORDERED rather than
 *   compared: only a process behind the binary is replaced, never one ahead of a reading.
 *
 * consumer: claude-runtime.provider.js, session-host/idle-version-sweep.ts (the version rule)
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Two hours of silence since the last message closes an idle process (the operator's ruling). */
export const DEFAULT_IDLE_CLOSE_MS = 2 * 60 * 60 * 1000;
const MIN_IDLE_CLOSE_MS = 5_000;
// A busy process is asked again this often, never closed on the spot.
const BUSY_RECHECK_MS = 60_000;

export type PromptQueue = {
  stream: AsyncIterable<SDKUserMessage>;
  /** Queues one message for the CLI; false once the queue has ended. */
  push(message: SDKUserMessage): boolean;
  /** Ends the stream — the only way the CLI ever sees EOF on this path. */
  end(): void;
  readonly ended: boolean;
};

/**
 * The CLI's input for the life of the process: yields what has been pushed, parks while empty,
 * and returns only after `end()`.
 */
export function createPromptQueue(initial: SDKUserMessage[]): PromptQueue {
  const pending: SDKUserMessage[] = [...initial];
  let ended = false;
  let wake: (() => void) | null = null;
  const signal = (): void => {
    const waiting = wake;
    wake = null;
    waiting?.();
  };
  const stream = (async function* () {
    for (;;) {
      while (pending.length > 0) {
        yield pending.shift() as SDKUserMessage;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
  return {
    stream,
    push(message) {
      if (ended) return false;
      pending.push(message);
      signal();
      return true;
    },
    end() {
      if (ended) return;
      ended = true;
      signal();
    },
    get ended() {
      return ended;
    }
  };
}

/**
 * The idle window for one process: a per-turn request (a probe shortening it), else the
 * `CLAUDE_CHAT_IDLE_CLOSE_MS` environment, else two hours. Anything under five seconds is not a
 * window a conversation can live in and falls back to the default.
 */
export function resolveIdleCloseMs(requested: unknown): number {
  const asked = typeof requested === 'number' ? requested : Number(process.env.CLAUDE_CHAT_IDLE_CLOSE_MS);
  if (!Number.isFinite(asked) || asked < MIN_IDLE_CLOSE_MS) return DEFAULT_IDLE_CLOSE_MS;
  // A client may shorten the window (a probe does), never lengthen it past the default.
  return Math.min(asked, DEFAULT_IDLE_CLOSE_MS);
}

export type IdleCloser = {
  /** Restarts the silence clock — called on every message, and only then. */
  touch(idleMs?: number): void;
  cancel(): void;
};

export function createIdleCloser(deps: {
  idleMs: number;
  isBusy: () => boolean;
  close: (silentForMs: number) => void;
  /** Called each time the window is reached while the process is busy and the close is deferred. */
  onBusy?: (silentForMs: number) => void;
}): IdleCloser {
  let idleMs = deps.idleMs;
  let lastMessageAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let cancelled = false;

  const arm = (delayMs: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delayMs);
    // The hold must never keep the API alive on its own.
    timer.unref();
  };
  const fire = (): void => {
    timer = null;
    if (cancelled) return;
    if (deps.isBusy()) {
      deps.onBusy?.(Date.now() - lastMessageAt);
      arm(BUSY_RECHECK_MS);
      return;
    }
    deps.close(Date.now() - lastMessageAt);
  };

  arm(idleMs);
  return {
    touch(nextIdleMs) {
      if (cancelled) return;
      if (typeof nextIdleMs === 'number') idleMs = nextIdleMs;
      lastMessageAt = Date.now();
      arm(idleMs);
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

/** What a process was launched with, in the fields a later message may want to change. */
export type LaunchProfile = {
  /**
   * True for a process re-adopted after an API restart: its launch arguments are not on
   * record, so the first message to join it is taken as the profile rather than diffed
   * against one — every live setter is applied once, and the launch-bound fields are adopted.
   */
  unknown: boolean;
  cwd: string | null;
  resumeSessionAt: string | null;
  /** The MCP map as JSON, '' for none — or null when the config could not be read this time. */
  mcpServers: string | null;
  permissionMode: string;
  launchedInBypass: boolean;
  model: string;
  effort: string | null;
  ultracode: boolean;
  allowedTools: string[];
  disallowedTools: string[];
  /**
   * The Claude CLI version this process's own init announced — null until it announces one,
   * and null for a re-adopted process whose host has no such record.
   *
   * NEVER the installed binary's version. That is a different process's fact, taken from the
   * probe, and adopting it here would mark a stale process current for the rest of its life:
   * the one comparison this field exists for would then answer "same" every time.
   */
  cliVersion: string | null;
};

type SdkOptionsShape = {
  cwd?: string;
  resumeSessionAt?: string;
  mcpServers?: Record<string, unknown>;
  permissionMode?: string;
  model?: string;
  effort?: string;
  settings?: { ultracode?: boolean } | string;
  allowedTools?: string[];
  disallowedTools?: string[];
};

export function launchProfileOf(
  sdkOptions: SdkOptionsShape,
  mcpUnreadable = false,
  unknown = false,
  cliVersion: string | null = null
): LaunchProfile {
  const permissionMode = sdkOptions.permissionMode ?? 'default';
  return {
    unknown,
    cwd: sdkOptions.cwd ?? null,
    resumeSessionAt: sdkOptions.resumeSessionAt ?? null,
    mcpServers: mcpUnreadable ? null : sdkOptions.mcpServers ? JSON.stringify(sdkOptions.mcpServers) : '',
    permissionMode,
    launchedInBypass: permissionMode === 'bypassPermissions',
    model: sdkOptions.model ?? '',
    effort: sdkOptions.effort ?? null,
    ultracode: typeof sdkOptions.settings === 'object' && sdkOptions.settings?.ultracode === true,
    allowedTools: [...(sdkOptions.allowedTools ?? [])],
    disallowedTools: [...(sdkOptions.disallowedTools ?? [])],
    cliVersion: typeof cliVersion === 'string' ? cliVersion : null
  };
}

export type LiveChanges = {
  model: string | null;
  effort: { level: string | null; ultracode: boolean } | null;
  permissionMode: string | null;
  tools: { allowed: string[]; disallowed: string[] } | null;
};

export type LivePlan = { respawn: string; changes: null } | { respawn: null; changes: LiveChanges };

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** The leading numeric parts of a version line (`v2.1.280-beta.1` → `[2, 1, 280]`), or null. */
const versionNumbers = (version: string): number[] | null => {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(version.trim());
  return match ? match[1].split('.').map(Number) : null;
};

/**
 * Whether the process on `liveVersion` is BEHIND the binary on `installedVersion` — the only
 * direction in which a version replaces a process.
 *
 * The installed side is a reading (cached at most 60 s, dropped the moment the binary changes on
 * disk) while the live side is what a process announced at its own init, which is never a reading
 * and never stale. So the two can differ because the process is old, and that is the whole point of
 * the rule — or because the reading is old, which is no reason to touch a healthy process: a
 * differing pair decided by "not equal" alone would retire a current process and spawn the very
 * same build again, once per message, for as long as the reading stood, each time paying a cold
 * start and a full resume replay. A version that cannot be ordered falls back to the plain
 * difference, because a build nobody can compare is not a reason to leave a conversation on an old
 * binary for good — and a pair like that only differs when the strings genuinely do.
 *
 * Exported because the same rule decides a retirement that no message asked for: the idle host a
 * version install leaves behind (session-host's `idle-version-sweep.ts`). A second comparison there
 * — "differs", say — would be a second answer to "is this process old", and the two would drift the
 * first time one of them learned about a build that sorts oddly. consumer: idle-version-sweep.ts
 */
export const isBehindInstalled = (liveVersion: string, installedVersion: string): boolean => {
  const live = versionNumbers(liveVersion);
  const installed = versionNumbers(installedVersion);
  if (!live || !installed) return true;
  for (let index = 0; index < Math.max(live.length, installed.length); index += 1) {
    const left = live[index] ?? 0;
    const right = installed[index] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
};

/**
 * Decides whether the next message can go into the running process, and what to apply to it
 * first. A respawn reason names the launch argument that changed.
 */
export function planLiveChanges(
  live: LaunchProfile,
  next: LaunchProfile,
  turn: { resumeFromScratch: boolean }
): LivePlan {
  if (turn.resumeFromScratch) return { respawn: 'the conversation restarts from scratch', changes: null };
  if (next.resumeSessionAt) return { respawn: 'an edited message resumes from an earlier point', changes: null };
  if (next.cwd !== live.cwd) return { respawn: `the working directory changed to ${next.cwd ?? 'none'}`, changes: null };
  // The installed CLI is one more launch argument: a process runs the version it was started
  // with, so a message that would reuse a host older than the binary on disk retires it and
  // spawns afresh — here, at the moment of the message, rather than leaving the conversation
  // on the old build under a label that names the new one. BOTH sides must have spoken: a
  // process that has not announced its version, or a binary that cannot be read (`null`), is a
  // "not heard", and never a reason to replace a healthy process. A pair that both sides HAVE
  // spoken must be ordered, not merely different — see `isBehindInstalled`: the installed side is
  // a reading, and a reading older than the process is not a reason to replace it.
  if (typeof live.cliVersion === 'string' && typeof next.cliVersion === 'string'
    && live.cliVersion !== next.cliVersion && isBehindInstalled(live.cliVersion, next.cliVersion)) {
    return { respawn: `cli ${live.cliVersion} → ${next.cliVersion}`, changes: null };
  }
  if (live.unknown) {
    // Re-adopted: nothing to diff against, so apply every live setter once. A bypass request
    // on a process that was not launched with it fails at the SDK and falls back to a respawn.
    return {
      respawn: null,
      changes: {
        model: next.model,
        effort: { level: next.effort, ultracode: next.ultracode },
        permissionMode: next.permissionMode,
        tools: null
      }
    };
  }
  // An unreadable config (a write in progress) is not a changed one; only a read map compares.
  if (next.mcpServers !== null && next.mcpServers !== live.mcpServers) {
    return { respawn: 'the MCP server configuration changed', changes: null };
  }
  if (next.permissionMode === 'bypassPermissions' && !live.launchedInBypass) {
    return { respawn: 'bypassing permissions needs a process launched that way', changes: null };
  }
  if (!sameList(next.disallowedTools, live.disallowedTools)) {
    return { respawn: 'the disallowed tool list changed', changes: null };
  }
  if (live.allowedTools.some((tool) => !next.allowedTools.includes(tool))) {
    return { respawn: 'a tool was removed from the allowed list', changes: null };
  }
  const effortChanged = next.effort !== live.effort || next.ultracode !== live.ultracode;
  const toolsChanged = !sameList(next.allowedTools, live.allowedTools);
  return {
    respawn: null,
    changes: {
      model: next.model !== live.model ? next.model : null,
      effort: effortChanged ? { level: next.effort, ultracode: next.ultracode } : null,
      permissionMode: next.permissionMode !== live.permissionMode ? next.permissionMode : null,
      tools: toolsChanged ? { allowed: next.allowedTools, disallowed: next.disallowedTools } : null
    }
  };
}
