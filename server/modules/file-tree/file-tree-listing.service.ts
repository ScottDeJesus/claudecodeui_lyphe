import path from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type {
  DirectoryEntry,
  DirectoryListing,
  FilePreview,
  FileTreeListingServiceDependencies,
  FileTreeListingServices,
} from '@/shared/types.js';
import { AppError, resolvePathInsideProject } from '@/shared/utils.js';

/**
 * Above this size a read is allowed to STOP once the window is full, rather than walking on to
 * count. It is not a promise that the count is unknown: a read that reaches the end of a large
 * file anyway — which every window near its end does — reports the count it just paid for.
 * `totalLines` is `null` only where the walk stopped early, and never a guess or a 0.
 */
const LARGE_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** How much of a file's head decides binary-vs-text. */
const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * The two limits that bound a preview's SIZE rather than its line count — a line is not a
 * bounded thing (one `.map` in this repository is a single 8,225,574-character line, so "at
 * most 400 lines" alone permits a 13 MB response). `truncated` is set when either bites.
 */
const MAXIMUM_PREVIEW_LINE_CHARS = 2_000;
const MAXIMUM_PREVIEW_CHARS = 256 * 1024;

/** Display language per extension. An unlisted extension yields `null`, and the header says nothing. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.json': 'JSON', '.xml': 'XML', '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'TOML',
  '.md': 'Markdown', '.mdx': 'Markdown', '.txt': 'Plain text', '.css': 'CSS', '.scss': 'Sass',
  '.html': 'HTML', '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.py': 'Python', '.rb': 'Ruby',
  '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.sql': 'SQL', '.c': 'C', '.h': 'C', '.cpp': 'C++',
};

/**
 * Turns a filesystem failure into a controlled response.
 *
 * Node's own message names the absolute path it failed on ("EACCES: permission denied, open
 * '/home/…'") and would otherwise reach the browser through the router's generic 500. Each
 * reason keeps its OWN answer: only a genuine ENOENT may claim the thing is not there, so a
 * file behind a wall is never reported as missing, and bad client input is a 400 not a 500.
 */
function readFailure(error: unknown, subject: 'file' | 'directory'): AppError {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
  if (errorCode === 'EACCES' || errorCode === 'EPERM') {
    return new AppError('Permission denied', { statusCode: 403, code: 'EACCES' });
  }
  // Client input, not a filesystem state: a NUL byte in the path, or a name past NAME_MAX.
  if (errorCode === 'ERR_INVALID_ARG_VALUE' || errorCode === 'ERR_INVALID_ARG_TYPE' || errorCode === 'ENAMETOOLONG') {
    return new AppError('The path is not valid', { statusCode: 400, code: 'INVALID_PATH' });
  }
  if (errorCode === 'ENOENT') {
    const missing = subject === 'file' ? 'File not found' : 'Directory not found';
    return new AppError(missing, { statusCode: 404, code: `${subject.toUpperCase()}_NOT_FOUND` });
  }
  return new AppError(`The ${subject} could not be read`, { statusCode: 500, code: 'READ_FAILED' });
}

/**
 * Resolves a requested path against the project root, treating an empty path (and `.` / `./`)
 * as the root itself — `resolvePathInsideProject` demands a path strictly *under* the root,
 * and the file manager must list the top level. Upload makes the same exception already.
 */
function resolveRequestedPath(projectRoot: string, requestedPath: string): string {
  return !requestedPath || requestedPath === '.' || requestedPath === './'
    ? path.resolve(projectRoot)
    : resolvePathInsideProject(projectRoot, requestedPath);
}

/** What `readTextPreview` hands back — the text arm of `FilePreview` minus its file metadata. */
type TextPreviewBody = { lines: string[]; startLine: number; totalLines: number | null; truncated: boolean };

/** Directories first, then by name — the order the listing is served in, so no client re-sorts. */
function compareDirectoryEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
  return left.name.localeCompare(right.name);
}

/**
 * True when the head of the file contains no NUL byte. The stream is destroyed as soon as
 * the verdict is in.
 *
 * This runs for EVERY non-image file, including one whose MIME type already claims text:
 * an extension is a claim, not evidence, and a UTF-16 file named `.txt` would otherwise be
 * served as mojibake carrying escaped NULs. It earns its keep in the other direction too —
 * `mime-types` maps `.ts` to `video/mp2t`, so a name-only rule would show every TypeScript
 * file in this repository as an unpreviewable binary.
 */
async function headHasNoNulByte(stream: Readable): Promise<boolean> {
  let inspectedBytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const window = buffer.subarray(0, BINARY_SNIFF_BYTES - inspectedBytes);
      if (window.includes(0)) return false;
      inspectedBytes += window.length;
      if (inspectedBytes >= BINARY_SNIFF_BYTES) break;
    }
  } finally {
    stream.destroy();
  }
  return true;
}

/**
 * Creates the File Tree directory-listing and file-preview workflows. Consumed by
 * `file-tree.module.ts`, which composes it for the two read-only routes in
 * `file-tree.routes.ts`. Every dependency is injected: no machine-wide default, and no
 * knowledge of the database or of Express.
 */
