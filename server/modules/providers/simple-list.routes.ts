import { Router, type Request, type Response } from 'express';

import type { SimpleListLadderItem } from '@/modules/database/index.js';
import { simpleListService } from '@/modules/providers/services/simple-list.service.js';
import {
  AppError,
  asyncHandler,
  createApiSuccessResponse,
  parseSessionId,
  readPathParam,
} from '@/shared/utils.js';

/**
 * The simple chat list's four writes: create, rename or fold, delete a folder, and move one row.
 *
 * The routes own the whole transport contract — shapes, lengths and ids — so the service and the
 * repository below answer only what the state refuses. Mounted by `provider.routes.ts` with
 * `router.use(simpleListRoutes)` beside `router.use(sessionUserStateRoutes)`.
 */

/** A folder's id: the shape `randomUUID` mints, and the one shape a path may carry. */
const FOLDER_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** A folder name's ceiling; the floor is one character after the trim. */
const FOLDER_NAME_MAX_LENGTH = 80;

/** A body that is not an object carries no field to read, so each parser below rejects its own way. */
const readBody = (payload: unknown): Record<string, unknown> =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

/** Whether a value is a usable folder id, wherever it arrives: a path segment or a position body. */
const isFolderId = (value: unknown): value is string =>
  typeof value === 'string' && FOLDER_ID_PATTERN.test(value);

/** The one refusal a position body answers with: every unusable shape is this 400. */
const invalidPosition = (detail: string): AppError =>
  new AppError(detail, { code: 'INVALID_SIMPLE_LIST_POSITION', statusCode: 400 });

/** A folder's name as stored: trimmed, or null when the value is not a usable one. */
const readFolderName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const name = value.trim();
  return name.length >= 1 && name.length <= FOLDER_NAME_MAX_LENGTH ? name : null;
};

/**
 * A chat's id inside a body. It passes the shared session-id parser, but a malformed one is
 * refused by this body's own 400 rather than leaking the id parser's code.
 */
const readChatSessionId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  try {
    return parseSessionId(value);
  } catch {
    return null;
  }
};

/** Reads the name a new folder is born with; the service mints its id, and nothing else is decided here. */
const parseFolderNameBody = (payload: unknown): string => {
  const name = readFolderName(readBody(payload).name);

  if (name === null) {
    throw new AppError('name must be a string of 1 to 80 characters.', {
      code: 'INVALID_SIMPLE_LIST_FOLDER_NAME',
      statusCode: 400,
    });
  }

  return name;
};

/** Reads the `:folderId` path parameter: a malformed one is a 400 here, never a lookup. */
const parseFolderIdParam = (value: unknown): string => {
  const folderId = readPathParam(value, 'folderId').trim();

  if (!isFolderId(folderId)) {
    throw new AppError('Invalid folderId.', {
      code: 'INVALID_SIMPLE_LIST_FOLDER_ID',
      statusCode: 400,
    });
  }

  return folderId;
};

/**
 * Reads a folder update: a `name`, a `collapsed` boolean, or both. An empty change is refused
 * rather than answered, because a PATCH that writes nothing would still announce a change.
 */
const parseFolderChangeBody = (payload: unknown): { name?: string; collapsed?: boolean } => {
  const body = readBody(payload);
  const change: { name?: string; collapsed?: boolean } = {};

  if (body.name !== undefined) {
    const name = readFolderName(body.name);
    if (name === null) {
      throw new AppError('name must be a string of 1 to 80 characters.', {
        code: 'INVALID_SIMPLE_LIST_FOLDER_NAME',
        statusCode: 400,
      });
    }
    change.name = name;
  }

  if (body.collapsed !== undefined) {
    if (typeof body.collapsed !== 'boolean') {
      throw new AppError('collapsed must be a boolean.', {
        code: 'INVALID_SIMPLE_LIST_FOLDER',
        statusCode: 400,
      });
    }
    change.collapsed = body.collapsed;
  }

  if (change.name === undefined && change.collapsed === undefined) {
    throw new AppError('A folder update must carry name, collapsed, or both.', {
      code: 'INVALID_SIMPLE_LIST_FOLDER',
      statusCode: 400,
    });
  }

  return change;
};

/** Reads the row a position names: a chat by its session id, a folder by its folder id. */
const parsePositionItem = (value: unknown, detail: string): SimpleListLadderItem => {
  const item = readBody(value);

  if (item.kind === 'chat') {
    const id = readChatSessionId(item.id);
    if (id !== null) return { kind: 'chat', id };
  }

  if (item.kind === 'folder' && isFolderId(item.id)) {
    return { kind: 'folder', id: item.id };
  }

  throw invalidPosition(detail);
};

/** The container a position asks for: null is the top level, and nothing else but a folder id is accepted. */
const readPositionFolderId = (value: unknown): string | null => {
  if (value === null) return null;
  if (isFolderId(value)) return value;

  throw invalidPosition('folderId must be null or a folder id.');
};

/**
 * Reads a whole position: the row that moves, the container it lands in, and the row it sits
 * directly after — or null, for the first place in that container.
 */
const parsePositionBody = (
  payload: unknown
): { item: SimpleListLadderItem; folderId: string | null; after: SimpleListLadderItem | null } => {
  const body = readBody(payload);

  return {
    item: parsePositionItem(body.item, 'item must name a chat or a folder.'),
    folderId: readPositionFolderId(body.folderId),
    after:
      body.after === null ? null : parsePositionItem(body.after, 'after must be null or an item.'),
  };
};

export const simpleListRoutes = Router();

simpleListRoutes.post(
  '/simple-list/folders',
  asyncHandler(async (req: Request, res: Response) => {
    const name = parseFolderNameBody(req.body);
    res.status(201).json(createApiSuccessResponse(simpleListService.createFolder(name)));
  }),
);

simpleListRoutes.patch(
  '/simple-list/folders/:folderId',
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseFolderIdParam(req.params.folderId);
    const change = parseFolderChangeBody(req.body);
    res.json(createApiSuccessResponse(simpleListService.updateFolder(folderId, change)));
  }),
);

simpleListRoutes.delete(
  '/simple-list/folders/:folderId',
  asyncHandler(async (req: Request, res: Response) => {
    const folderId = parseFolderIdParam(req.params.folderId);
    res.json(createApiSuccessResponse(simpleListService.deleteFolder(folderId)));
  }),
);

simpleListRoutes.put(
  '/simple-list/position',
  asyncHandler(async (req: Request, res: Response) => {
    const { item, folderId, after } = parsePositionBody(req.body);
    res.json(createApiSuccessResponse(simpleListService.moveItem(item, folderId, after)));
  }),
);
