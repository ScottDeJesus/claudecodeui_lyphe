import express from 'express';
import type { Router } from 'express';

import type { KanbanAttachmentsService } from '../kanban-attachments.service.js';
import type { KanbanBoardsService } from '../kanban-boards.service.js';
import type { KanbanCardsService } from '../kanban-cards.service.js';
import type { KanbanChecklistService } from '../kanban-checklist.service.js';
import type { KanbanLeasesService } from '../kanban-leases.service.js';
import type { KanbanLessonsService } from '../kanban-lessons.service.js';
import type { KanbanQuestionsService } from '../kanban-questions.service.js';

import { createAttachmentRoutes } from './attachment.routes.js';
import { createBoardRoutes } from './board.routes.js';
import type { KanbanMemoryPendingReader } from './board.routes.js';
import * as cardRoutes from './card.routes.js';
import * as detailRoutes from './detail.routes.js';
import { createLearningRoutes } from './learning.routes.js';

/**
 * What the route package is built from.
 *
 * One object rather than one argument per factory: every service lands here as its phase does, and
 * no existing factory's call site has to change — each factory declares only the fields it uses
 * (`CardRouteDependencies`, `DetailRouteDependencies`) and takes them off this object.
 */
export type KanbanServices = {
  boards: KanbanBoardsService;
  cards: KanbanCardsService;
  questions: KanbanQuestionsService;
  checklist: KanbanChecklistService;
  attachments: KanbanAttachmentsService;
  leases: KanbanLeasesService;
  lessons: KanbanLessonsService;
  // The one READING the board cannot take for itself, handed in by the composition root rather
  // than imported: the estate's pending memories live in the memory-intake lane's table, and this
  // module does not import it. `board.routes.ts` declares the shape it uses; it rides here
  // because this bag is what the module hands every factory.
  memoryPending: KanbanMemoryPendingReader;
};

/**
 * The board module's route factory — and the only file in `routes/` that more than one phase
 * touches.
 *
 * Thirty-one routes in one file is born over the house ceiling, so the routes are a PACKAGE and
 * this file is the mount: it builds one router and hands the services to each sibling factory.
 * It holds no route handler of its own, ever, and it decides no paths of its own either — the
 * prefixes are the siblings' (`board.routes.ts` owns `/boards`, `/projects/:projectId/board` and
 * `/events`; `learning.routes.ts` owns `/lessons` and its two reviews), which is what keeps a path
 * from being declared in two places.
 */
export function createKanbanRouter(services: KanbanServices): Router {
  const router = express.Router();

  router.use(createBoardRoutes(services));
  router.use(cardRoutes.createCardRoutes(services));
  router.use(detailRoutes.createDetailRoutes(services));
  // The card's ATTACHMENT BYTES: the one mount in this package that takes a multipart body and
  // streams a file. Its paths are its own, so its position here decides nothing.
  router.use(createAttachmentRoutes(services));
  router.use(createLearningRoutes(services));

  return router;
}
