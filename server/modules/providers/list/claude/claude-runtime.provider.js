/**
 * Claude SDK Integration
 *
 * Runs Claude through the @anthropic-ai/claude-agent-sdk, one CLI process per CONVERSATION:
 * the first message spawns it, every later message is pushed into its open input stream, and
 * the process ends only when the conversation has been silent for the idle window and nothing
 * in it is running or watching (chat-process.ts) — or when a message carries a launch argument
 * the running process cannot take, which retires it and spawns a fresh one.
 *
 * Key features:
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import {
  appendFilesInputTag,
  buildClaudeUserContent,
  normalizeImageDescriptors
} from '@/shared/image-attachments.js';
import {
  CLAUDE_PREDEFINED_MODELS,
  CLAUDE_ULTRACODE_EFFORT
} from '@/modules/providers/list/claude/claude-models.provider.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import {
  createNotificationEvent,
  forgetPendingAction,
  notifyBackgroundWorkCompleted,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';
import { capToolResult } from '@/shared/message-unification.js';
import { userFacingEnv } from '@/shared/child-env.js';

import { armKeepaliveSpawn, keepaliveReadopt } from './session-host/index.js';
import {
  createIdleCloser,
  createPromptQueue,
  launchProfileOf,
  planLiveChanges,
  resolveIdleCloseMs
} from './chat-process.js';
import { createSignalState, detectRuntimeSignals } from './claude-runtime-signals.js';
import { installedCliVersionForLaunch } from './installed-cli-version.js';
import { SURFACE_ENV, SURFACE_PROMPT_APPEND } from './surface-signal.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();
// Query instances cancelled via abort-session. The abort handler already sent the
// terminal `complete` (aborted: true) to the client, so that instance's loop must
// not emit a second one — and keyed by instance, never by session id, so the
// process spawned for the session's next message can never inherit the flag.
const abortedInstances = new WeakSet();
// A spawn in flight per session key, from the first await to the moment its handle is
// registered: a message arriving in that window waits and joins, instead of spawning a
// second process beside it (measured as a real race on boot re-adoption).
const spawning = new Map();
// Query instances interrupted because a newer run took over their session id
// (see addSession). Their run loops must stay silent on wind-down: the map
// entry, the abort flag, and all client-facing events belong to the new run.
const supersededInstances = new WeakSet();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;

// Passed to the spawned CLI as CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: how long, AFTER its stdin
// has ended, the CLI waits for still-running background tasks before killing them and exiting.
// On this path stdin ends only once nothing is running (the idle closer asks first — see
// chat-process.ts), on a Stop with nothing left to hear from, on a Stop whose interrupt went
// unanswered, or on a retirement for a launch-bound setting. So this ceiling is the backstop for a
// task that started in the gap between that check and the EOF, never the normal way a process
// ends — and never on the Stop that keeps its process alive for the tasks it still has running
// (abortClaudeSDKSession).
const BG_WAIT_CEILING_MS = 30 * 60 * 1000;
// How long after a `task_notification` a zero-turn result can still be the
// CLI's own reconciliation of an orphaned background task (see queryClaudeSDK).
const RECONCILIATION_WINDOW_MS = 10 * 1000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);
// The permission modes in which the SDK answers for the user and never calls `canUseTool`:
// there, the PreToolUse hook is the only door an interactive tool can reach a human through.
const HOOK_MODES = new Set(['bypassPermissions', 'auto', 'dontAsk']);

// Ultracode is a session-scoped setting rather than an SDK effort level: it pairs xhigh
// effort with standing dynamic-workflow orchestration, and the CLI only honours it when
// Workflows are enabled. The catalog offers it as an effort choice for the picker, so the
// selection is translated back into the two options the SDK actually understands here.
const ULTRACODE_SDK_EFFORT = 'xhigh';

function resolveClaudeEffort(model, effort, modelsDefinition = CLAUDE_PREDEFINED_MODELS) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model) || null;
  const allowedEfforts = selectedModel?.effort?.values
    ?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

/**
 * Writes the resolved effort choice onto the SDK options, expanding `ultracode` into the
 * xhigh effort level plus the session-scoped settings it requires.
 * @param {Object} sdkOptions - SDK options being built
 * @param {string|undefined} resolvedEffort - Catalog-validated effort selection
 */
function applyClaudeEffort(sdkOptions, resolvedEffort) {
  if (!resolvedEffort) {
    return;
  }

  if (resolvedEffort !== CLAUDE_ULTRACODE_EFFORT) {
    sdkOptions.effort = resolvedEffort;
    return;
  }

  sdkOptions.effort = ULTRACODE_SDK_EFFORT;
  sdkOptions.settings = {
    ...(sdkOptions.settings || {}),
    ultracode: true,
    enableWorkflows: true
  };
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

/**
 * The identity of ONE ask — the same in the process that raised it and in the successor that
 * re-issues it after a handover.
 *
 * The request id beside it is minted per ATTEMPT, and that is the whole bug: a re-adopted host
 * replays the CLI's parked `can_use_tool` request, so the successor asks again on a fresh id, and
 * everything keyed on that id — the notification's dedupe key, the phone's answer buttons — reads
 * one question as two. The tool use id is the CLI's own name for the call and survives the replay
 * untouched (measured 2026-09-22: 12 phone pushes for one question, one per dev-server handover).
 *
 * Falls back to the ask's own content when the SDK hands no tool use id over: an ask nothing
 * stamped can only be told apart by what it asks.
 */
function promptKeyFor(toolUseId, sessionId, toolName, input) {
  if (typeof toolUseId === 'string' && toolUseId) {
    return `toolu:${toolUseId}`;
  }
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([sessionId ?? null, toolName, input ?? null]))
    .digest('hex')
    .slice(0, 32);
  return `ask:${digest}`;
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

/**
 * The approval waiting on one PROMPT, whichever attempt raised it.
 *
 * A tap on the phone names the prompt, never this process's attempt at it: the push was minted by
 * a predecessor, whose request id this process has never heard of — but whose question it is
 * asking again right now under that same tool use id. Request ids and prompt keys cannot collide:
 * one is a bare uuid, the other carries a `toolu:`/`ask:` prefix.
 */
function findByPromptKey(promptKey) {
  for (const resolver of pendingToolApprovals.values()) {
    if (resolver._promptKey === promptKey) {
      return resolver;
    }
  }
  return undefined;
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId) ?? findByPromptKey(requestId);
  if (resolver) {
    resolver(decision);
    return;
  }
  // A request this process never held: answered already, timed out, or a prompt raised by a
  // predecessor that is no longer pending anywhere (its successor never re-issued it).
  console.warn(`[permission] decision for unknown request ${requestId}: no pending approval in this process`);
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

function mapCliOptionsToSDK(options = {}) {
  const { providerSessionId, cwd, toolsSettings, permissionMode, effort, resumeAnchorId, resumeFromScratch } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  sdkOptions.env = { ...userFacingEnv(), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(BG_WAIT_CEILING_MS), ...SURFACE_ENV };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  // When nothing resolves the option stays unset on purpose: the SDK then falls back to the
  // binary it ships, which beats handing it a bare `claude` that raw spawn can never launch.
  const claudeExecutablePath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  if (claudeExecutablePath) {
    sdkOptions.pathToClaudeCodeExecutable = claudeExecutablePath;
  }

  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  if (settings.skipPermissions && permissionMode !== 'plan') {
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  sdkOptions.model = options.model || CLAUDE_PREDEFINED_MODELS.DEFAULT;

  applyClaudeEffort(sdkOptions, resolveClaudeEffort(
    sdkOptions.model,
    effort,
    options.effortModels || CLAUDE_PREDEFINED_MODELS,
  ));

  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code',
    append: SURFACE_PROMPT_APPEND
  };

  sdkOptions.settingSources = ['project', 'user', 'local'];

  // The SDK resumes with the provider-native session id, never the app id.
  // `resumeFromScratch` is set when the very first prompt of a conversation was
  // edited: there is nothing before it to resume through, so the turn has to
  // start the conversation over instead.
  if (providerSessionId && !resumeFromScratch) {
    sdkOptions.resume = providerSessionId;

    // Editing an already-sent message re-runs the conversation truncated just
    // before it. `resumeSessionAt` is inclusive of the uuid it names, so the
    // caller resolves the last row to KEEP and passes that — never the edited
    // turn itself, which would leave the original prompt in context.
    if (resumeAnchorId) {
      sdkOptions.resumeSessionAt = resumeAnchorId;
    }
  }

  return sdkOptions;
}

/**
 * Registers the conversation's live process under its session key.
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Object} process - The handle later messages join through (spawnProcess)
 */
function addSession(sessionId, queryInstance, process = null) {
  const existing = activeSessions.get(sessionId);
  // A different live instance under the same key means an earlier process was
  // superseded without being retired (e.g. an abort that raced spawn and found
  // nothing to interrupt). Overwriting it here would strand its loop forever —
  // this map entry is the only handle on it. Retire it directly rather than via
  // abortClaudeSDKSession, which would also send the client an aborted `complete`.
  const superseding = Boolean(
    existing && existing.status === 'active' && existing.instance && existing.instance !== queryInstance
  );
  if (superseding) {
    if (existing.process) {
      // Interrupt first over the open stdin, then EOF (see queryClaudeSDK) — and that EOF is what
      // ends any background work this process still has running, with its CLI. A process a Stop
      // kept alive for exactly that work (abortClaudeSDKSession) is retired here the moment the
      // next message changes a launch argument, and the loss is otherwise silent: the completion
      // that was going to land in this chat simply never arrives.
      if (existing.process.hasBackgroundWork === true) {
        console.warn(
          `[Claude SDK] Session ${sessionId} is respawning for a changed launch argument while background work is still running; the retirement that follows ends that work`
        );
      }
      void existing.process.retire();
    } else {
      supersededInstances.add(existing.instance);
    }
  }
  const carried = superseding ? null : existing;
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: carried?.startTime || Date.now(),
    status: 'active',
    // Re-registered mid-run once the provider session id lands; keep the handle.
    process: process || carried?.process || null
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}


/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 *
 * The SDK's live envelope spells two fields in snake_case that the transcript on disk — and
 * therefore `normalizeMessage`, which serves both — spells in camelCase. `parent_tool_use_id`
 * was mapped from the start. `tool_use_result` was not, and the cost was invisible until
 * measured: a backgrounded agent's launch receipt carries `isAsync: true` INSIDE it, the only
 * evidence that a tool result is a receipt rather than a finish, so on the live path every
 * background agent read as finished the moment it launched and never reached the chat's pinned
 * rows — the rows drawn in the strip above the chat box when the desktop chat gutters are not
 * showing, and in the gutter's Subagents widget while they are (`PinnedSubagents.tsx`). The same
 * row read correctly after a reload, because the history reader takes the field from the JSONL.
 * Measured 2026-09-10 with a live agent: the pinned rows empty, the row already stamped "4 tools".
 * Both spellings are mapped here so the normalizer sees one shape from either door.
 */
function transformMessage(sdkMessage) {
  const mapped = { ...sdkMessage };
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    mapped.parentToolUseId = sdkMessage.parent_tool_use_id;
  }
  if (sdkMessage.tool_use_result !== undefined && mapped.toolUseResult === undefined) {
    mapped.toolUseResult = sdkMessage.tool_use_result;
  }
  return mapped;
}

