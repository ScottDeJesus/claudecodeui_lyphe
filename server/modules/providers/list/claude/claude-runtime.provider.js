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
// chat-process.ts), on an abort (whose interrupt has already taken the tasks down), or on a
// retirement for a launch-bound setting. So this ceiling is the backstop for a task that
// started in the gap between that check and the EOF, never the normal way a process ends.
const BG_WAIT_CEILING_MS = 30 * 60 * 1000;
// How long after a `task_notification` a zero-turn result can still be the
// CLI's own reconciliation of an orphaned background task (see queryClaudeSDK).
const RECONCILIATION_WINDOW_MS = 10 * 1000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

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

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
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
      // Interrupt first over the open stdin, then EOF (see queryClaudeSDK).
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
 * background agent read as finished the moment it launched and was never pinned above the
 * transcript (`PinnedSubagents.tsx`); the same row read correctly after a reload, because the
 * history reader takes the field from the JSONL. Measured 2026-09-10 with a live agent: the
 * pin strip empty, the row already stamped "4 tools". Both spellings are mapped here so the
 * normalizer sees one shape from either door.
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
  const next = launchProfileOf(resolved.sdkOptions, resolved.mcpUnreadable);
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

// How long a retiring process gets to answer the interrupt before its stdin is ended anyway.
const INTERRUPT_GRACE_MS = 5_000;
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

  // The turn a client is waiting on, or null between turns. `uuid` is stamped on the user
  // message and echoed on the `result` that answers it (`user_message_uuids`) — the only way
  // to tell that result from one a background follow-up turn produces in the same stream. A
  // re-adopted turn has no uuid on record and takes the next result, as it always did.
  let pendingTurn = null;
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

  const isBusy = () => pendingTurn !== null || turnInFlight || heldForBackgroundWork() || backgroundTasks.size > 0;

  // The handle later messages join through, registered under the session key.
  const handle = {
    get closing() {
      return closing;
    },
    get profile() {
      return profile;
    },
    // Ends stdin; the CLI exits within ~300 ms when nothing is running. A task that slipped in
    // between the busy check and the EOF rides the CLI's own ceiling (BG_WAIT_CEILING_MS).
    close() {
      if (closing) return;
      closing = true;
      idle?.cancel();
      queue?.end();
    },
    // Interrupt FIRST, over the still-open stdin, so the CLI stops what it is doing —
    // background tasks included, which the SDK's interrupt takes down when no per-task stop
    // is declared — then EOF. Silent on the wire: the run that retired it owns every
    // client-facing event from here.
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
        await queryInstance.setModel(changes.model);
        profile.model = next.model;
      }
      if (changes.effort) {
        await queryInstance.applyFlagSettings({
          effortLevel: changes.effort.level,
          ultracode: changes.effort.ultracode || null,
          enableWorkflows: changes.effort.ultracode || null
        });
        profile.effort = next.effort;
        profile.ultracode = next.ultracode;
      }
      if (changes.permissionMode) {
        await queryInstance.setPermissionMode(changes.permissionMode);
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
        // The first message after re-adoption IS the profile from here on.
        Object.assign(profile, next, { unknown: false });
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
      // A re-adopted process answers to the profile its host recorded at spawn; only a host
      // from before that field leaves it unknown.
      profile = reattach
        ? (reattach.profile ? { ...reattach.profile, unknown: false } : launchProfileOf(sdkOptions, resolved.mcpUnreadable, true))
        : launchProfileOf(sdkOptions, resolved.mcpUnreadable);
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

      sdkOptions.hooks = {
        Notification: [{
          matcher: '',
          hooks: [async (input) => {
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

      // Caveat: in 'auto' and 'bypassPermissions' modes the SDK resolves approval
      // at the permission-mode step and skips this callback, so interactive tools
      // (AskUserQuestion, ExitPlanMode) won't reach the UI — the classifier/bypass
      // auto-approves them and the model acts on a generated answer. Move these
      // tools to a PreToolUse hook (runs before the mode check) if we need them
      // to work in those modes.
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

        const requestId = createRequestId();
        ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        emitNotification(createNotificationEvent({
          provider: 'claude',
          sessionId: sessionId || capturedSessionId || null,
          kind: 'action_required',
          code: 'permission.required',
          meta: { toolName, sessionName: sessionSummary },
          severity: 'warning',
          requiresUserAction: true,
          dedupeKey: `claude:permission:${sessionId || capturedSessionId || 'none'}:${requestId}`
        }));

        const decision = await waitForToolApproval(requestId, {
          timeoutMs: requiresInteraction ? 0 : undefined,
          signal: toolContext?.signal,
          metadata: {
            // Keyed by the app session id so `chat.subscribe` can look pending
            // approvals up directly; provider id only for legacy callers.
            _sessionId: sessionId || capturedSessionId || null,
            _toolName: toolName,
            _input: input,
            _receivedAt: new Date(),
          },
          onCancel: (reason) => {
            ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
          }
        });
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
        if (typeof ws.setCliVersion === 'function' && typeof message.claude_code_version === 'string') ws.setCliVersion(message.claude_code_version);
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
          if (answersTurn) {
            if (!abortPending) {
              // (An aborted turn's terminal `complete` was sent by the abort handler.)
              ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
              notifyRunStopped({
                userId: ws?.userId || null,
                provider: 'claude',
                sessionId: sessionId || capturedSessionId || null,
                sessionName: sessionSummary,
                stopReason: 'completed'
              });
            }
            settleTurn();
          } else if (!abortPending) {
            // A result no client is waiting on: work started in an earlier turn has finished
            // and pushed a follow-up turn of its own.
            console.log('[Claude SDK] Background work completed for session ' + (sessionKey() || 'NEW'));
            notifyBackgroundWorkCompleted({
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
          stopReason: wasAborted ? 'aborted' : 'completed'
        });
      }

    } catch (error) {
      console.error('SDK query error:', error);

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
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Mark before interrupting so the loop knows not to emit its own terminal
    // complete (the abort handler sends the aborted one).
    abortedInstances.add(session.instance);

    // Over the still-open stdin, so it arrives. It also takes the CLI's background tasks
    // down (no per-task stop is declared), so nothing is left worth keeping the process for.
    await session.instance.interrupt();

    // End stdin; the next message spawns a fresh process.
    session.process?.close();

    // Update session status
    session.status = 'aborted';

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    // The run keeps going; let it emit its own terminal complete.
    abortedInstances.delete(session.instance);
    return false;
  }
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

export const claudeRuntime = {
  run: queryClaudeSDK,
  abort: abortClaudeSDKSession,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
  },
};

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  resolveToolApproval,
  getPendingApprovalsForSession,
  extractTokenBudget,
  extractCumulativeTokenBudget
};
