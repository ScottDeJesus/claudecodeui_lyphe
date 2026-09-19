import { createFileLineIndex } from '@/modules/file-tree/file-line-index.js';
import { writeLinePatch } from '@/modules/file-tree/file-line-patch.js';
import {
  createStaleRevisionError,
  EDIT_PATH_FILE_SYSTEM_ERRORS,
  mapFileSystemError,
} from '@/modules/file-tree/file-tree-errors.js';
import type {
  FileEditWindow,
  FileLinePatch,
  FilePatchResult,
  FileTreeEditService,
  FileTreeFileSystem,
  FileTreeProjectGateway,
} from '@/shared/types.js';
import { AppError, resolvePathInsideProject } from '@/shared/utils.js';

/**
 * How much of a file's head decides text from binary — the same 8 KB the preview judges on, so
 * the two read paths call the same files text.
 */
const BINARY_SNIFF_BYTES = 8 * 1024;

/** A window's byte budget. It bounds the response, never the smallest window the editor may ask for. */
const MAXIMUM_WINDOW_BYTES = 1024 * 1024;

/** The longest line the editor will hold. Past it the line cannot be shown, so the read stops. */
const MAXIMUM_WINDOW_LINE_BYTES = 256 * 1024;

const CARRIAGE_RETURN = 0x0d;

/**
 * The stats a revision token is read from — the composition root's own bigint stats type, taken
 * from the capability rather than named here: only `file-tree.module.ts` knows Node's filesystem.
 */
type ExactStats = Awaited<ReturnType<FileTreeFileSystem['statExact']>>;

/** The revision token: size, nanosecond mtime and inode — a change to any of them is a change. */
function revisionOf(stats: ExactStats): string {
  return `${stats.size}:${stats.mtimeNs}:${stats.ino}`;
}

/**
 * The one line of text a raw line's bytes carry: its terminator was stripped by the scanner, and
 * one trailing CR belongs to a CRLF terminator rather than to the line.
 *
 * Decoding is FATAL: a byte sequence that is not UTF-8 is not text this editor may rewrite, so it
 * is refused (415) rather than replaced by the replacement character on the way back out.
 */
function decodeLine(decoder: { decode(input: Uint8Array): string }, bytes: Buffer): string {
  const text = bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN
    ? bytes.subarray(0, bytes.length - 1)
    : bytes;
  try {
    return decoder.decode(text);
  } catch {
    throw new AppError('This file is not UTF-8 text', { statusCode: 415, code: 'NOT_UTF8' });
  }
}

/**
 * Creates the File Tree editing workflows: windowed reads and line-range saves.
 *
 * Consumed by `file-tree-edit.routes.ts`, composed by `file-tree.module.ts`. Every filesystem
 * operation goes through the injected `FileTreeFileSystem`, and every line of a file through one
 * `FileLineIndex` — this service holds a project's path policy, its revision rule and its refusal
 * vocabulary, and it holds no file.
 */