export function createFileTreeListingService(dependencies: FileTreeListingServiceDependencies): FileTreeListingServices {
  const fileSystem = dependencies.fileSystem;

  /**
   * Reads the head of a text file into lines, bounded in CHARACTERS as well as in lines.
   *
   * The stream is chunked and split here rather than read through `readline`, and that is
   * the point rather than a preference: `readline` buffers an entire line before it yields
   * one, so a file whose first line is 60 MB costs 60 MB of resident memory before any cap
   * could apply. Splitting by hand lets the carried line be clipped AS IT ARRIVES, so a
   * preview costs one chunk plus the kept budget — the same for a 2 KB source file and for
   * a 100 MB minified bundle.
   *
   * `totalLines` is a separate question, and it is answered by where the READ ended rather than
   * by how big the file is. Under the size cap the walk always runs to the end, counting newlines
   * and keeping nothing. Over it the read is allowed to stop as soon as the preview is full — but
   * a window near the end of the file never fills, so that walk reaches EOF too, and the count it
   * made on the way is reported rather than thrown away. Only a read that stopped early says it
   * does not know.
   *
   * `startLine` opens the window somewhere other than the top, which is what lets a file
   * reference carrying `:line` land on that line. Lines before it are COUNTED and thrown
   * away rather than skipped over: a line is only knowable by walking to its newline, and
   * counting them is also what keeps `totalLines` and `truncated` telling the truth about a
   * window that does not start at 1.
   */
  async function readTextPreview(
    filePath: string,
    maxLines: number,
    bytes: number,
    startLine = 1,
  ): Promise<TextPreviewBody> {
    const countEveryLine = bytes <= LARGE_TEXT_FILE_BYTES;
    // A window that CANNOT exist, answered without opening the file. A line costs at least the
    // newline that ends it, so a file of `bytes` bytes holds at most `bytes + 1` of them: past
    // that the answer is an empty window whatever the contents are. Only above the counting cap
    // is this worth asking — below it the walk is owed anyway, for `totalLines`.
    //
    // Without it an unreachable start read the whole file: the keep-budget never fills, so the
    // loop's own stop condition (`!stillCollecting() && !countEveryLine`) never fired and a
    // 9 MB file streamed end to end for a window it could never reach — 16-19 ms against the
    // 2-3 ms of a normal read, and rising with the file. The route deliberately puts no upper
    // clamp on `start`; this is the layer that can bound it, because it is the one holding the size.
    if (!countEveryLine && startLine > bytes + 1) {
      return { lines: [], startLine, totalLines: null, truncated: true };
    }

    const stream = fileSystem.createReadStream(filePath);
    const decoder = new StringDecoder('utf8');
    const lines: string[] = [];
    let carriedText = '';
    let keptChars = 0;
    let finishedLines = 0;
    let truncated = false;

    /** Keeps one finished line if there is room, and records the loss when there is not. */
    const keepLine = (line: string): void => {
      const room = Math.min(MAXIMUM_PREVIEW_LINE_CHARS, MAXIMUM_PREVIEW_CHARS - keptChars);
      const noRoom = lines.length >= maxLines || room <= 0;
      if (noRoom || line.length > room) truncated = true;
      if (!noRoom) {
        lines.push(line.slice(0, room));
        keptChars += Math.min(line.length, room);
      }
    };

    /** False once no further character can be kept — the signal to stop carrying text. */
    const stillCollecting = (): boolean => lines.length < maxLines && keptChars < MAXIMUM_PREVIEW_CHARS;

    // Did the read actually reach the end of the file? That — not the file's SIZE — is what makes
    // `finishedLines` a true count, and it is the only honest condition to report one on.
    let reachedEndOfFile = true;

    try {
      for await (const chunk of stream) {
        carriedText += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const segments = carriedText.split('\n');
        // The last segment has no newline after it yet, so it is carried, not finished.
        carriedText = segments.pop() ?? '';
        for (const segment of segments) {
          finishedLines += 1;
          // Before the window: counted, never kept. The count is what `totalLines` and
          // `truncated` are read off, so a skipped line still has to be walked past.
          if (finishedLines >= startLine) {
            keepLine(segment.endsWith('\r') ? segment.slice(0, -1) : segment);
          }
        }

        // Nothing more can be kept and nothing is being counted: stop reading. This is the ONE
        // way out of the walk short of the end, so it is the one place the count becomes unknown.
        if (!stillCollecting() && !countEveryLine) {
          reachedEndOfFile = false;
          break;
        }
        // The carry is CLIPPED, never dropped. Past the per-line cap the rest of that line
        // can never be kept — but at EOF the carry IS the file's final unterminated line,
        // and dropping it left the count one short and let `truncated` read false on a
        // file that had more.
        if (carriedText.length > MAXIMUM_PREVIEW_LINE_CHARS) {
          carriedText = carriedText.slice(0, MAXIMUM_PREVIEW_LINE_CHARS);
          truncated = true;
        }
      }

      const trailingText = carriedText + decoder.end();
      if (trailingText.length > 0) {
        finishedLines += 1;
        if (finishedLines >= startLine) {
          keepLine(trailingText);
        }
      }
    } finally {
      stream.destroy();
    }

    return {
      lines,
      startLine,
      // `null` means "this read did not walk the whole file", NOT "the file is large". Above the
      // counting cap the walk still runs to EOF whenever the keep-budget never fills — which is
      // exactly what a window near the END of a big file does — and `finishedLines` is then the
      // file's true length, already paid for. Discarding it as `null` because of the file's SIZE
      // was what left a 28 MB log unable to answer "is line 255589 past the end?", so a reference
      // one line past it marked nothing and the reader's number appeared nowhere.
      totalLines: reachedEndOfFile ? finishedLines : null,
      // Still the same claim it always made — "there is more of this file than you are
      // holding" — and a window that begins after line 1 satisfies it without a second
      // rule: every skipped line was counted into `finishedLines` and kept out of `lines`.
      truncated: truncated || finishedLines > lines.length,
    };
  }

  /** `text`, `image`, or `none` — images by MIME type, everything else by its own first bytes. */
  async function classifyFile(filePath: string): Promise<{ kind: 'text' | 'image' | 'none'; mimeType: string }> {
    const mimeType = dependencies.resolveMimeType(filePath);
    if (mimeType.startsWith('image/')) {
      return { kind: 'image', mimeType };
    }
    const isText = await headHasNoNulByte(fileSystem.createReadStream(filePath));
    return { kind: isText ? 'text' : 'none', mimeType };
  }

  return {
    async listDirectory(projectId, directoryPath) {
      const projectRoot = await dependencies.resolveProjectRoot(projectId);
      const resolvedPath = resolveRequestedPath(projectRoot, directoryPath);

      let stats;
      try {
        stats = await fileSystem.stat(resolvedPath);
      } catch (error) {
        throw readFailure(error, 'directory');
      }
      if (!stats.isDirectory()) {
        throw new AppError('Path is not a directory', { statusCode: 400, code: 'NOT_A_DIRECTORY' });
      }

      // Stat'ed one at a time as they stream in, not through a `Promise.all` over the
      // whole directory: tens of thousands of children would open that many handles at once.
      const entries: DirectoryEntry[] = [];
      try {
        for await (const entry of fileSystem.openDirectory(resolvedPath)) {
          const listedEntry: DirectoryEntry = {
            name: entry.name,
            // The entry's own kind. `openDirectory` does not follow symlinks, so a link to
            // a directory lists as a file and cannot be descended into.
            kind: entry.isDirectory() ? 'dir' : 'file',
            bytes: null,
            mtime: null,
          };

          try {
            const entryStats = await fileSystem.lstat(path.join(resolvedPath, entry.name));
            // A symlink's own size is the length of its target STRING — 7 for "realdir" —
            // which is not this entry's size in any sense a person means, so it stays null.
            if (!entryStats.isSymbolicLink()) {
              listedEntry.bytes = entryStats.size;
            }
            listedEntry.mtime = entryStats.mtime.toISOString();
          } catch {
            // A permission wall, or a name that vanished between the read and the stat.
            // The entry is still real, so it is listed with both unknowns left null.
          }

          entries.push(listedEntry);
        }
      } catch (error) {
        throw readFailure(error, 'directory');
      }

      return { path: resolvedPath, entries: entries.sort(compareDirectoryEntries) };
    },

    async previewFile(projectId, filePath, maxLines, startLine = 1) {
      const projectRoot = await dependencies.resolveProjectRoot(projectId);
      const resolvedPath = resolveRequestedPath(projectRoot, filePath);

      let stats;
      try {
        stats = await fileSystem.stat(resolvedPath);
      } catch (error) {
        throw readFailure(error, 'file');
      }
      if (stats.isDirectory()) {
        throw new AppError('Path is a directory', { statusCode: 400, code: 'NOT_A_FILE' });
      }
      // A FIFO, socket, or device node: opening a FIFO blocks until a writer appears and
      // holds a libuv threadpool thread the whole time, so one must never reach
      // `createReadStream`. `stat` followed the link, so a symlink to one lands here too.
      // Only a definite `false` refuses — see `FileTreeStats.isFile`.
      if (stats.isFile?.() === false) {
        throw new AppError('Only regular files can be previewed', { statusCode: 400, code: 'NOT_A_REGULAR_FILE' });
      }

      const bytes = stats.size;
      const mtime = stats.mtime.toISOString();

      try {
        const { kind, mimeType } = await classifyFile(resolvedPath);
        if (kind === 'image') {
          return { kind, mime: mimeType, bytes, mtime };
        }
        if (kind === 'none') {
          return { kind, bytes, mtime };
        }

        return {
          kind,
          ...(await readTextPreview(resolvedPath, maxLines, bytes, startLine)),
          bytes,
          mtime,
          language: LANGUAGE_BY_EXTENSION[path.extname(resolvedPath).toLowerCase()] ?? null,
        };
      } catch (error) {
        throw error instanceof AppError ? error : readFailure(error, 'file');
      }
    },
  };
}
