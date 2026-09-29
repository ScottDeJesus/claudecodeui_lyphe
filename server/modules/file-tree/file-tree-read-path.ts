import path from 'node:path';

import { AppError, resolvePathInsideProject, validateWorkspacePath } from '@/shared/utils.js';

/**
 * Resolves the path of a file a client wants to READ.
 *
 * A project's files are not the only files a conversation names: the assistant reads a picture
 * under `~/.claude/state/images`, a note under `~/.cloudcli`, and the chip it leaves in the reply
 * points at that absolute path. The project root alone would refuse it, and the reader would see
 * "file not found". So a read takes two doors:
 *
 * - a relative path is a project path, contained exactly as `resolvePathInsideProject` decides;
 * - an ABSOLUTE path is accepted where it already falls inside the project, and otherwise where
 *   `validateWorkspacePath` accepts it — under `WORKSPACES_ROOT`, symlinks resolved, and not a
 *   system directory. The returned path is that validator's real path, so a link cannot carry the
 *   read out of the workspace.
 *
 * Only reads may use this. Writing, renaming, deleting and uploading keep
 * `resolvePathInsideProject`, so widening what a client can SEE never widens what it can change.
 *
 * The refusal is the same 403 the project-root rule throws and, like it, names neither the
 * requested nor the resolved path: the message reaches the browser.
 *
 * Consumed by `file-tree.service.ts` (`readTextFile`, `openFile`) and
 * `file-tree-listing.service.ts` (`previewFile`), so every read of a file goes through one rule.
 */
export async function resolveReadablePath(projectRoot: string, requestedPath: string): Promise<string> {
  try {
    return resolvePathInsideProject(projectRoot, requestedPath);
  } catch (error) {
    // Only an absolute path has anywhere else to be; a relative one that climbs out is refused.
    if (!path.isAbsolute(requestedPath) || !(error instanceof AppError) || error.code !== 'PATH_OUTSIDE_PROJECT') {
      throw error;
    }
  }

  const validation = await validateWorkspacePath(requestedPath);
  if (!validation.valid || !validation.resolvedPath) {
    throw new AppError('Path must be under the project or workspace root', {
      statusCode: 403,
      code: 'PATH_OUTSIDE_PROJECT',
    });
  }
  return validation.resolvedPath;
}
