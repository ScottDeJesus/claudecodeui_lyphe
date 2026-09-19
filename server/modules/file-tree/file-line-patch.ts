import { randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  createInvalidEditError,
  createStaleRevisionError,
  EDIT_PATH_FILE_SYSTEM_ERRORS,
  mapFileSystemError,
} from '@/modules/file-tree/file-tree-errors.js';
import type { FileLineIndex, FileLinePatch, FileLineShape, FileTreeFileSystem } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The open file an exclusive create answers — the composition root's own handle type, taken from
 * the capability rather than named here: only `file-tree.module.ts` knows Node's filesystem.
 */
type OpenedFile = Awaited<ReturnType<FileTreeFileSystem['openExclusive']>>;

/** The terminator bytes a patch writes, spelled once. */
const EOL_BYTES: Record<'\n' | '\r\n', Buffer> = {
  '\n': Buffer.from('\n'),
  '\r\n': Buffer.from('\r\n'),
};

/** Bytes drawn for a temp file's name — four give the eight hex characters of the contract. */
const TEMPORARY_NAME_BYTES = 4;

/** What the writer needs of the file it is replacing, and how it asks whether it still may. */
type PatchTarget = {
  realPath: string;
  /**
   * The original file's permission bits, which the temp file is created with EXACTLY — a `chmod`
   * in the adapter takes them past the process umask, so a save cannot silently strip the group or
   * world access a shared file had.
   */
  mode: number;
  baseRev: string;
  currentRev: () => Promise<string>;
};

type PatchDependencies = {
  fileSystem: FileTreeFileSystem;
  lineIndex: FileLineIndex;
};

/** Appends `bytes` at `position` and answers the position after them, whatever the kernel writes. */
async function writeBytesAt(handle: OpenedFile, position: number, bytes: Buffer): Promise<number> {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    written += result.bytesWritten;
  }
  return position + bytes.length;
}

/**
 * Copies the byte range `[from, to]` — inclusive, as `createReadStream` reads it — of `sourcePath`
 * into the open handle.
 *
 * THE rule of this module: every byte the user did not edit travels to the new file as bytes.
 * A latin-1 byte or a CRLF outside the edited range is copied exactly as it was found, because
 * nothing here decodes anything.
 */
async function copyByteRange(
  fileSystem: FileTreeFileSystem,
  handle: OpenedFile,
  position: number,
  sourcePath: string,
  from: number,
  to: number,
): Promise<number> {
  let cursor = position;
  for await (const chunk of fileSystem.createReadStream(sourcePath, { start: from, end: to })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    cursor = await writeBytesAt(handle, cursor, buffer);
  }
  return cursor;
}

/** Removes a temp file, best effort: the caller is already reporting the failure that got here. */
async function discardTemporaryFile(fileSystem: FileTreeFileSystem, temporaryPath: string): Promise<void> {
  try {
    await fileSystem.unlink(temporaryPath);
  } catch {
    // Nothing useful is left to say — the file is gone already, or cannot be removed at all.
  }
}

function assertPatchIsWellFormed(patch: FileLinePatch): void {
  const lines = patch.lines;
  if (!Number.isInteger(patch.startLine) || patch.startLine < 1
    || !Number.isInteger(patch.deleteCount) || patch.deleteCount < 0
    || !Array.isArray(lines)
    || lines.some((line) => typeof line !== 'string' || line.includes('\n') || line.includes('\r'))) {
    throw createInvalidEditError();
  }
}

/**
 * What the finished file keeps of its original end, and whether the last replacement carries a
 * terminator — the edges where a line model and a byte model disagree.
 *
 * `unterminated` is the file ending without a newline. `appends` says the patch adds lines past
 * the last one, so the line it will follow has to be terminated first. `reachesEnd` says the patch
 * touches that last line at all — by replacing it or by appending after it — which is what decides
 * whether the replacement's final terminator is owed.
 */
function readEndRules(
  shape: FileLineShape,
  patch: FileLinePatch,
): { appends: boolean; reachesEnd: boolean; unterminated: boolean } {
  const appends = patch.startLine === shape.totalLines + 1;
  const replacesLastLine = patch.deleteCount > 0 && patch.startLine + patch.deleteCount - 1 === shape.totalLines;
  return {
    appends,
    reachesEnd: appends || replacesLastLine,
    unterminated: shape.size > 0 && !shape.endsWithNewline,
  };
}

