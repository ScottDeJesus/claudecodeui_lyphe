/**
 * withChatCompaction: used by the server entrypoint, once, on the provider runtime service. The wrapper
 * it returns goes wherever the bare service went for chat traffic — the websocket server's `chat.runtime`,
 * the ntfy action routes, the keepalive re-adoption and the scheduled-message dispatcher — so a taken-over
 * chat's `/compact` becomes the summarizer's compaction, and its turn-end and idle triggers are live.
 * (The one-shot runners from `getRunner` stay on the bare service: they have no chat to compact.)
 */
// stopChatCompaction: used by the same entrypoint's shutdown, so no idle deadline or pending compaction
// starts a verb on a process that is leaving, and a verb not yet at its seed turn is not orphaned.
export { withChatCompaction, stopChatCompaction } from './compaction-runtime.js';
