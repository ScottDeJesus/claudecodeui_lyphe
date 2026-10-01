export { sessionSynchronizerService } from './services/session-synchronizer.service.js';
export { providerSkillsService } from './services/skills.service.js';
export { providerMcpService } from './services/mcp.service.js';
export { providerRuntimeService } from './services/provider-runtime.service.js';

// providerModelsService: used by Commands to list models and resolve the active session model.
export { providerModelsService } from './services/provider-models.service.js';
export { providerTokenUsageService } from './services/provider-token-usage.service.js';

// sessionsService: used by the websocket module's chat gateway to resolve an
// edited message's resume point, which only the providers module can read.
export { sessionsService } from './services/sessions.service.js';

export { initializeSessionsWatcher } from './services/sessions-watcher.service.js';
export { closeSessionsWatcher } from './services/sessions-watcher.service.js';

// readoptKeepaliveSessions: used by server/index.ts to give every CLI that outlived
// the API its registry run back, before the server starts listening (D-11).
export { readoptKeepaliveSessions, releaseKeepaliveOwnership } from './list/claude/session-host/index.js';

// busyReason, listLiveHosts: used by the claude-activity module to ask every live Claude session host
// the one question the idle sweep asks — is a turn or background work in flight? — and to know which
// `claude` processes on the box are a host's own CLI.
export { busyReason, listLiveHosts } from './list/claude/session-host/index.js';
export type { LiveHost } from './list/claude/session-host/index.js';

// readClaudeTranscriptBySessionId: used by the dispatch-souls module to read a launched soul's own
// Claude transcript from the session id its launch recorded. A soul has no app session row, so its
// provider session id is the only handle on the file, and this module is the one that knows where
// Claude keeps it.
export { readClaudeTranscriptBySessionId } from './list/claude/claude-transcript-activity.js';

// registerPermissionGateway: used by the dispatcher module so a phone's tap on a plan's prompt goes
// through the same doors a tool approval uses (an answer, a recall). It lists NOTHING: a plan's prompt
// is pending in no chat, so no chat lists it and no sidebar dot marks it.
export { registerPermissionGateway } from './provider.registry.js';
