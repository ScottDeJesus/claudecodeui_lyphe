/**
 * The proposed features' routes, mounted at `/api/kanban-dispatch/proposals` behind `authenticateToken`.
 * Each route runs one dispatcher command through the shared relay in `kanban-dispatch.verb.ts`:
 *   GET  /              `dispatcher bug proposals [--all] --json`, scoped to one board (or `all`)
 *   POST /:id/promote   `dispatcher bug proposal promote <id> --arc=… --by=…`
 *   POST /:id/send-back `dispatcher bug proposal send-back <id>`
 *   POST /:id/dismiss   `dispatcher bug proposal dismiss <id> --reason=…`
 *   POST /:id/priority  `dispatcher bug proposal priority <id> <low|medium|high>`
 * The listing is scoped to a board by `kanbanBoardsService.boardForPath`: the board whose folders hold the
 * proposal's `path`, the same rule the placing pass places a ticket by. Each answered proposal carries that
 * board's name as `boardName` (`''` when no board holds it).
 * Options go in the `--flag=value` form, so text that begins with a dash is never read as a flag.
 * Proposal ids appear only in routes, never in a sentence a person reads (INV-76).
 */

import express from 'express';

import type { CommandDependencies } from '@/modules/dispatcher/index.js';
import { kanbanBoardsService } from '@/modules/kanban/index.js';
import { KANBAN_PRIORITIES, type KanbanPriority } from '@/shared/kanban-types.js';
import type { BugProposal, BugProposalRecord } from '@/shared/hunt-types.js';

import { readProposals } from './kanban-dispatch.proposals-read.js';
import {
  answerLine,
  bodyOf,
  relayLine,
  routeId,
  runVerb,
  sendBadRequest,
  sendFailure,
} from './kanban-dispatch.verb.js';

const ALL_BOARDS = 'all';
const STATES = ['open', 'all'] as const;
const PROMOTE_BY = 'app:card';
const REASON_MAX = 500;
const STATUS_BAD_GATEWAY = 502;

/** The first value that is a plain string; a query value that is an array gives its element 0. */
function firstPlain(raw: unknown): string | undefined {
  const first: unknown = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? first : undefined;
}

/** A string with some text in it, or null. */
function textOf(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/** The priority a body names, one of the kanban's levels, or undefined. */
function priorityOf(raw: unknown): KanbanPriority | undefined {
  return KANBAN_PRIORITIES.find((level) => level === raw);
}

/** The proposal a POST names, or null once its 400 is answered. */
function proposalIdOf(raw: unknown, response: express.Response): string | null {
  const id = routeId(raw);
  if (id === null) sendBadRequest(response, 'a proposal is named by its number');
  return id;
}

/** The JSON object a POST carries, or null once its 400 is answered. */
function bodyObjectOf(raw: unknown, response: express.Response): Record<string, unknown> | null {
  const body = bodyOf(raw);
  if (body === null) sendBadRequest(response, 'the body must be a JSON object');
  return body;
}

export function createProposalsRouter(commands: CommandDependencies): express.Router {
  const router = express.Router();

  router.get('/', async (request, response, next) => {
    try {
      const boardId = firstPlain(request.query.board);
      if (boardId === undefined || boardId === '') {
        sendBadRequest(response, 'name a board, or all');
        return;
      }
      const requested = request.query.state === undefined ? 'open' : firstPlain(request.query.state);
      const state = STATES.find((known) => known === requested);
      if (state === undefined) {
        sendBadRequest(response, 'state is open or all');
        return;
      }
      const outcome = await runVerb(commands, ['bug', 'proposals', ...(state === 'all' ? ['--all'] : []), '--json']);
      if (!outcome.ok) {
        sendFailure(response, outcome);
        return;
      }
      let records: BugProposalRecord[];
      try {
        records = readProposals(JSON.parse(answerLine(outcome.stdout)), 'dispatcher bug proposals --json');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[kanban-dispatch] ' + message);
        response.status(STATUS_BAD_GATEWAY).json({ error: message });
        return;
      }
      const allBoards = boardId === ALL_BOARDS;
      const proposals: BugProposal[] = [];
      for (const record of records) {
        const board = kanbanBoardsService.boardForPath(record.path);
        if (allBoards || board?.id === boardId) {
          proposals.push({ ...record, boardName: board?.name ?? '' });
        }
      }
      response.json({ proposals });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/promote', async (request, response, next) => {
    try {
      const id = proposalIdOf(request.params.id, response);
      if (id === null) return;
      const body = bodyObjectOf(request.body, response);
      if (body === null) return;
      const arc = textOf(body.arc);
      if (arc === null) {
        sendBadRequest(response, 'name the epic the idea lands under, as arc');
        return;
      }
      await relayLine(commands, ['bug', 'proposal', 'promote', id, `--arc=${arc}`, `--by=${PROMOTE_BY}`], response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/send-back', async (request, response, next) => {
    try {
      const id = proposalIdOf(request.params.id, response);
      if (id === null) return;
      await relayLine(commands, ['bug', 'proposal', 'send-back', id], response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/dismiss', async (request, response, next) => {
    try {
      const id = proposalIdOf(request.params.id, response);
      if (id === null) return;
      const body = bodyObjectOf(request.body, response);
      if (body === null) return;
      const raw = body.reason;
      const reason = typeof raw === 'string' ? raw.trim() : '';
      if (reason === '' || reason.length > REASON_MAX) {
        sendBadRequest(response, `say why, in at most ${REASON_MAX} characters, as reason`);
        return;
      }
      await relayLine(commands, ['bug', 'proposal', 'dismiss', id, `--reason=${reason}`], response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/priority', async (request, response, next) => {
    try {
      const id = proposalIdOf(request.params.id, response);
      if (id === null) return;
      const body = bodyObjectOf(request.body, response);
      if (body === null) return;
      const priority = priorityOf(body.priority);
      if (priority === undefined) {
        sendBadRequest(response, 'priority is low, medium or high');
        return;
      }
      await relayLine(commands, ['bug', 'proposal', 'priority', id, priority], response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
