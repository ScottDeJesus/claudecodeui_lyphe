export { sessionSynchronizerService } from './services/session-synchronizer.service.js';
export { providerSkillsService } from './services/skills.service.js';
export { providerMcpService } from './services/mcp.service.js';
export { providerRuntimeService } from './services/provider-runtime.service.js';

// providerModelsService: used by Commands to list models and resolve the active session model.
export { providerModelsService } from './services/provider-models.service.js';
export { providerTokenUsageService } from './services/provider-token-usage.service.js';

// readClaudeCommandCatalog: used by Commands to list the command set the installed Claude CLI
// advertises to every SDK client, for the chat palette's Claude Code group.
export { readClaudeCommandCatalog } from './list/claude/claude-command-catalog.js';

// readClaudeModelsDefinition: used by the companion module's picture to label her model picker from the installed
// Claude CLI's own catalog ("Sonnet 5.5"), so a label names the generation the CLI runs and goes stale with no release.
export { readClaudeModelsDefinition } from './list/claude/claude-model-catalog.js';

// CLAUDE_MODEL_VALUE_BY_ALIAS, ClaudeModelAlias, readAccountDefaultModelAlias: used by the companion module's
// `send_to_session` / `create_session`: their `model` offers the house's model names (the table's keys) and carries the value
// a chat runs on (the table's value); left out for a new chat, the chat runs on the account's default model.
export { CLAUDE_MODEL_VALUE_BY_ALIAS } from './list/claude/claude-model-options.js';
export type { ClaudeModelAlias } from './list/claude/claude-model-options.js';
export { readAccountDefaultModelAlias } from './list/claude/claude-account-default-model.js';

// buildClaudeToolPermissionEntry: used by the companion module's `answer_session`, which answers "always" with the
// entry the runtime's grammar matcher accepts for the ask — the same string the chat page's "Allow and remember" writes.
export { buildClaudeToolPermissionEntry } from './list/claude/claude-tool-permission-entry.js';

// launchAccountEnv: used by the Cerberus diagnosis agent and its summary audit, whose own CLI starts
// ride the account the house chose exactly as a chat's process does.
export { launchAccountEnv } from './list/claude/claude-launch-account.js';

// diagnoseProjectFolder: used by the projects module's list to mark a project whose folder is gone,
// with the same test the Claude run's pre-flight refuses a start by — one folder test, not two.
export { diagnoseProjectFolder } from './list/claude/claude-project-folder.js';

// sessionsService: used by the websocket module's chat gateway to resolve an
// edited message's resume point, which only the providers module can read.
export { sessionsService } from './services/sessions.service.js';

export { initializeSessionsWatcher } from './services/sessions-watcher.service.js';
export { closeSessionsWatcher } from './services/sessions-watcher.service.js';

// readoptKeepaliveSessions: used by server/index.ts to give every CLI that outlived
// the API its registry run back, before the server starts listening (D-11).
export { readoptKeepaliveSessions, releaseKeepaliveOwnership } from './list/claude/session-host/index.js';

// whenNodeSessionsReadopted: used by server/index.ts beside the boot re-adoption, so the running-sessions
// read waits for a co-located node's hosts to be handed back (they can only be once its warden links).
export { whenNodeSessionsReadopted } from './list/claude/session-host/index.js';

// busyReason, listLiveHosts: used by the claude-activity module to ask every live Claude session host
// the one question the idle sweep asks — is a turn or background work in flight? — and to know which
// `claude` processes on the box are a host's own CLI.
export { busyReason, listLiveHosts } from './list/claude/session-host/index.js';

// listColocatedNodeHosts, refreshColocatedNodeHosts: used by the same module for the hosts a co-located
// node's warden holds — their CLIs are this machine's `claude` processes too.
export { listColocatedNodeHosts, refreshColocatedNodeHosts } from './list/claude/session-host/index.js';
export type { LiveHost } from './list/claude/session-host/index.js';

// sessionHostLivenessSnapshot: used by the websocket module's chat gateway, which sends it to every socket as it
// connects — the chats that have a live session host — so a page starts from the truth and the pushed changes
// (host-liveness.ts) keep it there.
export { sessionHostLivenessSnapshot } from './list/claude/session-host/index.js';

// readClaudeTranscriptBySessionId: used by the dispatch-souls module to read a launched soul's own
// Claude transcript from the session id its launch recorded. A soul has no app session row, so its
// provider session id is the only handle on the file, and this module is the one that knows where
// Claude keeps it.
export { readClaudeTranscriptBySessionId } from './list/claude/claude-transcript-activity.js';

// registerPermissionGateway: used by the dispatcher module so a phone's tap on a plan's prompt goes
// through the same doors a tool approval uses (an answer, a recall). It lists NOTHING: a plan's prompt
// is pending in no chat, so no chat lists it and no sidebar dot marks it.
export { registerPermissionGateway } from './provider.registry.js';
