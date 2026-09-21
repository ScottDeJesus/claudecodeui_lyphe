// createKanbanModule: used by the server entrypoint to mount the board behind `authenticateToken`
// at `/api/kanban` — the board list, its create, update and select, its per-status counts, the
// project lookup and its audit log, the cards: their lane pages, create, detail, patch, move,
// archive, restore, tags, questions and their answers, issues, checklist, attachments, approval
// and the two leases, and the lessons: the staged corpus, its by-id read and the two reviews.
export { createKanbanModule } from './kanban.module.js';
// The seven verb surfaces, exported so an in-process caller names a service once instead of
// reaching into its file. Their own consumers today are the routes, which import the files. Each
// service lands here as its phase does, so the barrel never drifts a phase behind the module.
// The MCP program is NOT an in-process caller: it is a leaf that reaches the board over HTTP
// through `/api/kanban-pm` (`kanban-pm-client.ts`), never by importing from here.
// The `routes/` package is INTERNAL and is never exported from here.
export { kanbanAttachmentsService } from './kanban-attachments.service.js';
export { kanbanBoardsService } from './kanban-boards.service.js';
// The card verbs, and with them the telemetry seam: `addCardTokens` is how the Metis watcher
// (`kanban-metis/metis-telemetry.service.ts`) adds a tick's token delta to a card's four
// `build_tokens_*` counters without a deep import into this module's files.
export { kanbanCardsService } from './kanban-cards.service.js';
// The board answering what its own leases hold — the plan paths the archive sweep must not move.
// The sweep is the plan-runner's and the join is `server/index.ts`'s, so it is asked for here rather
// than read out of these rows by a module the board cannot see.
export { plansHeldByLease } from './kanban-cards.service.js';
export { kanbanChecklistService } from './kanban-checklist.service.js';
export { kanbanLeasesService } from './kanban-leases.service.js';
// The lesson store's five verbs: the board's own read surface for what a build learned, and the
// one the `kanban-pm` MCP program reaches over HTTP in Phase 7. Its review verbs are delivered on
// both mounts and refused at the child's door (`kanbanMetisSecretGuard`), never here.
export { kanbanLessonsService } from './kanban-lessons.service.js';
export { kanbanQuestionsService } from './kanban-questions.service.js';
