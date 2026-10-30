export { WS_OPEN_STATE, connectedClients } from './services/websocket-state.service.js';
// Consumed by the companion module's store (every frame it emits reaches this account's pages and no
// one else's) and its alert feed (which asks whether any page of the account is there to hear it).
export { sendToUser, isUserConnected } from './services/websocket-state.service.js';
// Consumed by the companion module's tools: `stop_session` is the page's own stop and `answer_session`
// the page's own permission answer, so a stop or an answer from her is the same act as from the chat.
export { abortChatRun, answerChatPermission } from './services/chat-run-verbs.service.js';
// Consumed by the companion module's send verb: a brief sent to a chat that is working is folded into the turn running
// now (`send_to_session` and the draft card's Send steer), with its echo written onto that run's stream.
export { steerChatRun } from './services/chat-run-verbs.service.js';
export { createWebSocketServer } from './services/websocket-server.service.js';
// Consumed by the cerberus module's `warden-link.ts`: every warden socket is pinged every 30 s and a
// half-open one terminated, the same keep-alive the browser gateway's sockets get.
export { attachWebSocketHeartbeat } from './services/websocket-server.service.js';
export { chatRunRegistry } from './services/chat-run-registry.service.js';
// Consumed by the providers module's sessions watcher, which announces the
// sessions it (re)indexed from disk through the same builder the chat gateway
// uses, so both paths put the identical delta on the wire.
export { broadcastSessionUpserted, broadcastSessionUpsertedBatch } from './services/session-upsert-broadcast.service.js';
// onSessionUpserted: used by the companion module's station hint, which hears every session the broadcaster announces
// (a rename, a new chat, a re-index) and tells the station a chat changed.
export { onSessionUpserted } from './services/session-upsert-broadcast.service.js';
// runDetachedChatTurn: used by the scheduled-messages module to run a turn
// from a timer, with no socket to stream to or report errors on.
export { runDetachedChatTurn } from './services/chat-websocket.service.js';
// Started once by the server entrypoint after `listen`: the registry owns runs,
// so the check for one that has gone silent lives beside it.
export { startRunStallWatchdog } from './services/run-stall-watchdog.service.js';
export type { ProviderRuntimeGateway } from './services/chat-websocket.service.js';
