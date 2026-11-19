// createKanbanDispatchModule: used by the server entrypoint, which mounts its router at `/api/kanban-dispatch` behind
// `authenticateToken` (the card-walk settings, relayed to `dispatcher card config`) and starts it after `listen`: the board
// tells the dispatcher what a person did to a card of a self-running board (`dispatcher card told`), and applies the notes the
// dispatcher's card walks owe the board (`dispatcher card notes`, then `dispatcher card applied`).
export { createKanbanDispatchModule } from './kanban-dispatch.module.js';
export type { KanbanDispatchModule } from './kanban-dispatch.module.js';
