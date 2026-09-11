import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type {
  FileTreeListingServices,
  FileTreeLogger,
  FileTreeServices,
  FileTreeUploadedFile,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type FileTreeUploadLimits = {
  maximumFileSizeMegabytes: number;
  maximumFileCount: number;
};

/** How many lines a preview returns when the client does not ask for a number. */
const DEFAULT_PREVIEW_LINES = 200;

/** The most lines one preview will ever return, however many the client asks for. */
const MAXIMUM_PREVIEW_LINES = 400;

type UploadedRequest = Request & {
  files?: Express.Multer.File[];
};

function readBody(request: Request): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
}

function readRequiredString(value: unknown, fieldName: string, message?: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(message ?? `${fieldName} is required`, {
      code: 'INVALID_FILE_TREE_REQUEST',
      statusCode: 400,
    });
  }
  return value;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readProjectId(request: Request): string {
  return readRequiredString(request.params.projectId, 'projectId');
}

function readEntryType(value: unknown): 'file' | 'directory' {
  if (value !== 'file' && value !== 'directory') {
    throw new AppError('Type must be "file" or "directory"', {
      code: 'INVALID_FILE_TREE_ENTRY_TYPE',
      statusCode: 400,
    });
  }
  return value;
}

function readRelativePaths(value: unknown): string[] {
  if (typeof value !== 'string' || !value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Reads `lines` for a preview request.
 *
 * Out-of-range values are CLAMPED rather than rejected: a client asking for
 * 9999 lines wants as much as it can get, and a 400 would tell it nothing it
 * could act on. A missing or unparseable value takes the default.
 */
function readPreviewLineCount(value: unknown): number {
  const parsedCount = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsedCount)
    ? Math.min(Math.max(parsedCount, 1), MAXIMUM_PREVIEW_LINES)
    : DEFAULT_PREVIEW_LINES;
}

/**
 * Reads `start` for a preview request — the first line of the window.
 *
 * Clamped to at least 1 exactly as `lines` is clamped above, and for the same reason: a
 * client spelling `0`, `-5`, `abc` or nothing at all means "from the top", and a 400 would
 * tell it nothing it could act on. There is deliberately no UPPER clamp: nothing at this layer
 * knows how long the file is, and a start past its end is not an error but an empty window.
 * What that costs is bounded in the SERVICE, which is the only layer holding the file's size —
 * below the counting cap it walks the file for `totalLines` regardless, and above it a start
 * past what the bytes could possibly hold is answered without reading at all.
 */
function readPreviewStartLine(value: unknown): number {
  const parsedStart = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsedStart) ? Math.max(parsedStart, 1) : 1;
}

function readRequestedFileCount(value: unknown, fallbackCount: number): number {
  const parsedCount = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : fallbackCount;
}

function normalizeUploadedFiles(request: UploadedRequest): FileTreeUploadedFile[] {
  return Array.isArray(request.files)
    ? request.files.map((file) => ({
        originalName: file.originalname,
        temporaryPath: file.path,
        size: file.size,
        mimeType: file.mimetype,
      }))
    : [];
}

