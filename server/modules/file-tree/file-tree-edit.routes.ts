import express from 'express';
import type { Request } from 'express';

import { createInvalidEditError } from '@/modules/file-tree/file-tree-errors.js';
import { createRouteHandler } from '@/modules/file-tree/file-tree-route-handler.js';
import type { FileLinePatch, FileTreeEditService, FileTreeLogger } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** How many lines a window returns when the client does not ask for a number. */
const DEFAULT_WINDOW_LINES = 200;

/** The most lines one window will ever return, however many the client asks for. */
const MAXIMUM_WINDOW_LINES = 400;

/**
 * Logger for this router's error boundary. The composition root's logger is the server console
 * (`file-tree.module.ts`), and this router is built from its service alone, so the one-line
 * delegate lives here rather than in a second constructor parameter.
 */
const editRouteLogger: FileTreeLogger = {
  error: (message, error) => console.error(message, error),
};

function readProjectId(request: Request): string {
  const projectId = request.params.projectId;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new AppError('projectId is required', { statusCode: 400, code: 'INVALID_FILE_TREE_REQUEST' });
  }
  return projectId;
}

/** The window's file: a required, non-empty project-relative path. */
function readWindowPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('Invalid file path', { statusCode: 400, code: 'INVALID_FILE_TREE_REQUEST' });
  }
  return value;
}

/**
 * `start`, clamped to at least 1 — the answer the preview route gives for the same query, and for
 * the same reason: `0`, `-5`, `abc` and nothing at all all mean "from the top", and a 400 would
 * tell the client nothing it could act on. There is deliberately no upper clamp; a start past the
 * end of the file is an empty window.
 */
function readWindowStart(value: unknown): number {
  const parsedStart = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsedStart) ? Math.max(parsedStart, 1) : 1;
}

/** `lines`, clamped to 1–400 and defaulting to 200 — the preview route's clamp, line for line. */
function readWindowLines(value: unknown): number {
  const parsedLines = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsedLines)
    ? Math.min(Math.max(parsedLines, 1), MAXIMUM_WINDOW_LINES)
    : DEFAULT_WINDOW_LINES;
}

/** A body field the patch cannot be applied without; its absence is the edit contract's 400. */
function readPatchString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw createInvalidEditError();
  }
  return value;
}

/**
 * The patch as the request body carries it.
 *
 * Only `path` and `baseRev` are judged here — the two the writer cannot start without. The rest
 * travels as it arrived, because `writeLinePatch` is the one place that rules on a start line, a
 * delete count and the replacement lines (400); a route that re-checked them would be a second
 * copy of the edit rules, free to drift from the first.
 */
function readLinePatch(request: Request): FileLinePatch {
  const body = typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  return {
    path: readPatchString(body, 'path'),
    baseRev: readPatchString(body, 'baseRev'),
    startLine: body.startLine as number,
    deleteCount: body.deleteCount as number,
    lines: body.lines as string[],
  };
}

/**
 * Builds the File Tree editing router, mounted beside the browsing and listing routers on the
 * `/api/file-tree` namespace by `file-tree.module.ts`.
 *
 * Both handlers only parse and delegate: containment, revisions, text detection and every refusal
 * live in the service. Each one is wrapped in the module's shared `createRouteHandler`, so an
 * `AppError` leaves as its own status and message and nothing else leaks a server path.
 */
export function createFileTreeEditRouter(editService: FileTreeEditService): express.Router {
  const router = express.Router();

  router.get('/projects/:projectId/edit-window', createRouteHandler(async (request, response) => {
    response.json(await editService.readEditWindow(
      readProjectId(request),
      readWindowPath(request.query.path),
      readWindowStart(request.query.start),
      readWindowLines(request.query.lines),
    ));
  }, editRouteLogger));

  router.patch('/projects/:projectId/edit', createRouteHandler(async (request, response) => {
    response.json(await editService.patchTextFile(readProjectId(request), readLinePatch(request)));
  }, editRouteLogger));

  return router;
}
