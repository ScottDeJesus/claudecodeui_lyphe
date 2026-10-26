/**
 * One Claude CLI per conversation: the pieces that let a message join the process that is
 * already running for its conversation instead of starting another one.
 *
 * The first two rules of that — the prompt stream never ends on its own, and the idle clock
 * measures silence since the last MESSAGE and never closes a busy process — live in
 * `@/shared/prompt-stream.ts` beside the queue and the closer that keep them, because the
 * companion module's session needs the same two without importing this provider. They are
 * re-exported from here, so the runtime's import never moved.
 *
 * One rule this file keeps:
 * - A setting the SDK can apply to a running query is applied; one it cannot forces a fresh
 *   process. Which is which is decided here, in one place, from the SDK's real surface: `setModel`,
 *   `applyFlagSettings` (effort, and whether the house's compaction has taken the chat over),
 *   `setPermissionMode` and `setMcpServers` (the chat's tool sets, and only ever through that call:
 *   a set's servers are never a launch argument) are live, and so is GROWING the allowed
 *   tool list (a newly allowed tool merely reaches `canUseTool`, which reads the live options).
 *   cwd, the BASE MCP servers (the map `loadMcpConfig` reads, which tool sets never enter), a
 *   resume anchor, a conversation restarted from scratch, any change to the
 *   disallowed list (it shapes the model's tool context at launch), a SHRUNK allowed list (the
 *   CLI holds the launch list as allow rules it resolves before ever asking `canUseTool`) and the
 *   installed CLI version (a running process is the build it was started with) are launch
 *   arguments and are not. The version is the one launch argument that is ORDERED rather than
 *   compared: only a process behind the binary is replaced, never one ahead of a reading.
 *
 * consumer: claude-runtime.provider.js, session-host/idle-version-sweep.ts (the version rule)
 */

import { isBehindInstalled } from '@/shared/version-order.js';

import { compactionTakenOverOf } from './claude-compaction-seams.js';
import { accountRespawn } from './claude-launch-account.js';

// The queue and the idle closer moved to the shared module; the runtime still reads them here.
export {
  DEFAULT_IDLE_CLOSE_MS,
  createIdleCloser,
  createPromptQueue,
  resolveIdleCloseMs
} from '@/shared/prompt-stream.js';
export type { IdleCloser, PromptQueue } from '@/shared/prompt-stream.js';

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
  /**
   * Whether the house's compaction had taken the chat over when the process was launched, read off
   * the launch `settings` (`CLI_COMPACTION_SETTINGS`). A profile recorded before this field existed
   * has none, and reads as not taken over.
   */
  compactionTakenOver: boolean;
  /**
   * The digest of the tool-set map APPLIED to this process: '' for none, null when not known (a
   * re-adopted process, or a sync that failed, went unanswered or left a server unconnected, which
   * the next message then tries again). Not a launch argument — a set's
   * servers reach a CLI only through `setMcpServers`, so this is a live setting, kept by the sync.
   * On a profile built for a message (`launchProfileOf`) it is instead the digest that message WANTS,
   * and null when the chat has nothing in play.
   */
  toolsets: string | null;
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
  /**
   * The digest of the account this process was STARTED on, and its slug — the door's answer at the
   * spawn. `null` for a process the door gave no answer on, and for a re-adopted host whose meta
   * holds none: "not heard", which never replaces a process. On a message's own profile
   * (`launchProfileOf`) it is instead the account the house has CHOSEN now (`chosen-account.ts`), and
   * a pair of known accounts that differs is a launch argument that changed: the process is retired
   * and the conversation resumes on the new account at the message that found it.
   */
  account: string | null;
  /** The account's name in every sentence a person reads; kept beside `account` so a respawn's words need no lookup. */
  accountSlug: string | null;
};

type SdkOptionsShape = {
  cwd?: string;
  resumeSessionAt?: string;
  mcpServers?: Record<string, unknown>;
  permissionMode?: string;
  model?: string;
  effort?: string;
  settings?: Record<string, unknown> | string;
  allowedTools?: string[];
  disallowedTools?: string[];
};

export function launchProfileOf(
  sdkOptions: SdkOptionsShape,
  mcpUnreadable = false,
  unknown = false,
  cliVersion: string | null = null,
  toolsets: string | null = null,
  account: string | null = null,
  accountSlug: string | null = null
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
    compactionTakenOver: compactionTakenOverOf(sdkOptions.settings),
    toolsets,
    allowedTools: [...(sdkOptions.allowedTools ?? [])],
    disallowedTools: [...(sdkOptions.disallowedTools ?? [])],
    cliVersion: typeof cliVersion === 'string' ? cliVersion : null,
    account: typeof account === 'string' ? account : null,
    accountSlug: typeof accountSlug === 'string' ? accountSlug : null
  };
}

export type LiveChanges = {
  model: string | null;
  effort: { level: string | null; ultracode: boolean } | null;
  permissionMode: string | null;
  tools: { allowed: string[]; disallowed: string[] } | null;
  /** The new "taken over" state when it changed (applied through `applyFlagSettings`), else null. */
  compaction: boolean | null;
  /** True when the process must sync its tool sets (`setMcpServers`) before the turn. */
  toolsets: boolean;
};

export type LivePlan = { respawn: string; changes: null } | { respawn: null; changes: LiveChanges };

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

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
  // The account is one more launch argument: a process runs on the token it was started with, so a
  // message whose chosen account differs retires it and resumes the conversation on the new one. Both
  // sides must have spoken — a process the door gave no answer on, or a chosen record that is absent
  // or unreadable, is a "not heard", and never a reason to replace a healthy process.
  const accountChange = accountRespawn(live, next);
  if (accountChange) return { respawn: accountChange, changes: null };
  if (live.unknown) {
    // Re-adopted: nothing to diff against, so apply every live setter once. A bypass request
    // on a process that was not launched with it fails at the SDK and falls back to a respawn.
    return {
      respawn: null,
      changes: {
        model: next.model,
        effort: { level: next.effort, ultracode: next.ultracode },
        permissionMode: next.permissionMode,
        tools: null,
        compaction: next.compactionTakenOver,
        // Nothing is known of what the process holds; a chat with sets in play syncs once.
        toolsets: next.toolsets !== null
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
      tools: toolsChanged ? { allowed: next.allowedTools, disallowed: next.disallowedTools } : null,
      // `=== true` because a profile recorded before the field existed has none, and reads as off.
      compaction: next.compactionTakenOver !== (live.compactionTakenOver === true) ? next.compactionTakenOver : null,
      // A difference is a LIVE change, never a respawn reason; a chat with nothing in play (null) never syncs.
      toolsets: next.toolsets !== null && next.toolsets !== live.toolsets
    }
  };
}