export function createFileTreeEditService(dependencies: {
  fileSystem: FileTreeFileSystem;
  projects: FileTreeProjectGateway;
}): FileTreeEditService {
  const fileSystem = dependencies.fileSystem;
  const lineIndex = createFileLineIndex(fileSystem);
  const decoder = new TextDecoder('utf-8', { fatal: true });

  async function resolveProjectRoot(projectId: string): Promise<string> {
    const projectRoot = await dependencies.projects.getProjectPathById(projectId);
    if (!projectRoot) {
      throw new AppError('Project not found', { statusCode: 404, code: 'PROJECT_NOT_FOUND' });
    }
    return projectRoot;
  }

  /**
   * The real path a request names, with containment decided twice: once on the path as asked, and
   * once on where the symlink chain actually ends.
   *
   * The second check is the one that matters for writing. `resolvePathInsideProject` follows no
   * links (its own note), so an in-project link passes it while pointing at `/etc` — and a rename
   * through that link would write outside the project. Both checks answer the same 403.
   */
  async function resolveRealFile(projectId: string, filePath: string): Promise<string> {
    const projectRoot = await resolveProjectRoot(projectId);
    const requestedPath = resolvePathInsideProject(projectRoot, filePath);

    let realPath: string;
    try {
      realPath = await fileSystem.realpath(requestedPath);
    } catch (error) {
      mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
    }

    return resolvePathInsideProject(projectRoot, realPath);
  }

  /** `statExact`, with the two filesystem refusals the edit path names: absent, or behind a wall. */
  async function statRealFile(realPath: string): Promise<ExactStats> {
    try {
      return await fileSystem.statExact(realPath);
    } catch (error) {
      mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
    }
  }

  /** A regular file's revision, and the permission bits a save has to leave on it. */
  async function readEditableTarget(realPath: string): Promise<{ rev: string; mode: number }> {
    const stats = await statRealFile(realPath);
    if (!stats.isFile()) {
      throw new AppError('Only regular files can be edited', { statusCode: 400, code: 'NOT_A_REGULAR_FILE' });
    }
    return { rev: revisionOf(stats), mode: Number(stats.mode & 0o777n) };
  }

  /**
   * True when the head of the file carries no NUL byte.
   *
   * A file's own bytes decide text from binary here, never its name — `mime-types` maps `.ts` to
   * `video/mp2t`, so an extension is a claim rather than evidence. The stream is destroyed as soon
   * as the verdict is in, and only the head is ever read.
   */
  async function hasNoNulByte(realPath: string): Promise<boolean> {
    const stream = fileSystem.createReadStream(realPath, { start: 0, end: BINARY_SNIFF_BYTES - 1 });
    let inspectedBytes = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const window = buffer.subarray(0, BINARY_SNIFF_BYTES - inspectedBytes);
        if (window.includes(0)) return false;
        inspectedBytes += window.length;
        if (inspectedBytes >= BINARY_SNIFF_BYTES) break;
      }
    } catch (error) {
      // This is the first read of a window, so it is where a file the process may not read is met
      // — and the mode-`000` answer is the edit path's 403, not a 500 naming a server path.
      mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
    } finally {
      stream.destroy();
    }
    return true;
  }

  return {
    async readEditWindow(projectId, filePath, start, lines): Promise<FileEditWindow> {
      const realPath = await resolveRealFile(projectId, filePath);
      const target = await readEditableTarget(realPath);

      if (!await hasNoNulByte(realPath)) {
        throw new AppError('This file is not text', { statusCode: 415, code: 'NOT_TEXT' });
      }

      const read = await lineIndex.readWindow(
        realPath,
        target.rev,
        start,
        lines,
        MAXIMUM_WINDOW_BYTES,
        MAXIMUM_WINDOW_LINE_BYTES,
      );
      if (read.tooLongLine !== null) {
        throw new AppError('A line in this file is too long to edit here', {
          statusCode: 422,
          code: 'LINE_TOO_LONG',
        });
      }

      const window: FileEditWindow = {
        path: filePath,
        rev: target.rev,
        startLine: read.startLine,
        lines: read.lines.map((bytes) => decodeLine(decoder, bytes)),
        eof: read.eof,
        totalLines: read.totalLines,
        // The file's first terminator when the index knows it for this revision, otherwise the
        // first one this read crossed: either way, never a walk to the top of a large file.
        eol: read.eol ?? '\n',
      };

      // The lines are only true of the revision they were read from, so a write that landed while
      // they were being read is a 409 rather than a window the editor would save back on top of.
      if (revisionOf(await statRealFile(realPath)) !== target.rev) {
        throw createStaleRevisionError();
      }

      return window;
    },

    async patchTextFile(projectId, patch: FileLinePatch): Promise<FilePatchResult> {
      const realPath = await resolveRealFile(projectId, patch.path);
      const target = await readEditableTarget(realPath);

      // The writer answers with the shape it replaced, which it already held for its range check.
      const replacedShape = await writeLinePatch(
        { fileSystem, lineIndex },
        {
          realPath,
          mode: target.mode,
          baseRev: patch.baseRev,
          currentRev: async () => revisionOf(await statRealFile(realPath)),
        },
        patch,
      );

      // The new revision is read from the file the rename just left behind; the new line count is
      // arithmetic on the shape that was replaced, because a save that committed is never followed
      // by a second full walk of the file it just wrote.
      const rev = revisionOf(await statRealFile(realPath));
      return {
        path: patch.path,
        rev,
        totalLines: replacedShape.totalLines - patch.deleteCount + patch.lines.length,
      };
    },
  };
}
