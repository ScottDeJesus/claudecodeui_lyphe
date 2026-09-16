// createKanbanModule: used by the server entrypoint to mount the board behind `authenticateToken`
// at `/api/kanban` — the board list, its create, update and select, its per-status counts, the
// project lookup and its audit log, and the cards: their lane pages, create, detail, patch, move,
// archive, restore, tags, questions and their answers, issues, checklist, attachments, approval
// and the two leases.
export { createKanbanModule } from './kanban.module.js';
// The six verb surfaces, exported for an in-process MCP adapter that will call them directly
// rather than over HTTP. Their own consumers today are the routes, which import the files. Each
// service lands here as its phase does, so the barrel never drifts a phase behind the module.
// The `routes/` package is INTERNAL and is never exported from here.
export { kanbanBoardsService } from './kanban-boards.service.js';
export { kanbanCardsService } from './kanban-cards.service.js';
export { kanbanChecklistService } from './kanban-checklist.service.js';
export { kanbanImportService } from './kanban-import.service.js';
export { kanbanLeasesService } from './kanban-leases.service.js';
export { kanbanQuestionsService } from './kanban-questions.service.js';
