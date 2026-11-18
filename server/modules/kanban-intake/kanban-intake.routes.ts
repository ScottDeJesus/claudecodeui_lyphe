/**
 * The Kanban intake door: the one route by which a trusted machine puts a card on a board.
 *
 * Who calls it: eis_backend's `POST /api/eis/problem-reports`, only for the owner's account, filing a
 * "Something not working?" report. Each report becomes one card.
 *
 * Why no `authenticateToken`: the machine holds no user JWT. This router's first middleware is the
 * credential instead: a shared secret in the `X-Kanban-Intake-Secret` header.
 *
 * Why the secret is never in this server's environment: agent sessions spawned here inherit that environment
 * and could then file cards themselves. The secret is read at call time from eis_backend's own env file, so a
 * rotation needs no restart and no second copy exists.
 *
 * What lands: cards go to the Backlog (`not_ready`, priority `medium`). Every write through this door is
 * stamped with the actor `restorly`, so the activity spine never reads them as the operator's own acts.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { kanbanCardsService } from '@/modules/kanban/index.js';
import type { KanbanWriteContext } from '@/shared/kanban-types.js';

import { createIntakeSecretReader, kanbanIntakeEnvFile, secretsMatch } from './kanban-intake.secret.js';

/** A header, not a body field, so the machine's credential stays out of the card payload. */
const INTAKE_SECRET_HEADER = 'x-kanban-intake-secret';
/** The audit actor for every write through this door, so the activity spine never reads them as the operator's. */
const INTAKE_ACTOR = 'restorly';
/** A title is one line on the board; a longer report belongs in the description. */
const TITLE_MAX_CHARS = 200;
/** Bounds one filed report's body, so a single request cannot store an unbounded card. */
const DESCRIPTION_MAX_CHARS = 8000;
/** A machine-filed card carries a few labels; a long list would crowd the card on the board. */
const TAGS_MAX = 8;
/** A tag is a short label; a longer one is a sentence, and sentences belong in the description. */
const TAG_MAX_CHARS = 40;

/** A valid intake body, trimmed, defaulted and de-duplicated: what the handler files. */
type IntakeCard = {
  boardId: string;
  title: string;
  description: string;
  tags: string[];
};

/**
 * One handler, with its failure path attached once: a sync throw or a rejected promise goes to `next(error)`,
 * and the global handler renders it. Nothing here catches AppErrors for a meaning of its own.
 */
function handle<P = Record<string, string>>(
  run: (request: Request<P>, response: Response, next: NextFunction) => void | Promise<void>
): RequestHandler<P> {
  return (request: Request<P>, response: Response, next: NextFunction) => {
    try {
      void Promise.resolve(run(request, response, next)).catch((error: unknown) => next(error));
    } catch (error) {
      next(error);
    }
  };
}

/** The tags an intake body names, trimmed and de-duplicated; or the sentence for the first bad one. */
function parseTags(raw: unknown): string[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'tags must be an array of strings';
  if (raw.length > TAGS_MAX) return `tags must name at most ${TAGS_MAX} tags`;

  const tags: string[] = [];
  for (const entry of raw) {
    const tag = typeof entry === 'string' ? entry.trim() : '';
    if (tag === '' || tag.length > TAG_MAX_CHARS) {
      return `each tag must be a non-empty string of at most ${TAG_MAX_CHARS} characters`;
    }
    tags.push(tag);
  }
  return [...new Set(tags)];
}

/**
 * The intake body's fields, validated: the parsed card, or the sentence naming the first field that failed.
 * Pure, so the rules read in one place and the handler only routes the answer.
 */
function parseIntakeCard(body: Record<string, unknown>): IntakeCard | string {
  const boardId = typeof body.boardId === 'string' ? body.boardId.trim() : '';
  if (boardId === '') return 'boardId must be a non-empty string';

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title === '') return 'title must be a non-empty string';
  if (title.length > TITLE_MAX_CHARS) return `title must be at most ${TITLE_MAX_CHARS} characters`;

  const description = body.description === undefined ? '' : body.description;
  if (typeof description !== 'string') return 'description must be a string';
  if (description.length > DESCRIPTION_MAX_CHARS) {
    return `description must be at most ${DESCRIPTION_MAX_CHARS} characters`;
  }

  const tags = parseTags(body.tags);
  if (typeof tags === 'string') return tags;

  return { boardId, title, description, tags };
}

/** The door's router: the secret guard first, then the one POST that files a card in the Backlog. */
export function createKanbanIntakeRouter(): Router {
  const router = express.Router();
  const readSecret = createIntakeSecretReader(kanbanIntakeEnvFile());

  const guard = handle(async (request, response, next) => {
    const wanted = await readSecret();
    if (wanted === null) {
      response.status(503).json({ error: 'The Kanban intake door has no secret configured.' });
      return;
    }

    const given = request.get(INTAKE_SECRET_HEADER);
    if (!given || !secretsMatch(given, wanted)) {
      response.status(401).json({ error: 'A Kanban intake request must carry the intake secret.' });
      return;
    }

    next();
  });

  router.use(guard);
  router.post(
    '/cards',
    handle((request, response) => {
      const parsed = parseIntakeCard((request.body ?? {}) as Record<string, unknown>);
      if (typeof parsed === 'string') {
        response.status(400).json({ error: parsed });
        return;
      }

      const context: KanbanWriteContext = { actor: INTAKE_ACTOR };
      const created = kanbanCardsService.createCard(
        parsed.boardId,
        { title: parsed.title, description: parsed.description, status: 'not_ready', priority: 'medium' },
        context
      );

      let card = created;
      for (const tag of parsed.tags) {
        card = kanbanCardsService.addTag(created.id, tag, context);
      }

      response.status(201).json({ card });
    })
  );

  return router;
}