/**
 * True for the user bubble the SDK echoes for a subagent's own prompt.
 *
 * Subagent traffic carries `parent_tool_use_id`, so this echo lands in the main
 * thread and stacks a second copy of the prompt right below the Agent tool card
 * that already displays it. It also disappears on reload, because the transcript
 * keeps that turn in the subagent's sidechain rather than the session file.
 * @param {Object} message - Normalized message about to be sent to the client
 * @returns {boolean}
 */
export function isSubagentPromptEcho(message) {
  return Boolean(message?.parentToolUseId) && message.role === 'user' && message.kind === 'text';
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @typedef {Object} TokenBudget
 * @property {number} used
 * @property {number} total
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheCreationTokens]
 * @property {number} [cacheTokens]
 * @property {{ input: number, output: number }} breakdown
 */

/**
 * Builds a context-window budget from an Anthropic-shaped usage payload.
 *
 * `input_tokens + cache_read + cache_creation` is one request's whole prompt,
 * which is exactly what the context window holds at that moment.
 * @param {Object} messageUsage - Anthropic usage payload
 * @returns {TokenBudget} Token budget object
 */
function buildTokenBudget(messageUsage) {
  const directInputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
  const cacheCreationTokens = readNumber(messageUsage.cache_creation_input_tokens ?? messageUsage.cacheCreationInputTokens ?? messageUsage.cacheCreationTokens);
  const cacheReadTokens = readNumber(messageUsage.cache_read_input_tokens ?? messageUsage.cacheReadInputTokens ?? messageUsage.cacheReadTokens);
  const cacheTokens = cacheCreationTokens + cacheReadTokens;
  const inputTokens = directInputTokens + cacheTokens;
  const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW, 10) || 160000;

  return {
    used: inputTokens + outputTokens,
    total: contextWindow,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Extracts the session's context-window usage from an SDK stream message.
 *
 * Only assistant messages describe the context window: each one reports the
 * prompt its own request carried. The turn-ending `result` is deliberately not
 * a source here — see `extractCumulativeTokenBudget`.
 * @param {Object} sdkMessage - SDK stream message
 * @returns {TokenBudget|null} Token budget object or null
 */
function extractTokenBudget(sdkMessage) {
  if (!sdkMessage || typeof sdkMessage !== 'object') {
    return null;
  }

  // Subagent traffic (parent_tool_use_id set) reports the subagent's own
  // context window, not this session's — surfacing it makes the counter drop
  // to the subagent's number and bounce back on the next main-thread event.
  if (sdkMessage.parent_tool_use_id) {
    return null;
  }

  // Only assistant messages carry Anthropic-shaped usage. System
  // task_progress/task_notification events have a top-level `usage` too, but
  // shaped {total_tokens, tool_uses, duration_ms} — reading Anthropic keys
  // off it yields an all-zero budget that flashes "0" in the composer.
  if (sdkMessage.type !== 'assistant') {
    return null;
  }

  const messageUsage = sdkMessage.message?.usage;
  if (!messageUsage || typeof messageUsage !== 'object') {
    return null;
  }

  return buildTokenBudget(messageUsage);
}

/**
 * Last-resort budget read from a turn's `result` message.
 *
 * `result.usage` and `result.modelUsage` are the turn's *bill*: every request
 * the turn made, summed, including each subagent's. A turn that made four
 * requests therefore reports roughly four times the context the conversation
 * actually holds, so publishing it made the counter leap at the end of a turn
 * and fall back on the next assistant message — worst with subagents running,
 * whose requests inflate the sum without ever entering this session's context.
 *
 * It is still the only usage an SDK build that reports none per assistant
 * message ever emits, so it stays available for the caller to use when a turn
 * produced no assistant budget at all.
 * @param {Object} sdkMessage - SDK stream message
 * @returns {TokenBudget|null} Token budget object or null
 */
function extractCumulativeTokenBudget(sdkMessage) {
  if (!sdkMessage || typeof sdkMessage !== 'object' || sdkMessage.type !== 'result') {
    return null;
  }

  if (sdkMessage.usage && typeof sdkMessage.usage === 'object') {
    return buildTokenBudget(sdkMessage.usage);
  }

  if (!sdkMessage.modelUsage || typeof sdkMessage.modelUsage !== 'object') {
    return null;
  }

  // Fallback for older SDK messages with only modelUsage
  const modelKey = Object.keys(sdkMessage.modelUsage)[0];
  const modelData = sdkMessage.modelUsage[modelKey];

  if (!modelData || typeof modelData !== 'object') {
    return null;
  }

  const inputTokens = readNumber(modelData.cumulativeInputTokens ?? modelData.inputTokens);
  const outputTokens = readNumber(modelData.cumulativeOutputTokens ?? modelData.outputTokens);
  const totalUsed = inputTokens + outputTokens;
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW, 10) || 160000;

  return {
    used: totalUsed,
    total: contextWindow,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

// Tool calls that leave work running past the end of a turn. Bash only counts
// when it is explicitly backgrounded; the rest defer or watch work by nature.
const DEFERRED_WORK_TOOLS = new Set(['Monitor', 'ScheduleWakeup', 'CronCreate', 'TaskCreate']);

/**
 * The ids of the tool calls in a message that keep working after the turn's `result` arrives —
 * each one is expected to report back on its own, and the process is held for every one of
 * them until it does.
 *
 * @param {Object} sdkMessage - SDK stream message
 * @returns {string[]} The launching calls' tool-use ids
 */
function backgroundWorkIds(sdkMessage) {
  const content = sdkMessage?.message?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((block) => {
      if (block?.type !== 'tool_use' || typeof block.id !== 'string') {
        return false;
      }
      if (block.name === 'Bash') {
        return block.input?.run_in_background === true;
      }
      return DEFERRED_WORK_TOOLS.has(block.name);
    })
    .map((block) => block.id);
}

/**
 * Builds the SDK user messages for one turn.
 *
 * Always returns SDKUserMessage records rather than a bare string: a string
 * prompt makes the SDK flag the query as single-turn and close stdin the moment
 * the turn's `result` arrives, which kills the CLI's background tasks — and
 * ends the process the next message would have joined. Plain
 * text turns carry string content; turns with image attachments carry the
 * prompt text plus one base64 `image` block per attachment (read from the
 * global `~/.cloudcli/assets` folder).
 *
 * @param {string} command - User prompt
 * @param {Array} images - Image descriptors ({ path, name?, mimeType? })
 * @param {Array} files - Non-image attachment descriptors
 * @param {string} cwd - Project working directory attachment paths resolve against
 * @returns {Promise<Array<Object>>} SDKUserMessage records for the turn
 */
async function buildPromptMessages(command, images, files, cwd) {
  const promptWithFiles = appendFilesInputTag(command, files);
  const content = normalizeImageDescriptors(images).length === 0
    ? promptWithFiles
    : await buildClaudeUserContent(promptWithFiles, images, cwd);

  return [{
    type: 'user',
    message: {
      role: 'user',
      content
    },
    parent_tool_use_id: null,
    // Echoed back on the `result` that answers this message (`user_message_uuids`), which is
    // how the process loop tells the turn's own result from a background follow-up's.
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString()
  }];
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
const MCP_CONFIG_UNREADABLE = Symbol('mcp config unreadable');

async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file. A file that exists but cannot be read or parsed — a write
    // in progress, typically — is reported as such, not as "no servers": a running process
    // must not be retired over a config that merely blinked.
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return MCP_CONFIG_UNREADABLE;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Runs one user turn on the conversation's Claude process.
 *
 * One CLI per conversation. The first message spawns it; every later message is pushed into
 * that process's open input stream, after any setting the SDK can change live has been applied
 * to it. The promise returned here settles when THIS turn's `result` lands — the process keeps
 * running, owned by `spawnProcess`'s loop, until the idle closer ends it (chat-process.ts) or a
 * message arrives with a launch argument the running process cannot take. That message retires
 * the process — interrupt FIRST, then end-of-input — and spawns a fresh one. The other order
 * (end-of-input, then interrupt) wrote the interrupt into a stdin the SDK had already ended, so
 * it never arrived and a process holding a watcher outlived every "close" for its whole
 * ceiling: measured 2026-09-11 as four processes, ~400 MB each, for one conversation.
 *
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - The run's writer
 * @param {Object} context - Provider-scoped model, session, and auth lookups
 * @returns {Promise<void>} Settles when the turn ends
 */
async function queryClaudeSDK(command, options = {}, ws, context) {
  const { sessionId } = options;
  if (sessionId && !keepaliveReadopt(options.keepalive, sessionId)) {
    // A spawn for this session may still be registering its handle (boot re-adoption, or the
    // session's first message a moment ago): wait for it rather than spawn beside it — but
    // never for ever, in case the spawn itself is wedged before it can release.
    const reservation = spawning.get(sessionId);
    if (reservation) {
      await Promise.race([reservation, new Promise((resolve) => setTimeout(resolve, SPAWN_WAIT_MS).unref())]);
    }
    const live = getSession(sessionId)?.process ?? null;
    if (live && !live.closing) {
      // The turn's promise comes back WRAPPED: an `await` on the bare promise would wait for
      // the turn to end and then read its (empty) value as "did not join" — and spawn a second
      // process after every joined turn. Measured 2026-09-11 on the reuse probe.
      const joined = await joinProcess(live, command, options, ws, context);
      if (joined) {
        return joined.turnEnded;
      }
    }
  }
  return spawnProcess(command, options, ws, context);
}

/** The SDK options one message asks for, resolved the same way whether it spawns or joins. */
async function resolveSdkOptions(options, context) {
  const { sessionId } = options;
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const resolvedModel = await context.resolveResumeModel(sessionId, options.model);
  let effortModels = CLAUDE_PREDEFINED_MODELS;
  try {
    effortModels = await context.getProviderModels();
  } catch (error) {
    console.warn('[Claude SDK] Unable to load provider models for effort validation:', error);
  }
  const sdkOptions = mapCliOptionsToSDK({
    ...options,
    providerSessionId,
    model: resolvedModel || options.model,
    effortModels,
  });
  const mcpServers = await loadMcpConfig(options.cwd);
  const mcpUnreadable = mcpServers === MCP_CONFIG_UNREADABLE;
  if (mcpServers && !mcpUnreadable) {
    sdkOptions.mcpServers = mcpServers;
  }
  return { sdkOptions, mcpUnreadable };
}

/**
 * Pushes the message into the running process and returns `{ turnEnded }` — the turn's own
 * promise, wrapped so the caller's `await` does not unwrap it — or retires that process and
 * returns null when the message carries a launch argument it cannot take (the caller then
 * spawns afresh).
 */
async function joinProcess(live, command, options, ws, context) {
  const { sessionId } = options;
  const resolved = await resolveSdkOptions(options, context);
  // Asked ONLY when the running process has announced a version of its own: with nothing to
  // compare it against, this would spend a probe (and on a cold cache a subprocess) on the send
  // path for an answer nothing reads.
  const installedCliVersion = typeof live.profile?.cliVersion === 'string'
    ? await installedCliVersionForLaunch()
    : null;
  const next = launchProfileOf(resolved.sdkOptions, resolved.mcpUnreadable, false, installedCliVersion);
  const plan = planLiveChanges(live.profile, next, { resumeFromScratch: options.resumeFromScratch === true });
  if (plan.respawn) {
    console.log(`[Claude SDK] Replacing the process for session ${sessionId}: ${plan.respawn}`);
    await live.retire();
    return null;
  }
  try {
    await live.applyChanges(plan.changes, next);
  } catch (error) {
    console.warn(`[Claude SDK] A setting could not be applied to the live process for session ${sessionId}; replacing it:`, error?.message || error);
    await live.retire();
    return null;
  }
  const messages = await buildPromptMessages(command, options.images, options.files, options.cwd);
  const turnEnded = live.pushTurn(messages, ws, options);
  return turnEnded ? { turnEnded } : null;
}

// How long a process gets to answer a control request — an interrupt on a retirement or a Stop, a
// setting applied to it live — before it is treated as unresponsive: a retiring one has its stdin
// ended anyway, a stopped one is killed, and a message that could not apply its settings is sent to
// a fresh process instead.
const INTERRUPT_GRACE_MS = 5_000;

/**
 * Awaits one control request, rejecting when the CLI has not answered within INTERRUPT_GRACE_MS.
 * A wedged CLI answers none, and unbounded they hang whatever awaits them for good.
 */
async function withinGrace(request, what) {
  let timer;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} was not answered within ${INTERRUPT_GRACE_MS} ms`)), INTERRUPT_GRACE_MS);
        timer.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
    // A late rejection from the abandoned request is expected once the process is replaced.
    Promise.resolve(request).catch(() => {});
  }
}
// How long a message waits on a spawn still registering its handle before looking for itself.
const SPAWN_WAIT_MS = 10_000;

/**
 * Spawns the conversation's process and runs its message loop for the life of that process.
 * Returns when the FIRST turn ends; the loop carries on, serving every turn pushed in later.
 */
async function spawnProcess(command, options, initialWs, context) {
  const { sessionId } = options;
  // Rebound on every turn that joins: the run's writer, and the name notifications carry.
  let ws = initialWs;
  let sessionSummary = options.sessionSummary;
  const reattach = keepaliveReadopt(options.keepalive, sessionId);
  // Callers pass the stable app session id; the SDK only understands the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  // Provider-native id as the SDK reports it (starts as the resume id, or is
  // captured from the stream for brand-new sessions).
  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  // Process-map key: the app session id when the caller supplied one, else
  // the provider-native id once captured (legacy/direct API callers).
  const sessionKey = () => sessionId || capturedSessionId || null;

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };
  // Limits, retries and failed results, watched for the life of this process. `runUserId` is a
  // VALUE taken at spawn, never a read of `ws`: a reset timer fires up to a day later.
  const signalState = createSignalState();
  const runUserId = ws?.userId || null;

  // The turn a client is waiting on, or null between turns. `uuid` is stamped on the user
  // message and echoed on the `result` that answers it (`user_message_uuids`) — the only way
  // to tell that result from one a background follow-up turn produces in the same stream. A
  // re-adopted turn has no uuid on record and takes the next result, as it always did.
  let pendingTurn = null;
  // Set when a Stop interrupts this process's turn but keeps the process for the background work
  // still in flight (abortClaudeSDKSession). The aborted turn's client-facing events stay
  // suppressed through its own `result`; this flag is what ends that suppression — see the result
  // branch for why a leaked suppression breaks the next message to join this process.
  let stoppedTurnPending = false;
  const openTurn = (uuid) => {
    pendingTurn?.settle();
    let settle;
    const settled = new Promise((resolve) => { settle = resolve; });
    pendingTurn = { uuid, settle };
    return settled;
  };
  const settleTurn = () => {
    const turn = pendingTurn;
    pendingTurn = null;
    turn?.settle();
  };
  // What this call returns: the first turn's end. Resolved at once for a re-adopted process
  // whose turn had already completed before the API restarted, and by the loop's `finally`
  // when the process fails before that turn is even opened.
  let settleFirstTurn;
  const firstTurnSettled = new Promise((resolve) => { settleFirstTurn = resolve; });

  // Tool calls seen during the current turn that leave work running past its `result`; moved
  // into `deferredTools` at that result.
  const launchedThisTurn = new Set();
  // The tool-call ids whose work is still outstanding and will report back — released by the
  // `task_notification` that names the call, or, for work the task system never lists (a
  // scheduled wake-up, a cron), by the follow-up turn it pushes. Identity, not a count: two
  // completions folded into one follow-up turn release both. Persisted in the host meta and
  // restored on re-adoption; an older host's meta carries only the bit, restored as one entry.
  const deferredTools = new Set(reattach?.deferredTools ?? []);
  if (reattach?.heldForBackgroundWork === true && deferredTools.size === 0) deferredTools.add('re-adopted');
  const heldForBackgroundWork = () => deferredTools.size > 0;
  const turnBits = (turnCompleteSent) => ({
    turnCompleteSent,
    heldForBackgroundWork: heldForBackgroundWork(),
    deferredTools: [...deferredTools]
  });
  // The CLI is between an `init` and its `result`: a user turn, or a follow-up turn a task
  // completion pushed on its own. Either way the process must not be closed under it.
  let turnInFlight = false;
  // The CLI's own level signal for live background tasks — watchers included — replaced on
  // every `background_tasks_changed` (its documented REPLACE semantics) and edged by the
  // task bookends in between. Empty until the first change after (re)start.
  const backgroundTasks = new Set();
  // Set once a turn publishes a budget read from an assistant message, so the
  // turn-ending `result` is only mined for usage when nothing better arrived.
  let assistantBudgetSent = false;
  // The reconciliation window. On resume the CLI first closes out any
  // background task its previous process took down with it — what retiring a
  // process for a launch-bound setting leaves behind — as a synthetic query of
  // its own: `system/task_notification` → `system/init` → `result {success,
  // num_turns: 0, result: ''}` → a second `system/init` that opens the user's
  // real query. Read as the turn ending, that phantom result sent `complete`
  // ahead of the answer. Measured 2026-09-08, CLI 2.1.263 / SDK 0.3.165.
  //
  // INVARIANT: the window is only ever open BEFORE this process's first handled
  // result. A local slash command (`/model`) also yields a zero-turn, empty
  // result, and swallowing a real terminal result leaves the run `running` in
  // the registry with no result coming — the session wedges. So the window
  // closes on the init that follows a skipped result, and in any case
  // RECONCILIATION_WINDOW_MS after it opened (the phantom lands ~50 ms after the
  // notification; a user's turn cannot).
  let firstResultHandled = reattach?.turnCompleteSent === true;
  let reconciliationPending = false;
  let reconciliationArmedAt = 0;
  let reconciliationSkipped = false;

  let queryInstance = null;
  let queue = null;
  let keepalive = null;
  let sdkOptions = null;
  let idle = null;
  let closing = false;
  let profile = null;

  // The CLI's version, as THAT process's own init reported it — the one source, read twice: the
  // run registry's stamp (what the report and the client's banner compare against the installed
  // binary) and the live profile (what decides, at the next message, whether this process is
  // older than the binary on disk). Never the installed binary's version: that is a different
  // process's fact, and it arrives here only through a re-adoption's own record.
  const noteReportedCliVersion = (version) => {
    if (typeof ws.setCliVersion === 'function') ws.setCliVersion(version);
    profile.cliVersion = version;
  };

  // Work this process started that outlives the turn that started it: a backgrounded subagent or
  // Bash job, a watcher, a scheduled wake-up. Two witnesses, because one alone misses: `deferredTools`
  // is this loop's own ledger of the calls that leave work behind, and `backgroundTasks` is the CLI's
  // level signal for the same tasks (`task_started`/`task_notification` bookends — the set the CLI
  // fills for a background Agent and a background Bash alike, measured 2026-09-22). Asked by the idle
  // closer, and by a Stop deciding whether this process still has an answer coming.
  const hasBackgroundWork = () => heldForBackgroundWork() || backgroundTasks.size > 0;
  const isBusy = () => pendingTurn !== null || turnInFlight || hasBackgroundWork();
  const processAbort = new AbortController();

  // The handle later messages join through, registered under the session key.
  const handle = {
    get closing() {
      return closing;
    },
    get profile() {
      return profile;
    },
    // Kills the CLI outright, for a process that did not answer an interrupt: a CLI that ignores
    // the interrupt control request will not act on the EOF `close()` sends either.
    kill() {
      closing = true;
      idle?.cancel();
      queue?.end();
      processAbort.abort();
    },
    // Ends stdin; the CLI exits within ~300 ms when nothing is running. A task that slipped in
    // between the busy check and the EOF rides the CLI's own ceiling (BG_WAIT_CEILING_MS).
    close() {
      if (closing) return;
      closing = true;
      idle?.cancel();
      queue?.end();
    },
    /**
     * True while work this process started is still running past the end of its turn. Asked by a
     * Stop, to decide whether this process still has an answer coming (abortClaudeSDKSession).
     */
    get hasBackgroundWork() {
      return hasBackgroundWork();
    },
    /**
     * A Stop ended this process's turn but left the process running for the background work still
     * in flight. The turn is already over for the client — the abort handler sent its `complete` —
     * so it is over here too: settling it keeps `isBusy` honest, and the idle closer then ends the
     * process once the background work does, exactly as after a normal turn.
     */
    stopTurn() {
      stoppedTurnPending = true;
      settleTurn();
    },
    // Interrupt FIRST, over the still-open stdin, so the CLI stops what it is doing, then EOF.
    // The interrupt ends the TURN and nothing else — it is the EOF that winds the process down,
    // and a background task still running at that EOF dies with the CLI. Silent on the wire: the
    // run that retired it owns every client-facing event from here.
    async retire() {
      if (closing) return;
      closing = true;
      supersededInstances.add(queryInstance);
      try {
        await Promise.race([
          queryInstance.interrupt(),
          new Promise((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS).unref())
        ]);
      } catch (error) {
        console.log(`[Claude SDK] Interrupt while retiring the process for session ${sessionKey()}: ${error?.message || error}`);
      }
      idle?.cancel();
      queue?.end();
    },
    // Everything the SDK can change on a running query (see chat-process.ts). `sdkOptions` is
    // what `canUseTool` reads on every call, so the permission fields are mutated in place.
    async applyChanges(changes, next) {
      const applied = Object.entries(changes).filter(([, value]) => value !== null).map(([key]) => key);
      if (applied.length > 0) {
        console.log(`[Claude SDK] Applying to the running process for session ${sessionKey()}: ${applied.join(', ')}`);
      }
      if (changes.model) {
        await withinGrace(queryInstance.setModel(changes.model), 'setModel');
        profile.model = next.model;
      }
      if (changes.effort) {
        await withinGrace(queryInstance.applyFlagSettings({
          effortLevel: changes.effort.level,
          ultracode: changes.effort.ultracode || null,
          enableWorkflows: changes.effort.ultracode || null
        }), 'applyFlagSettings');
        profile.effort = next.effort;
        profile.ultracode = next.ultracode;
      }
      if (changes.permissionMode) {
        await withinGrace(queryInstance.setPermissionMode(changes.permissionMode), 'setPermissionMode');
        sdkOptions.permissionMode = changes.permissionMode;
        profile.permissionMode = next.permissionMode;
      }
      if (changes.tools) {
        sdkOptions.allowedTools = [...changes.tools.allowed];
        sdkOptions.disallowedTools = [...changes.tools.disallowed];
        profile.allowedTools = [...changes.tools.allowed];
        profile.disallowedTools = [...changes.tools.disallowed];
      }
      if (profile.unknown) {
        // The first message after re-adoption IS the profile from here on — every field but
        // its CLI version: `next` carries the INSTALLED binary's version, and a process's own
        // version is only ever the one its init announced. Adopting that one would mark an
        // unread host current for as long as it lives.
        const announced = profile.cliVersion;
        Object.assign(profile, next, { unknown: false, cliVersion: announced });
        sdkOptions.allowedTools = [...next.allowedTools];
        sdkOptions.disallowedTools = [...next.disallowedTools];
      }
    },
    /** Binds the turn to this process and queues its message; null once the process is closing. */
    pushTurn(messages, nextWs, nextOptions) {
      if (closing || !queue) return null;
      ws = nextWs;
      sessionSummary = nextOptions.sessionSummary;
      if (capturedSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }
      assistantBudgetSent = false;
      const settled = openTurn(messages[0]?.uuid ?? null);
      for (const message of messages) {
        queue.push(message);
      }
      idle?.touch(resolveIdleCloseMs(nextOptions.idleCloseMs));
      keepalive?.note({ ...turnBits(false), ack: false });
      console.log(`[Claude SDK] Message joined the running process for session ${sessionKey()}`);
      return settled;
    }
  };

  // THE ONLY PLACE THE ENTRY GOES, and it is the `finally` alone — the one moment that
  // coincides with process exit, since the loop cannot end until the CLI has. The entry must
  // live exactly as long as the process does: it is the handle every later message joins
  // through, and a turn ending is NOT the process ending. Retiring at turn-completion instead
  // left a live CLI with no handle, so the next turn started a second process beside it.
  // Measured 2026-09-08: four CLI processes for one conversation.
  const retireSession = () => {
    if (sessionKey() && getSession(sessionKey())?.instance === queryInstance) {
      removeSession(sessionKey());
    }
  };

  // Reserved synchronously, before the first await, and released once the handle is
  // registered (or the spawn has failed): see `spawning`.
  let releaseReservation = () => {};
  if (sessionId) {
    const reservation = new Promise((resolve) => {
      releaseReservation = () => {
        if (spawning.get(sessionId) === reservation) spawning.delete(sessionId);
        resolve();
      };
    });
    spawning.set(sessionId, reservation);
  }

  const runLoop = async () => {
    try {
      const resolved = await resolveSdkOptions(options, context);
      sdkOptions = resolved.sdkOptions;
      // Ours, so Stop can end a process that will not answer an interrupt: aborting it has the SDK
      // close the transport and kill the CLI (SIGTERM, then SIGKILL) — through the host when there is one.
      sdkOptions.abortController = processAbort;
      // A re-adopted process answers to the profile its host recorded at spawn; only a host
      // from before that field leaves it unknown. Its CLI version is the one that process
      // announced at init, read out of the host's own record of it — never the installed
      // binary's, which is a different process and may be a newer build.
      const reportedCliVersion = reattach ? (reattach.cliVersion ?? null) : null;
      profile = reattach
        ? (reattach.profile
            ? { ...reattach.profile, unknown: false, cliVersion: reportedCliVersion }
            : launchProfileOf(sdkOptions, resolved.mcpUnreadable, true, reportedCliVersion))
        : launchProfileOf(sdkOptions, resolved.mcpUnreadable);
      // Known the moment the run is adopted, so the report (and the banner beside the
      // transcript) never reads a live host as "not heard yet" until its next turn.
      if (reportedCliVersion && typeof ws.setCliVersion === 'function') ws.setCliVersion(reportedCliVersion);
      keepalive = armKeepaliveSpawn(sdkOptions, {
        appSessionId: sessionId ?? null,
        userId: ws?.userId ?? null,
        reattach: reattach ?? null,
        profile: reattach ? null : { ...profile }
      });

      // Streaming input, always: the queue keeps stdin open for the life of the process. A
      // re-adopted process is joined with no prompt at all — its turn is already in the CLI.
      const promptMessages = reattach ? [] : await buildPromptMessages(command, options.images, options.files, options.cwd);
      if (reattach?.turnCompleteSent) {
        settleFirstTurn();
      } else {
        openTurn(reattach ? null : (promptMessages[0]?.uuid ?? null)).then(settleFirstTurn);
      }

      // Asking a human, in one place: the `permission_request` frame, the push that carries it to
      // a phone, the wait, the `permission_resolved` that retracts it. Two callers — `canUseTool`,
      // and the PreToolUse hook for the modes that never reach it.
      const promptForToolDecision = async (toolName, input, { signal, requiresInteraction, toolUseId = null }) => {
        const requestId = createRequestId();
        // The ask's own name, shared with every successor that re-issues it. The push is keyed on
        // THIS, the in-app frame on the request id: a re-issue must put the question back on the
        // chat's wire while never buzzing the phone a second time for it.
        const promptKey = promptKeyFor(toolUseId, sessionId || capturedSessionId, toolName, input);
        ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        emitNotification(createNotificationEvent({
          provider: 'claude',
          sessionId: sessionId || capturedSessionId || null,
          kind: 'action_required',
          code: 'permission.required',
          // The request id and the raw input are what a push needs to be answerable from the phone;
          // the prompt key is what tells a successor this question has already been pushed.
          meta: { toolName, sessionName: sessionSummary, requestId, promptKey, toolInput: input },
          severity: 'warning',
          requiresUserAction: true,
          dedupeKey: `claude:permission:${sessionId || capturedSessionId || 'none'}:${promptKey}`
        }));

        const decision = await waitForToolApproval(requestId, {
          timeoutMs: requiresInteraction ? 0 : undefined,
          signal,
          metadata: {
            // Keyed by the app session id so `chat.subscribe` can look pending
            // approvals up directly; provider id only for legacy callers.
            _sessionId: sessionId || capturedSessionId || null,
            _toolName: toolName,
            _input: input,
            _promptKey: promptKey,
            _receivedAt: new Date(),
          },
          onCancel: (reason) => {
            ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
          }
        });
        // This ask is settled here, whichever door it came through — the app's panel or a tap on
        // the phone. A phone button of the same prompt must stop answering 200 for a question that
        // is over, and this is the only moment the runtime knows it is.
        forgetPendingAction(promptKey);
        if (!decision) {
          return { behavior: 'deny', message: 'Permission request timed out' };
        }

        if (decision.cancelled) {
          return { behavior: 'deny', message: 'Permission request cancelled' };
        }

        // A client answered. Announce it on the run stream so the replay buffer
        // and every other attached tab drop the prompt — resolving happens over
        // the inbound socket only, so without this a mid-run page refresh
        // replays the `permission_request` with nothing to retract it and the
        // already-answered prompt resurrects.
        ws.send(createNormalizedMessage({ kind: 'permission_resolved', requestId, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));

        if (decision.allow) {
          if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
            if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
              sdkOptions.allowedTools.push(decision.rememberEntry);
            }
            if (Array.isArray(sdkOptions.disallowedTools)) {
              sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
            }
          }
          return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
        }

        return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
      };

      sdkOptions.hooks = {
        PreToolUse: [{
          // Runs BEFORE the permission-mode check, so an interactive tool still reaches a human
          // in a HOOK_MODES mode. The mode is read at call time — a live settings change mutates
          // it in place — and every other mode is left to `canUseTool`, which asks already:
          // answering in both would put one question on the wire twice.
          matcher: 'AskUserQuestion|ExitPlanMode',
          timeout: 86_400,
          hooks: [async (input, toolUseId, hookOptions) => {
            if (!HOOK_MODES.has(sdkOptions.permissionMode)) return {};
            const result = await promptForToolDecision(input.tool_name, input.tool_input, { signal: hookOptions?.signal, requiresInteraction: true, toolUseId });
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: result.behavior, permissionDecisionReason: result.message, updatedInput: result.behavior === 'allow' ? result.updatedInput : undefined } };
          }]
        }],
        Notification: [{
          matcher: '',
          hooks: [async (input) => {
            // The DOMINANT producer of `permission_prompt` is the CLI announcing the very prompt
            // `promptForToolDecision` has already raised: it arms a six-second timer on a pending
            // tool ask and notifies under this type when that fires, so emitting it here would
            // ask the human twice, the second time without the question or the answer buttons.
            // The type has a second, broader producer inside the CLI — a dialog announced under
            // no type of its own defaults to this one — which reaches no human by any other door
            // today; a dialog family that ever does needs this guard re-read, not this comment.
            // Every other type — `idle_prompt`, `auth_success`, `elicitation_dialog` — is the
            // CLI's alone, and no runtime event covers it.
            if (input?.notification_type === 'permission_prompt') return {};
            const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
            // Notifications are app-facing, so they carry the app session id.
            emitNotification(createNotificationEvent({
              provider: 'claude',
              sessionId: sessionId || capturedSessionId || null,
              kind: 'action_required',
              code: 'agent.notification',
              meta: { message, sessionName: sessionSummary },
              severity: 'warning',
              requiresUserAction: true,
              dedupeKey: `claude:hook:notification:${sessionId || capturedSessionId || 'none'}:${message}`
            }));
            return {};
          }]
        }]
      };

      sdkOptions.canUseTool = async (toolName, input, toolContext) => {
        const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

        if (!requiresInteraction) {
          if (sdkOptions.permissionMode === 'bypassPermissions') {
            return { behavior: 'allow', updatedInput: input };
          }

          const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
            matchesToolPermission(entry, toolName, input)
          );
          if (isDisallowed) {
            return { behavior: 'deny', message: 'Tool disallowed by settings' };
          }

          const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
            matchesToolPermission(entry, toolName, input)
          );
          if (isAllowed) {
            return { behavior: 'allow', updatedInput: input };
          }
        }

        return promptForToolDecision(toolName, input, {
          signal: toolContext?.signal,
          requiresInteraction,
          toolUseId: toolContext?.toolUseID
        });
      };

      queue = createPromptQueue(promptMessages);
      try {
        queryInstance = query({
          prompt: queue.stream,
          options: sdkOptions
        });
      } catch (hookError) {
        // Older/newer SDK versions may not accept hook shapes yet.
        // Keep notification behavior operational via runtime events even if hook registration fails.
        console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
        delete sdkOptions.hooks;
        // Discard the abandoned stream and build a fresh one for the retry.
        queue.end();
        queue = createPromptQueue(promptMessages);
        queryInstance = query({
          prompt: queue.stream,
          options: sdkOptions
        });
      }

      idle = createIdleCloser({
        idleMs: resolveIdleCloseMs(options.idleCloseMs),
        isBusy,
        onBusy: (silentForMs) => {
          console.log(`[Claude SDK] Idle window reached for session ${sessionKey() || 'NEW'} after ${Math.round(silentForMs / 60_000)} min, but the conversation is busy (turn=${pendingTurn !== null || turnInFlight}, tasks=${backgroundTasks.size}, deferred=${deferredTools.size}); asking again in a minute`);
        },
        close: (silentForMs) => {
          console.log(`[Claude SDK] Closing the idle process for session ${sessionKey() || 'NEW'} after ${Math.round(silentForMs / 60_000)} min without a message`);
          handle.close();
        }
      });

      // The handle later messages join through, and the abort path interrupts through.
      if (sessionKey()) {
        addSession(sessionKey(), queryInstance, handle);
      }
      releaseReservation();

      // Process streaming messages
      console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
      for await (const message of queryInstance) {
        // Unguarded on purpose: only the SDK's init message carries this field, and it arrives after the hook events that claim the session-id capture below — and on every turn, resumed ones included.
        if (typeof message.claude_code_version === 'string') noteReportedCliVersion(message.claude_code_version);
        // Capture session ID from first message
        if (message.session_id && !capturedSessionId) {

          capturedSessionId = message.session_id;
          addSession(sessionKey(), queryInstance, handle);

          // Set session ID on writer
          if (ws.setSessionId && typeof ws.setSessionId === 'function') {
            ws.setSessionId(capturedSessionId);
          }

          // Send session-created event only once for sessions with nothing to resume
          if (!providerSessionId && !sessionCreatedSent) {
            sessionCreatedSent = true;
            ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
          }
        } else {
          // session_id already captured
        }

        if (message.type === 'system' && message.subtype === 'init') {
          turnInFlight = true;
        } else if (message.type === 'assistant') {
          turnInFlight = true;
        }
        if (message.type === 'system') {
          if (message.subtype === 'background_tasks_changed' && Array.isArray(message.tasks)) {
            backgroundTasks.clear();
            for (const task of message.tasks) {
              if (typeof task?.task_id === 'string') backgroundTasks.add(task.task_id);
            }
          } else if (message.subtype === 'task_started' && typeof message.task_id === 'string') {
            backgroundTasks.add(message.task_id);
          } else if (message.subtype === 'task_notification' && typeof message.task_id === 'string') {
            backgroundTasks.delete(message.task_id);
            // The notification names the call whose work ended: that hold is released here,
            // whether the follow-up turn it triggers is merged with another's or not.
            if (typeof message.tool_use_id === 'string') deferredTools.delete(message.tool_use_id);
          }
        }

        // Rate limits, API errors and failed results become pushes of their own, carrying the user
        // id captured at spawn: a reset timer emits through this callback long after the run ended.
        // An instance we ourselves ended is silent — a Stop makes the CLI answer `interrupt()` with
        // `error_during_execution`, and a crash alarm is the last thing that turn deserves.
        if (!abortedInstances.has(queryInstance) && !supersededInstances.has(queryInstance)) detectRuntimeSignals(message, signalState, {
          sessionId: sessionId || capturedSessionId || null,
          emit: (signal) => notifyUserIfEnabled({
            userId: runUserId,
            event: createNotificationEvent({ provider: 'claude', sessionId: sessionId || capturedSessionId || null, requiresUserAction: false, ...signal })
          })
        });

        // The finish of a background task, as the LIVE stream tells it. The transcript on disk
        // records the same fact as a `<task-notification>` user turn, which the history reader
        // folds onto the `Agent` call by tool-use id; the stream never carries that turn (measured
        // 2026-09-10: 17 of these events, zero such user turns), so this row is the only way a
        // live transcript learns an agent ended — and releases its pin. Sent whenever the event
        // arrives, turn complete or not: a backgrounded agent usually outlives the turn that
        // launched it. Inside a turn-pending guard (as first written) the row was dropped for
        // exactly that case — measured by Athena the same day: four background completions in
        // the journal, no row for any. Ambient tasks (watchers, skip-transcript work) are not
        // activity and get no row.
        if (message.type === 'system' && message.subtype === 'task_notification' && message.ambient !== true) {
          ws.send(createNormalizedMessage({
            kind: 'task_notification',
            sessionId: capturedSessionId || sessionId || '',
            provider: 'claude',
            toolId: typeof message.tool_use_id === 'string' ? message.tool_use_id : undefined,
            status: typeof message.status === 'string' ? message.status : 'completed',
            summary: typeof message.summary === 'string' ? message.summary : 'Background task finished',
            // The CLI's own total for the agent (its context as of its last request), so the
            // pinned row's finished figure is the terminal's figure without a reload.
            tokens: readNumber(message.usage?.total_tokens) || undefined,
          }));
        }

        if (message.type === 'system' && !firstResultHandled) {
          if (message.subtype === 'task_notification') {
            reconciliationPending = true;
            reconciliationArmedAt = Date.now();
            reconciliationSkipped = false;
          } else if (message.subtype === 'init' && reconciliationSkipped) {
            // The CLI opens the user's own query with a fresh init once the
            // reconciliation query is done; anything after this is the user's.
            reconciliationPending = false;
            reconciliationSkipped = false;
          }
        }
        if (message.type === 'result' && !firstResultHandled) {
          const zeroTurn = message.subtype === 'success' && message.is_error !== true
            && message.num_turns === 0 && (message.result ?? '') === '';
          const windowOpen = reconciliationPending
            && (Date.now() - reconciliationArmedAt) < RECONCILIATION_WINDOW_MS;
          if (zeroTurn && windowOpen) {
            // Skipped before anything client-facing: not the user's turn, so
            // neither its `complete` nor its token bill belongs on the wire. The
            // window stays open so a run that left several tasks behind is
            // reconciled in full, however many zero-turn results that takes.
            reconciliationSkipped = true;
            console.log(`[Claude SDK] Skipping the reconciliation result for session ${sessionKey() || 'NEW'}: resume closed out a background task its previous process left behind`);
            keepalive?.note(turnBits(pendingTurn === null));
            continue;
          }
          // Drift alarms: the guard matches one measured shape, and a CLI that
          // changes it fails silently back to the premature-complete defect.
          if (zeroTurn) {
            console.warn(`[Claude SDK] Zero-turn result outside a reconciliation window for session ${sessionKey() || 'NEW'} (pending=${reconciliationPending}, skipped=${reconciliationSkipped}) — the CLI's resume shape may have changed`);
          } else if (reconciliationPending && !reconciliationSkipped) {
            console.warn(`[Claude SDK] task_notification was not followed by a reconciliation result for session ${sessionKey() || 'NEW'} — the CLI's resume shape may have changed`);
          }
          reconciliationPending = false;
          reconciliationSkipped = false;
        }

        // Transform and normalize message via adapter
        const transformedMessage = transformMessage(message);
        const sid = capturedSessionId || sessionId || null;

        // Use adapter to normalize SDK events into NormalizedMessage[]
        const normalized = context.normalizeMessage(transformedMessage, sid);
        for (const msg of normalized) {
          // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
          if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
            msg.parentToolUseId = transformedMessage.parentToolUseId;
          }
          // The same cap history applies: a structured result can carry a whole file body
          // beside the content string, and the live frame must not be the one door without it.
          if (msg.kind === 'tool_result') {
            capToolResult(msg);
          }
          if (isSubagentPromptEcho(msg)) {
            continue;
          }
          ws.send(msg);
        }

        // Extract and send token budget updates from assistant usage payloads,
        // falling back to the turn's cumulative bill only for SDK builds that
        // report no per-assistant usage at all.
        const tokenBudgetData = extractTokenBudget(message)
          || (assistantBudgetSent ? null : extractCumulativeTokenBudget(message));
        if (tokenBudgetData) {
          if (message.type === 'assistant') {
            assistantBudgetSent = true;
          }
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }

        for (const id of backgroundWorkIds(message)) launchedThisTurn.add(id);

        if (message.type === 'result') {
          firstResultHandled = true;
          turnInFlight = false;
          const turn = pendingTurn;
          // A merged turn (a message pushed while the CLI was mid-turn) answers with one result
          // naming every uuid it absorbed, so inclusion is the test, not equality.
          const answersTurn = turn !== null && (
            turn.uuid === null
            || !Array.isArray(message.user_message_uuids)
            || message.user_message_uuids.includes(turn.uuid)
          );
          const abortPending = abortedInstances.has(queryInstance);
          // A failed result already went out as its own signal; neither "finished" nor
          // "background agent finished" beside it would be true.
          const failedResult = message.is_error === true;
          if (answersTurn) {
            if (!abortPending) {
              // (An aborted turn's terminal `complete` was sent by the abort handler.)
              ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
              if (!failedResult) notifyRunStopped({
                userId: ws?.userId || null,
                provider: 'claude',
                sessionId: sessionId || capturedSessionId || null,
                sessionName: sessionSummary,
                stopReason: 'completed',
                durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : null
              });
            }
            settleTurn();
          } else if (!abortPending) {
            // A result no client is waiting on: work started in an earlier turn has finished
            // and pushed a follow-up turn of its own.
            console.log('[Claude SDK] Background work completed for session ' + (sessionKey() || 'NEW'));
            if (!failedResult) notifyBackgroundWorkCompleted({
              userId: ws?.userId || null,
              provider: 'claude',
              sessionId: sessionId || capturedSessionId || null,
              sessionName: sessionSummary
            });
            // Work the task system never lists (a wake-up, a cron) has no notification to
            // release it: its own follow-up turn does, oldest first.
            const oldest = deferredTools.values().next();
            if (!oldest.done) deferredTools.delete(oldest.value);
          }
          // Work started during this turn reports back as a turn of its own; the idle closer
          // keeps its hands off the process until it has.
          for (const id of launchedThisTurn) deferredTools.add(id);
          launchedThisTurn.clear();
          // The turn a Stop ended has now reported. The process a Stop kept alive for its
          // background work is ordinary again from here: the NEXT message to join it is a run of
          // its own, and its terminal `complete` must reach the client. Leaving the mark set was a
          // run that ended on the registry's failure fallback instead. Only ever set for a process
          // a Stop kept (see `stopTurn`), and the aborted turn's own result is necessarily this
          // one — the CLI answers an interrupt by ending that turn, and the process is serial.
          if (stoppedTurnPending && abortPending) {
            stoppedTurnPending = false;
            abortedInstances.delete(queryInstance);
          }
          keepalive?.note(turnBits(pendingTurn === null));
        }
      }

      // The loop ends only when the CLI has exited: after the idle closer's EOF, an abort, a
      // retirement, or the process dying under it.

      // A retired process winds down silently: the map entry, the abort flag,
      // and all client-facing events belong to the process that replaced it.
      const superseded = supersededInstances.has(queryInstance);

      // A turn still pending here got no `result`: the process ended under it. Send the
      // terminal completion — skipped for an abort, whose terminal `complete` (aborted: true)
      // the abort handler already sent.
      const wasAborted = abortedInstances.has(queryInstance);
      if (pendingTurn && !superseded) {
        if (!wasAborted) {
          ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
        }
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'claude',
          sessionId: sessionId || capturedSessionId || null,
          sessionName: sessionSummary,
          stopReason: wasAborted ? 'aborted' : 'completed',
          durationMs: null
        });
      }

    } catch (error) {
      if (!supersededInstances.has(queryInstance) && !abortedInstances.has(queryInstance)) {
        console.error('SDK query error:', error);
      }

      if (supersededInstances.has(queryInstance)) {
        // Retired because a newer process took over this session id; that one
        // owns the abort flag and all further client-facing events.
        return;
      }

      if (abortedInstances.has(queryInstance)) {
        // The abort already produced the terminal complete; a generator throw
        // caused by interrupt() is expected noise, not a user-facing error.
        return;
      }

      // A process that failed BETWEEN turns failed nobody's request: the last run finished
      // long ago, and the next message spawns a fresh process. Log it and say nothing on
      // the wire — an error frame there would paint a finished reply as failed.
      if (!pendingTurn) {
        console.error(`[Claude SDK] The idle process for session ${sessionKey() || 'NEW'} ended with an error; the next message starts a new one`);
        return;
      }

      // Check if Claude CLI is installed for a clearer error message
      const installed = await context.isProviderInstalled();
      const errorContent = !installed
        ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
        : error.message;

      // Send error to WebSocket, then the terminal complete.
      ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'claude',
        sessionId: sessionId || capturedSessionId || null,
        sessionName: sessionSummary,
        error
      });
    } finally {
      // Always close stdin — otherwise an aborted or failed run leaves the CLI
      // process (and its MCP servers) alive until the server exits.
      closing = true;
      idle?.cancel();
      queue?.end();
      settleTurn();
      settleFirstTurn();
      retireSession();
      releaseReservation();
    }
  };

  // The loop reports its own failures on the wire; nothing awaits it past the first turn.
  runLoop().catch(() => {});
  return firstTurnSettled;
}

