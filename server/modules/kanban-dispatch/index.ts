// createKanbanDispatchModule: used by the server entrypoint, which mounts its router at `/api/kanban-dispatch` behind
// `authenticateToken` (the card-walk settings, relayed to `dispatcher card config`) and starts it after `listen`: the board
// tells the dispatcher what a person did to a card of a self-running board (`dispatcher card told`), and applies the notes the
// dispatcher's card walks owe the board (`dispatcher card notes`, then `dispatcher card applied`).
export { createKanbanDispatchModule } from './kanban-dispatch.module.js';
export type { KanbanDispatchModule } from './kanban-dispatch.module.js';
// fileTicket and clearTicket: used by Cerberus's red watch (`server/modules/cerberus/red-watch-tickets.ts`), which files a check
// red for an hour as a bug ticket and clears it when the check is green again (`dispatcher bug file` / `bug cleared`).
export { clearTicket, fileTicket } from './kanban-dispatch.door.js';
export type { TicketDetector, TicketFiling, TicketPriority } from './kanban-dispatch.door.js';
