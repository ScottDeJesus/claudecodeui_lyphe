// createKanbanModule: used by the server entrypoint to mount the board behind `authenticateToken`
// at `/api/kanban` — the board list, its create, update and select, its per-status counts, the
// project lookup and its audit log, the cards: their lane pages, create, detail, patch, move,
// archive, restore, tags, questions and their answers, issues, checklist and attachments, and the
// lessons: the staged corpus, its by-id read and the two reviews; the board's numbers and its changelog (`/stats`, `/changelog`).
export { createKanbanModule } from './kanban.module.js';
// The write-listener seam: `onKanbanWrite(listener)` is told of every committed board write, after its commit and
// beside its frame, and returns the unsubscribe. It is how the board-dispatch module hears a card created or moved
// without the board importing it.
export { onKanbanWrite, type KanbanWriteEvent } from './kanban-write.service.js';
// The seven verb surfaces, exported so an in-process caller names a service once instead of
// reaching into its file. Their own consumers today are the routes, which import the files. Each
// service lands here as its phase does, so the barrel never drifts a phase behind the module.
// The board-dispatch module (`server/modules/kanban-dispatch/`) is the in-process caller beside the routes: it applies the dispatcher's notes through these services.
// The `routes/` package is INTERNAL and is never exported from here.
export { kanbanAttachmentsService } from './kanban-attachments.service.js';
export { kanbanBoardsService } from './kanban-boards.service.js';
// The card verbs, and with them the telemetry seam: `addCardTokens` is how the board-dispatch module adds a walk stage's
// spend (the dispatcher's `tokens` note) to a card's four `build_tokens_*` counters without a deep import into this module's files.
export { kanbanCardsService } from './kanban-cards.service.js';
export { kanbanChecklistService } from './kanban-checklist.service.js';
// The lesson store's five verbs: the board's own read surface for what a build learned, delivered on the board's one mount (`/api/kanban`).
export { kanbanLessonsService } from './kanban-lessons.service.js';
export { kanbanQuestionsService } from './kanban-questions.service.js';
// The board's numbers and its changelog: reads only, for the stats routes and the board-dispatch module's dashboard.
export { kanbanStatsService } from './kanban-stats.service.js';
export type { KanbanChangelogEntry, KanbanStats } from '@/shared/kanban-types.js';
// The board's roster: every card of one board, archived and done ones included, read whole for the board-dispatch
// module, which answers the dispatcher's `board` note with it.
export { kanbanRosterService } from './kanban-roster.service.js';
export type { KanbanRosterCard } from '@/modules/database/index.js';