/**
 * Aborts an active SDK session — the Stop button, and every other caller that cancels a run.
 *
 * STOP ENDS THE REPLY, NOT THE WORK THE REPLY STARTED. The SDK's interrupt ends the TURN: it does
 * not touch the CLI's background tasks, and the process stays up (measured with the SDK directly,
 * 2026-09-22: a turn started a background Bash job and a background subagent, `interrupt()` was
 * called mid-reply, the turn's result arrived and the markers those jobs wrote appeared a minute
 * later, on a process whose stdin had never been closed). What killed them was this function's own
 * wind-down: `close()` ends stdin, the CLI exits, and the tasks die or are orphaned before the
 * `task_notification` that would wake the agent. So the wind-down is now a decision:
 *
 * - Background work still in flight → leave the process exactly as it is, idle, registered as this
 *   session's live process. Its task notifications still arrive and wake the agent, landing in the
 *   chat as they would after a normal turn, and the operator's next message joins that same
 *   process. The idle closer ends it once nothing is running, as always. "In flight" is read on
 *   both sides of the interrupt, because the interrupt's own task reports can erase the evidence
 *   (the read carries the measurement). One follow-up does end that work early: a message that
 *   changes a launch argument (model, cwd, allowed tools, the CLI's own version) respawns, and a
 *   respawn retires this process wholesale — `addSession` logs the line when it happens.
 * - Nothing in flight → end stdin, as before: the next message spawns a fresh process.
 * - The interrupt went unanswered (or failed) → kill, as before. A wedged CLI must still stop, and
 *   this is the only path a Stop is allowed to take background work down with it.
 *
 * The client sees no difference either way: the run completes as `aborted` in the caller
 * (`chat-websocket.service.ts`'s `handleChatAbort`), which is what stops the spinner.
 *
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  console.log(`Aborting SDK session: ${sessionId}`);

  // Mark before interrupting so the loop knows not to emit its own terminal
  // complete (the abort handler sends the aborted one).
  abortedInstances.add(session.instance);

  // Read BEFORE the interrupt, because the interrupt itself can wipe the evidence: a background
  // task the interrupted turn owns is reported ended the moment the CLI acts on the interrupt
  // (`task_notification`, measured 2026-09-22 — a subagent's own background job was reported
  // `stopped` in the same breath as the interrupt), and that report releases the hold this asks
  // about. A report is not proof the work ended either: the same notification has arrived while
  // the job went on to write its marker 100 s later. So the question is asked on both sides of the
  // interrupt and answered by EITHER: work outstanding when Stop was pressed, or work outstanding
  // once the CLI has answered. The cost of being wrong that way is one process idling until the
  // idle closer's window; the cost of the other is the work.
  const backgroundWorkAtPress = session.process?.hasBackgroundWork === true;

  // Over the still-open stdin, so it arrives. It ends the turn and nothing else.
  //
  // Bounded: the interrupt is a control request the CLI must answer, and a wedged CLI never does.
  // Awaited without a limit, Stop hung for good on such a process — every click logged here and
  // nothing ended, because the run is only completed once this returns. A process that does not
  // answer in the grace, or whose interrupt fails, is killed instead: Stop always stops.
  const interrupting = session.instance.interrupt();
  const answered = await Promise.race([
    interrupting.then(() => true, (error) => {
      console.warn(`[Claude SDK] Interrupt failed for session ${sessionId}: ${error?.message || error}`);
      return false;
    }),
    new Promise((resolve) => setTimeout(() => resolve(false), INTERRUPT_GRACE_MS).unref()),
  ]);
  // A late rejection from the abandoned interrupt is expected once the process is killed.
  interrupting.catch(() => {});

  // Asked only of a process that DID answer: an unanswered interrupt winds down on the kill path,
  // background work or not.
  const backgroundWork = answered
    && (backgroundWorkAtPress || session.process?.hasBackgroundWork === true);

  try {
    if (backgroundWork) {
      // The turn is over for the client; the work it started is not over for this process.
      session.process.stopTurn();
      console.log(`[Claude SDK] Session ${sessionId} stopped, process kept: background work is still running and its result still belongs in this chat`);
    } else if (answered) {
      // End stdin; the next message spawns a fresh process.
      session.process?.close();
    } else {
      console.warn(`[Claude SDK] Session ${sessionId} did not answer the interrupt within ${INTERRUPT_GRACE_MS} ms; killing its process`);
      session.process?.kill();
    }
  } catch (error) {
    console.error(`[Claude SDK] Winding down the process for session ${sessionId} failed: ${error?.message || error}`);
  } finally {
    // A kept process STAYS the session's live process, which is the whole point of keeping it: the
    // next message joins it rather than spawning a second CLI beside it. It stays `active` for the
    // same reason — that status is what `addSession` reads to decide an entry has been superseded
    // and must be wound down, and a kept process is not superseded by anything.
    if (!backgroundWork) {
      session.status = 'aborted';
      removeSession(sessionId);
    }
  }
  return true;
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * Every session with a tool approval waiting right now, whether or not it still has a run.
 *
 * The same question as `getPendingApprovalsForSession`, asked the other way round, and the run
 * registry cannot answer it: a prompt OUTLIVES the run that raised it. A backgrounded agent's
 * completion wakes the CLI for a continuation turn the server registers no run for, and a
 * re-adopted host re-issues the prompt it was parked on — in both states the approval sits here
 * while the session is long gone from `chatRunRegistry`. Read by `sessionsService
 * .listAwaitingInputSessionIds` for the sidebar's yellow dot, through the provider registry.
 *
 * `_sessionId` is the app session id for everything the chat gateway dispatches, and the
 * provider-native id only for legacy/direct callers that never supplied one — an id no sidebar row
 * is keyed by, which leaves the mark absent exactly as it was before.
 *
 * @returns {string[]} Deduped app session ids, sorted
 */
function listPendingSessionIds() {
  const sessionIds = new Set();
  for (const resolver of pendingToolApprovals.values()) {
    if (resolver._sessionId) {
      sessionIds.add(resolver._sessionId);
    }
  }
  return [...sessionIds].sort();
}

export const claudeRuntime = {
  run: queryClaudeSDK,
  abort: abortClaudeSDKSession,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
    listPendingSessions: listPendingSessionIds,
  },
};

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  resolveToolApproval,
  getPendingApprovalsForSession,
  listPendingSessionIds,
  extractTokenBudget,
  extractCumulativeTokenBudget
};
