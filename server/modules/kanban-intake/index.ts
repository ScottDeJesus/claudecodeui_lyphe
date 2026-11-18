// createKanbanIntakeRouter: used by the server entrypoint to mount the Kanban intake door at `/api/kanban-intake`
// with NO `authenticateToken` — a machine door for eis_backend (Restorly's "Something not working?" reports), whose
// own first middleware checks the shared secret (`X-Kanban-Intake-Secret`) read from eis_backend's env file at call time.
export { createKanbanIntakeRouter } from './kanban-intake.routes.js';
