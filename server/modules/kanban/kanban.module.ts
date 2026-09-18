import type { Router } from 'express';

import { kanbanAttachmentsService } from './kanban-attachments.service.js';
import { kanbanBoardsService } from './kanban-boards.service.js';
import { kanbanCardsService } from './kanban-cards.service.js';
import { kanbanChecklistService } from './kanban-checklist.service.js';
import { kanbanImportService } from './kanban-import.service.js';
import { kanbanLeasesService } from './kanban-leases.service.js';
import { kanbanLessonsService } from './kanban-lessons.service.js';
import { kanbanQuestionsService } from './kanban-questions.service.js';
import { startLessonSpillSweep } from './kanban-spill.service.js';
import type { KanbanMemoryPendingReader } from './routes/board.routes.js';
import type { KanbanPlanCostReader } from './routes/card.routes.js';
import { createKanbanRouter } from './routes/kanban.routes.js';

/**
 * The two readings the board takes from outside itself, and the ONLY way they reach it.
 *
 * Both are functions rather than values: `planCost` is asked per plan path when a drawer opens, and
 * `memoryPending` is asked at the request that needs the number, so neither is a constant captured
 * at boot. The composition root (`server/index.ts`) builds them from the `plan-runner` and
 * `memory-intake` barrels — that is where the plan says the ONE cross-module import sits — and
 * nothing below this constructor reaches for a sibling module, which is what lets a route be built
 * against a scratch root without a board knowing who answers.
 */
export type KanbanModuleDependencies = {
  planCost: KanbanPlanCostReader;
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
    importer: kanbanImportService,
    lessons: kanbanLessonsService,
    planCost: dependencies.planCost,
    memoryPending: dependencies.memoryPending,
  });
}