/**
 * Applies one contiguous line-range replacement to a text file, as a temp file and a rename.
 *
 * The original is never opened for writing: the bytes before and after the edited range are
 * copied as byte ranges, the replacement lines are written between them, and the temp file takes
 * the original's place only after a second look at the revision. So a reader still holding the
 * old revision reads a whole file for the whole operation — the rename is what makes a save
 * atomic — and a file that moved under us leaves the original exactly as it was.
 *
 * The rules, in the order they bite:
 *
 * 1. A `baseRev` that is not the file's revision is a 409, before anything is read.
 * 2. The patch's own shape is validated (400).
 * 3. Its range is measured against the file's line count (422).
 * 4. The byte offsets of both ends come from the line index, so `startLine + deleteCount` past
 *    the last line is the end of the file rather than a guess.
 * 5. The temp file is created next to the real target with the original's mode and the `wx` flag,
 *    so a temp file that somehow exists is never clobbered.
 * 6. Copy `[0, before)`.
 * 7. An append to a file that does not end in a newline writes that newline first, or the
 *    appended line would be glued onto the last one.
 * 8. Write each replacement line and a terminator — except the last one, when the patch reaches
 *    an end of file that had no terminator, which keeps ending without one.
 * 9. Copy `[after, size)`.
 * 10. Sync, close, check the revision again, and only then rename. A moved revision unlinks the
 *     temp and is a 409; every other failure unlinks the temp and rethrows, so a failed save
 *     leaves no debris and no half-written original.
 *
 * A symlink inside the project edits its target and stays a link, because the real path is the
 * one opened and renamed. A hard link is broken by the rename: the other name keeps the old
 * content. That is accepted and documented rather than worked around.
 *
 * Answers with the shape of the revision it replaced, so a caller can state the new line count as
 * arithmetic on it rather than reading back in full the file this save just wrote.
 */
export async function writeLinePatch(
  dependencies: PatchDependencies,
  target: PatchTarget,
  patch: FileLinePatch,
): Promise<FileLineShape> {
  if (await target.currentRev() !== target.baseRev) {
    throw createStaleRevisionError();
  }

  assertPatchIsWellFormed(patch);

  const shape = await dependencies.lineIndex.fileShape(target.realPath, target.baseRev);
  if (patch.startLine > shape.totalLines + 1
    || patch.startLine + patch.deleteCount - 1 > shape.totalLines) {
    throw new AppError('The edit reaches past the end of the file', { statusCode: 422, code: 'PATCH_PAST_END' });
  }

  const before = await dependencies.lineIndex.lineOffset(target.realPath, target.baseRev, patch.startLine);
  const after = await dependencies.lineIndex.lineOffset(
    target.realPath,
    target.baseRev,
    patch.startLine + patch.deleteCount,
  );
  if (before === null || after === null) {
    // The range check above rules this out; a null here means the shape and the offsets disagree.
    throw new AppError('The edit reaches past the end of the file', { statusCode: 422, code: 'PATCH_PAST_END' });
  }

  const end = readEndRules(shape, patch);
  const temporaryPath = path.join(
    path.dirname(target.realPath),
    `.${path.basename(target.realPath)}.cloudcli-${randomBytes(TEMPORARY_NAME_BYTES).toString('hex')}.tmp`,
  );

  let handle: OpenedFile;
  try {
    handle = await dependencies.fileSystem.openExclusive(temporaryPath, target.mode);
  } catch (error) {
    throw mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
  }

  try {
    let position = 0;
    if (before > 0) {
      position = await copyByteRange(dependencies.fileSystem, handle, position, target.realPath, 0, before - 1);
    }
    if (end.appends && end.unterminated) {
      position = await writeBytesAt(handle, position, EOL_BYTES[shape.eol]);
    }
    for (let index = 0; index < patch.lines.length; index += 1) {
      position = await writeBytesAt(handle, position, Buffer.from(patch.lines[index], 'utf8'));
      // The one line written without a terminator: the last one, when the file it lands in did
      // not end with one either.
      if (!(end.reachesEnd && end.unterminated && index === patch.lines.length - 1)) {
        position = await writeBytesAt(handle, position, EOL_BYTES[shape.eol]);
      }
    }
    if (after < shape.size) {
      await copyByteRange(dependencies.fileSystem, handle, position, target.realPath, after, shape.size - 1);
    }

    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // The write is already failing; a handle that will not close is not the news.
    }
    await discardTemporaryFile(dependencies.fileSystem, temporaryPath);
    throw mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
  }

  try {
    await handle.close();
  } catch (error) {
    // Rule 10 has no exception: a close that fails after a good `sync` still leaves the temp file
    // behind if it is not unlinked here.
    await discardTemporaryFile(dependencies.fileSystem, temporaryPath);
    throw mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
  }

  if (await target.currentRev() !== target.baseRev) {
    await discardTemporaryFile(dependencies.fileSystem, temporaryPath);
    throw createStaleRevisionError();
  }

  try {
    await dependencies.fileSystem.rename(temporaryPath, target.realPath);
  } catch (error) {
    await discardTemporaryFile(dependencies.fileSystem, temporaryPath);
    throw mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
  }

  // The shape this save replaced, for the caller's answer: the new line count is arithmetic on it.
  return shape;
}
