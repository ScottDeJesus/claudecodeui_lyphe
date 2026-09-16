import type { Router } from 'express';

import { kanbanBoardsService } from './kanban-boards.service.js';
import { kanbanCardsService } from './kanban-cards.service.js';
import { kanbanChecklistService } from './kanban-checklist.service.js';
import { kanbanImportService } from './kanban-import.service.js';
import { kanbanLeasesService } from './kanban-leases.service.js';
import { kanbanQuestionsService } from './kanban-questions.service.js';
import { createKanbanRouter } from './routes/kanban.routes.js';

/**
 * Builds the Kanban board's router for the server entrypoint, which mounts it at `/api/kanban`
 * behind `authenticateToken`.
 *
 * The composition root's whole job is to name the services once and hand them over: every verb,
 * repository and route below it takes what it needs as an argument, so nothing here reads the
 * environment, opens a database or sends a frame. There is no env to read — the board keeps its
 * state in the same database as everything else, reached through the repository barrel.
 */
export function createKanbanModule(): Router {
  return createKanbanRouter({
    boards: kanbanBoardsService,
    cards: kanbanCardsService,
    questions: kanbanQuestionsService,
    checklist: kanbanChecklistService,
    leases: kanbanLeasesService,
    importer: kanbanImportService,
  });
}
