import type { Router } from 'express';

import { kanbanAttachmentsService } from './kanban-attachments.service.js';
import { kanbanBoardsService } from './kanban-boards.service.js';
import { kanbanCardsService } from './kanban-cards.service.js';
import { kanbanChecklistService } from './kanban-checklist.service.js';
import { kanbanLeasesService } from './kanban-leases.service.js';
import { kanbanLessonsService } from './kanban-lessons.service.js';
import { kanbanQuestionsService } from './kanban-questions.service.js';
import { startLessonSpillSweep } from './kanban-spill.service.js';
import type { KanbanMemoryPendingReader } from './routes/board.routes.js';
import { createKanbanRouter } from './routes/kanban.routes.js';

/**
 * The one reading the board takes from outside itself, and the ONLY way it reaches the board.
 *
 * It is a function rather than a value: `memoryPending` is asked at the request that needs the
 * number, so it is not a constant captured at boot. The composition root (`server/index.ts`)
 * builds it from the `memory-intake` barrel — that is where the plan says the ONE cross-module
 * import sits — and nothing below this constructor reaches for a sibling module, which is what
 * lets a route be built against a scratch root without a board knowing who answers.
 */
export type KanbanModuleDependencies = {
  memoryPending: KanbanMemoryPendingReader;
};

/**
 * Builds the Kanban board's router for the server entrypoint, which mounts it at `/api/kanban`
 * behind `authenticateToken`.
 *
 * The composition root's whole job is to name the services once and hand them over: every verb,
 * repository and route below it takes what it needs as an argument, so nothing here reads the
 * environment, opens a database or sends a frame. There is no env to read — the board keeps its
 * state in the same database as everything else, reached through the repository barrel.
 *
 * IT STARTS ONE THING, and it is the only thing that is not a name handed over: the board's lesson
 * queue door, which is a timer rather than a request (Interfaces §3). Its own module reads the
 * filesystem and the spill root; this root only decides when it begins. Starting it is idempotent,
 * because this router is built once for each of its two mounts.
 */
export function createKanbanModule(dependencies: KanbanModuleDependencies): Router {
  startLessonSpillSweep();

  return createKanbanRouter({
    boards: kanbanBoardsService,
    cards: kanbanCardsService,
    questions: kanbanQuestionsService,
    checklist: kanbanChecklistService,
    attachments: kanbanAttachmentsService,
    leases: kanbanLeasesService,
    lessons: kanbanLessonsService,
    memoryPending: dependencies.memoryPending,
  });
}
