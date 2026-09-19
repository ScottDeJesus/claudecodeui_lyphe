import { AppError } from '@/shared/utils.js';

/**
 * Builds a File Tree `AppError` from a message, a status and a code.
 *
 * The single constructor every File Tree refusal goes through, so a route never has to know
 * which shape of error a service throws — `createRouteHandler` answers `AppError` and nothing
 * else. Consumed by `file-tree.service.ts` and `file-tree-errors.ts` itself.
 */
export function createFileTreeError(message: string, statusCode: number, code: string): AppError {
  return new AppError(message, { statusCode, code });
}

/**
 * The `code` of a thrown filesystem error, or `null` when the value carries none.
 *
 * Node's `fs` errors are the only ones with this shape; anything else (a bug, a rejected
 * promise with a string) answers `null` and is left to the caller's fallback.
 */
export function readErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

/**
 * The 409 of the edit path: the revision the caller held is no longer the file's.
 *
 * Shared by `file-tree-edit.service.ts` (a window read that found the file had moved under it)
 * and `file-line-patch.ts` (a patch whose `baseRev` is stale, or one that lost the file to
 * another writer between its first and its second check), so the sentence has one author.
 */
export function createStaleRevisionError(): AppError {
  return createFileTreeError('This file changed on disk since it was opened', 409, 'STALE_REVISION');
}

/**
 * The 400 of the edit path: a line-range patch that could never be applied as written.
 *
 * Thrown by `file-line-patch.ts` for every rule of its shape — a line number below 1, a negative
 * count, a non-integer, a replacement line carrying its own newline — and by
 * `file-tree-edit.routes.ts` for a body missing the path or the revision it replaces.
 */
export function createInvalidEditError(): AppError {
  return createFileTreeError('The edit is not valid', 400, 'INVALID_LINE_PATCH');
}

/** One filesystem code's answer: the sentence the browser reads, and the status it carries. */
export type FileSystemErrorMessages = Partial<Record<string, { message: string; statusCode: number }>>;

/**
 * The two refusals every filesystem call in the EDIT path shares: the file is not there, or this
 * process may not touch it.
 *
 * One table for the window read, the byte walker and the writer, so a mode-`000` file answers the
 * same 403 whichever layer reaches for it first. The browser is told which of the two it is, never
 * Node's own message — that one names a server path (`utils.ts`'s rule).
 */
export const EDIT_PATH_FILE_SYSTEM_ERRORS: FileSystemErrorMessages = {
  ENOENT: { message: 'File not found', statusCode: 404 },
  EACCES: { message: 'Permission denied', statusCode: 403 },
  // `EPERM` is the same refusal as `EACCES` from a write — an immutable file, a mount that says no.
  EPERM: { message: 'Permission denied', statusCode: 403 },
};

/**
 * Turns a filesystem failure into a controlled response, or rethrows one it does not know.
 *
 * Each caller names the codes its own operation can produce and the answer each one deserves —
 * an absent file is a 404, a wall is a 403 — so a service never guesses what a failure meant
 * from its own shape. Consumed by both File Tree services: `file-tree.service.ts` (browse,
 * create, upload) and `file-tree-edit.service.ts` (windowed reads and line-range saves).
 */
export function mapFileSystemError(error: unknown, messages: FileSystemErrorMessages): never {
  const errorCode = readErrorCode(error);
  const mappedError = errorCode ? messages[errorCode] : undefined;
  if (mappedError) {
    throw createFileTreeError(mappedError.message, mappedError.statusCode, errorCode ?? 'FILE_TREE_ERROR');
  }

  throw error;
}
