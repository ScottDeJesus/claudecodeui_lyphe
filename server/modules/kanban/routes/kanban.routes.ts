import express from 'express';
import type { Router } from 'express';

import type { KanbanBoardsService } from '../kanban-boards.service.js';
import type { KanbanCardsService } from '../kanban-cards.service.js';
import type { KanbanChecklistService } from '../kanban-checklist.service.js';
import type { KanbanImportService } from '../kanban-import.service.js';
import type { KanbanLeasesService } from '../kanban-leases.service.js';
import type { KanbanQuestionsService } from '../kanban-questions.service.js';

import { createBoardRoutes } from './board.routes.js';
import * as cardRoutes from './card.routes.js';
import * as detailRoutes from './detail.routes.js';
import * as importRoutes from './import.routes.js';

/**
 * What the route package is built from.
 *
 * One object rather than one argument per factory: the import sibling adds its field here as it
 * lands, and no existing factory's call site has to change — each factory declares only the fields
 * it uses (`CardRouteDependencies`, `DetailRouteDependencies`) and takes them off this object.
 */
export type KanbanServices = {
  boards: KanbanBoardsService;
  cards: KanbanCardsService;
  questions: KanbanQuestionsService;
  checklist: KanbanChecklistService;
  leases: KanbanLeasesService;
  importer: KanbanImportService;
};

/**
 * The board module's route factory — and the only file in `routes/` that more than one phase
 * touches.
 *
 * Thirty-one routes in one file is born over the house ceiling, so the routes are a PACKAGE and
 * this file is the mount: it builds one router and hands the services to each sibling factory.
 * It holds no route handler of its own, ever, and it decides no paths of its own either — the
 * prefixes are the siblings' (`board.routes.ts` owns `/boards`, `/projects/:projectId/board` and
 * `/events`), which is what keeps a path from being declared in two places.
 */
export function createKanbanRouter(services: KanbanServices): Router {
  const router = express.Router();

  router.use(createBoardRoutes(services));
  router.use(cardRoutes.createCardRoutes(services));
  router.use(detailRoutes.createDetailRoutes(services));
  router.use(importRoutes.createImportRoutes(services));

  return router;
}
