/**
 * The Kanban intake door: the one route by which a trusted machine puts a card on a board.
 *
 * Who calls it: eis_backend's `POST /api/eis/problem-reports`, filing a Restorly "Something not working?"
 * report from any account. Each report becomes one card.
 *
 * Why no `authenticateToken`: the machine holds no user JWT. This router's first middleware is the
 * credential instead: a shared secret in the `X-Kanban-Intake-Secret` header.
 *
 * Why the secret is never in this server's environment: agent sessions spawned here inherit that environment,
 * so holding it there would hand it to every one of them for free (they run as the same user as the env file,
 * so this is hygiene against casual reach, not a wall). The secret is read at call time from eis_backend's
 * own env file, so a
 * rotation needs no restart and no second copy exists.
 *
 * What lands: the caller chooses the lane, Backlog (`not_ready`) or To do (`todo`), and To do when it names
 * none (the owner's report is his approval; anyone else's waits in Backlog for triage). The priority is the one
 * the body names (`low` | `medium` | `high`), `medium` when it names none; an unknown status or priority is a 400.
 *
 * Why the reporter travels as its own field rather than inside the title: the door renders it, so every caller
 * gets the same "<reporter>: <title>" shape within the title bound, and the Bugs view draws a card by its title,
 * so the name has to be in the title to be seen at all.
 *
 * Every write through this door is stamped with the actor `restorly`, so the activity spine never reads them as
 * the operator's own acts.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { kanbanCardsService } from '@/modules/kanban/index.js';
import { KANBAN_PRIORITIES } from '@/shared/kanban-types.js';
import type { KanbanPriority, KanbanStatus, KanbanWriteContext } from '@/shared/kanban-types.js';

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
/** An intake body that names no priority files at medium, as the door always has. */
const DEFAULT_PRIORITY: KanbanPriority = 'medium';
/** The lanes a machine may file into: Backlog for a report that waits for triage, To do for an approved one. */
const INTAKE_STATUSES: readonly KanbanStatus[] = ['not_ready', 'todo'];
/** An intake body that names no status files in To do, as the door always has. */
const DEFAULT_STATUS: KanbanStatus = 'todo';
/** A reporter is a person's name on one line, short enough to leave the title room. */
const REPORTER_MAX_CHARS = 60;
/** Closes a title cut to fit, so a reader sees it was cut. */
const TITLE_CUT_MARK = '…';

/** A valid intake body, trimmed, defaulted and de-duplicated: what the handler files. */
type IntakeCard = {
  boardId: string;
  title: string;
  description: string;
  tags: string[];
  priority: KanbanPriority;
  status: KanbanStatus;
  reporter: string | null;
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

/** Narrows a string to a priority the board knows. */
function isKanbanPriority(value: string): value is KanbanPriority {
  return (KANBAN_PRIORITIES as readonly string[]).includes(value);
}

/** The priority an intake body names, trimmed; the default when it names none; or the sentence for a bad one. */
function parsePriority(raw: unknown): { priority: KanbanPriority } | { error: string } {
  if (raw === undefined || raw === null) return { priority: DEFAULT_PRIORITY };

  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (isKanbanPriority(trimmed)) return { priority: trimmed };

  return { error: `priority must be one of ${KANBAN_PRIORITIES.join(', ')}` };
}

/** Narrows a string to a lane this door files into. */
function isIntakeStatus(value: string): value is KanbanStatus {
  return (INTAKE_STATUSES as readonly string[]).includes(value);
}

/** The lane an intake body names, trimmed; To do when it names none; or the sentence for a bad one. */
function parseStatus(raw: unknown): { status: KanbanStatus } | { error: string } {
  if (raw === undefined || raw === null) return { status: DEFAULT_STATUS };

  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (isIntakeStatus(trimmed)) return { status: trimmed };

  return { error: `status must be one of ${INTAKE_STATUSES.join(', ')}` };
}

/** The reporter an intake body names, trimmed; null when it names none; or the sentence for a bad one. */
function parseReporter(raw: unknown): { reporter: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { reporter: null };

  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  // Every C0/C1 control (\n, \r, VT, FF, NEL among them) and the two Unicode separators: a name is one plain line.
  const isOneLine = !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(trimmed);
  if (trimmed !== '' && trimmed.length <= REPORTER_MAX_CHARS && isOneLine) return { reporter: trimmed };

  return { error: `reporter must be one line of at most ${REPORTER_MAX_CHARS} characters` };
}

/**
 * The card's title: the body's title alone, or "<reporter>: <title>" cut to the title bound with a closing mark.
 * A cut never keeps half of a surrogate pair (an emoji would store as U+FFFD), so it may land one unit short.
 * Pure, so the one shape every caller gets reads in one place.
 */
export function cardTitle(title: string, reporter: string | null): string {
  if (reporter === null) return title;

  const named = `${reporter}: ${title}`;
  if (named.length <= TITLE_MAX_CHARS) return named;

  const kept = named.slice(0, TITLE_MAX_CHARS - TITLE_CUT_MARK.length).replace(/[\uD800-\uDBFF]$/, '');
  return kept + TITLE_CUT_MARK;
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

  const parsedPriority = parsePriority(body.priority);
  if ('error' in parsedPriority) return parsedPriority.error;

  const parsedStatus = parseStatus(body.status);
  if ('error' in parsedStatus) return parsedStatus.error;

  const parsedReporter = parseReporter(body.reporter);
  if ('error' in parsedReporter) return parsedReporter.error;

  return {
    boardId,
    title,
    description,
    tags,
    priority: parsedPriority.priority,
    status: parsedStatus.status,
    reporter: parsedReporter.reporter,
  };
}

/** The door's router: the secret guard first, then the one POST that files a card in the lane the body names. */
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
        {
          title: cardTitle(parsed.title, parsed.reporter),
          description: parsed.description,
          status: parsed.status,
          priority: parsed.priority,
        },
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