function createRouteHandler(
  operation: (request: Request, response: Response) => void | Promise<void>,
  logger: FileTreeLogger,
): RequestHandler {
  return async (request, response) => {
    try {
      await operation(request, response);
    } catch (error) {
      if (error instanceof AppError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error('File Tree API error', error);
      response.status(500).json({ error: message });
    }
  };
}

/**
 * Builds the File Tree HTTP router for the server composition root and route tests.
 * Paths are relative to the module's `/api/file-tree` mount point so the
 * complete HTTP surface has one feature-owned namespace.
 */
export function createFileTreeRouter(
  services: FileTreeServices,
  uploadFilesMiddleware: RequestHandler,
  uploadLimits: FileTreeUploadLimits,
  logger: FileTreeLogger,
): express.Router {
  const router = express.Router();

  router.get('/browse-filesystem', createRouteHandler(async (request, response) => {
    response.json(await services.browseWorkspace(readOptionalString(request.query.path)));
  }, logger));

  router.post('/create-folder', createRouteHandler(async (request, response) => {
    const body = readBody(request);
    const folderPath = readRequiredString(body.path, 'path', 'Path is required');
    response.json(await services.createWorkspaceFolder(folderPath));
  }, logger));

  router.get('/projects/:projectId/file', createRouteHandler(async (request, response) => {
    const filePath = readRequiredString(request.query.filePath, 'filePath', 'Invalid file path');
    response.json(await services.readTextFile(readProjectId(request), filePath));
  }, logger));

  router.get('/projects/:projectId/files/content', createRouteHandler(async (request, response) => {
    const filePath = readRequiredString(request.query.path, 'path', 'Invalid file path');
    const file = await services.openFile(readProjectId(request), filePath);
    response.setHeader('Content-Type', file.contentType);
    file.stream.pipe(response);
    file.stream.on('error', (error) => {
      logger.error('Error streaming File Tree content', error);
      if (!response.headersSent) {
        response.status(500).json({ error: 'Error reading file' });
      }
    });
  }, logger));

  router.put('/projects/:projectId/file', createRouteHandler(async (request, response) => {
    const body = readBody(request);
    const filePath = readRequiredString(body.filePath, 'filePath', 'Invalid file path');
    if (body.content === undefined) {
      throw new AppError('Content is required', {
        code: 'FILE_CONTENT_REQUIRED',
        statusCode: 400,
      });
    }
    if (typeof body.content !== 'string') {
      throw new AppError('Content must be a string', {
        code: 'INVALID_FILE_CONTENT',
        statusCode: 400,
      });
    }
    response.json(await services.saveTextFile(readProjectId(request), filePath, body.content));
  }, logger));

  router.get('/projects/:projectId/files', createRouteHandler(async (request, response) => {
    response.json(await services.listProjectFiles(readProjectId(request), {
      respectGitignore: request.query.respectGitignore === 'true',
    }));
  }, logger));

  router.post('/projects/:projectId/files/create', createRouteHandler(async (request, response) => {
    const body = readBody(request);
    if (!body.name || !body.type) {
      throw new AppError('Name and type are required', {
        code: 'FILE_TREE_ENTRY_FIELDS_REQUIRED',
        statusCode: 400,
      });
    }
    const name = readRequiredString(body.name, 'name');
    const type = readEntryType(body.type);
    const parentPath = readOptionalString(body.path) ?? '';
    response.json(await services.createEntry({
      projectId: readProjectId(request),
      parentPath,
      type,
      name,
    }));
  }, logger));

  router.put('/projects/:projectId/files/rename', createRouteHandler(async (request, response) => {
    const body = readBody(request);
    if (!body.oldPath || !body.newName) {
      throw new AppError('oldPath and newName are required', {
        code: 'FILE_TREE_RENAME_FIELDS_REQUIRED',
        statusCode: 400,
      });
    }
    response.json(await services.renameEntry({
      projectId: readProjectId(request),
      oldPath: readRequiredString(body.oldPath, 'oldPath'),
      newName: readRequiredString(body.newName, 'newName'),
    }));
  }, logger));

  router.delete('/projects/:projectId/files', createRouteHandler(async (request, response) => {
    const body = readBody(request);
    const targetPath = readRequiredString(body.path, 'path', 'Path is required');
    response.json(await services.deleteEntry({
      projectId: readProjectId(request),
      targetPath,
    }));
  }, logger));

  const uploadHandler = createRouteHandler(async (request, response) => {
    const uploadedRequest = request as UploadedRequest;
    const body = readBody(request);
    const files = normalizeUploadedFiles(uploadedRequest);
    response.json(await services.storeUploadedFiles({
      projectId: readProjectId(request),
      targetPath: readOptionalString(body.targetPath) ?? '',
      relativePaths: readRelativePaths(body.relativePaths),
      requestedFileCount: readRequestedFileCount(body.requestedFileCount, files.length),
      files,
    }));
  }, logger);

  router.post(
    '/projects/:projectId/files/upload',
    (request: Request, response: Response, next: NextFunction) => {
      uploadFilesMiddleware(request, response, (error?: unknown) => {
        if (!error) {
          void uploadHandler(request, response, next);
          return;
        }

        const errorCode = typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : null;
        if (errorCode === 'LIMIT_FILE_SIZE') {
          response.status(400).json({
            error: `File too large. Maximum size is ${uploadLimits.maximumFileSizeMegabytes}MB.`,
          });
          return;
        }
        if (errorCode === 'LIMIT_FILE_COUNT') {
          response.status(400).json({
            error: `Too many files. Maximum is ${uploadLimits.maximumFileCount} files.`,
          });
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        response.status(500).json({ error: message });
      });
    },
  );

  return router;
}

/**
 * Builds the File Tree directory-listing and file-preview router.
 *
 * Mounted beside `createFileTreeRouter` on the same `/api/file-tree` namespace by
 * `file-tree.module.ts`. It is a router of its own because these two routes are
 * served by a different service; keeping them out of the browsing router leaves
 * that router's signature — and every existing caller of it — untouched.
 *
 * Both handlers only parse the query and hand it on: containment, binary
 * detection, and line counting all live in the listing service.
 */
export function createFileTreeListingRouter(
  listingServices: FileTreeListingServices,
  logger: FileTreeLogger,
): express.Router {
  const router = express.Router();

  // An absent `path` is the project root, not a bad request — that is where the
  // file manager opens.
  router.get('/projects/:projectId/list', createRouteHandler(async (request, response) => {
    response.json(await listingServices.listDirectory(
      readProjectId(request),
      readOptionalString(request.query.path) ?? '',
    ));
  }, logger));

  router.get('/projects/:projectId/preview', createRouteHandler(async (request, response) => {
    response.json(await listingServices.previewFile(
      readProjectId(request),
      readRequiredString(request.query.path, 'path', 'Invalid file path'),
      readPreviewLineCount(request.query.lines),
      readPreviewStartLine(request.query.start),
    ));
  }, logger));

  return router;
}
