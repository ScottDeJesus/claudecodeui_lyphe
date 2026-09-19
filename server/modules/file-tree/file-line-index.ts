import {
  EDIT_PATH_FILE_SYSTEM_ERRORS,
  mapFileSystemError,
} from '@/modules/file-tree/file-tree-errors.js';
import type { FileLineIndex, FileLineRead, FileLineShape, FileTreeFileSystem } from '@/shared/types.js';

/**
 * THE line model of the edit path.
 *
 * Lines are split on the byte `0x0A` and nothing else: a final segment with no newline is still a
 * line, `"a\n"` is one line, `"a"` is one line, and a 0-byte file has none — the same model the
 * preview serves, checked against it by `.verify/probe-files-api.py`. Everything here is BYTES: a
 * line is never decoded and never held after its caller lets it go. Text, EOL choice and UTF-8
 * validity belong to the service, the only layer that knows what the bytes mean.
 *
 * Checkpoints are what make a deep window cheap: the offset of every line numbered
 * `1 + k · CHECKPOINT_STRIDE` a scan has crossed is remembered, so a window at line 150,000 starts
 * 4,096 lines early. A scan always RESUMES from a checkpoint, never from an arbitrary offset,
 * because a checkpoint is only true when the line number it was found at is known.
 */

/** Lines between the checkpoints one scan records. */
const CHECKPOINT_STRIDE = 4096;

/** How many revisions of how many files are indexed at once. */
const MAXIMUM_CACHED_FILES = 16;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** True for the lines whose byte offset is a checkpoint — 1, 4097, 8193, … */
function isCheckpointLine(line: number): boolean {
  return (line - 1) % CHECKPOINT_STRIDE === 0;
}

/**
 * One revision of one file. The four EOF facts are `null` until a scan reaches the end, and each
 * is then trusted for the life of the entry: a revision token pins the file's contents.
 */
type LineIndexEntry = {
  checkpoints: Map<number, number>;
  totalLines: number | null;
  size: number | null;
  endsWithNewline: boolean | null;
  eol: '\n' | '\r\n' | null;
};

/** What a scan holds while it walks: which lines it keeps bytes of, and how much of one line. */
type ScanRequest = {
  /** Lines numbered below this are counted and thrown away; their bytes are never held. */
  collectFromLine: number;
  /** The most bytes one line may hold; a longer one stops the scan. `null` holds no bytes at all. */
  maxLineBytes: number | null;
};

type ScanHandlers = {
  /** One finished line, in order. `bytes` is `null` when the scan holds nothing. */
  onLine(line: number, startOffset: number, bytes: Buffer | null): 'continue' | 'stop';
  /** Every checkpoint line the scan crosses, with the offset that line starts at. */
  onCheckpoint(line: number, offset: number): void;
};

type ScanOutcome = {
  /** The first line the scan did not finish, and its byte offset — at EOF, the file's size. */
  nextLine: number;
  nextOffset: number;
  /** Lines counted from line 1: the file's line count when the scan reached the end. */
  completedLines: number;
  reachedEof: boolean;
  lineTooLong: number | null;
  /** True when the file's LAST byte is a terminator: the last line it holds is a whole one. */
  endsWithNewline: boolean;
  /** True when the scan started at byte 0, and so saw the file's first terminator — or none. */
  beganAtFileStart: boolean;
  /** The FIRST terminator of the file, which only a scan that began at byte 0 can know. */
  eol: '\n' | '\r\n' | null;
  /** The first terminator THIS scan crossed, whatever byte it began at — `null` if it crossed none. */
  readEol: '\n' | '\r\n' | null;
};
/**
 * Walks bytes from a known line at a known offset, reporting every line it crosses: the one reader
 * `readWindow`, `lineOffset` and `fileShape` are three questions asked of. It holds a line's bytes
 * only while its caller is collecting them, clipped at `maxLineBytes`, never in full.
 */
async function scanLines(
  fileSystem: FileTreeFileSystem,
  realPath: string,
  fromOffset: number,
  fromLine: number,
  request: ScanRequest,
  handlers: ScanHandlers,
): Promise<ScanOutcome> {
  const collecting = request.maxLineBytes !== null;
  // A caller that holds no bytes gets a cap it can never reach, so the comparison that stops the
  // walk is total: the `null` cap bites only through `holdsLine` below.
  const maxLineBytes = request.maxLineBytes ?? Number.MAX_SAFE_INTEGER;
  // The one rule for whose bytes the walk keeps: a caller that collects nothing, or a line below
  // the one it asked for, is reported as `null` rather than as the empty buffer it holds none of.
  const holdsLine = (lineNumber: number): boolean => collecting && lineNumber >= request.collectFromLine;
  const stream = fileSystem.createReadStream(realPath, { start: fromOffset });
  const held: Buffer[] = [];
  let heldBytes = 0;
  let pendingBytes = 0;
  let line = fromLine;
  let lineStart = fromOffset;
  let offset = fromOffset;
  let completedLines = fromLine - 1;
  let lastByte = -1;
  let eol: '\n' | '\r\n' | null = null;
  let readEol: '\n' | '\r\n' | null = null;
  // True while the last thing the walk crossed was a terminator — the file ends with one only if
  // nothing follows it, which the carried-bytes path below is the one place that can say.
  let endsWithNewline = false;
  let lineTooLong: number | null = null;
  let stopped = false;
  let reachedEof = false;

  handlers.onCheckpoint(fromLine, fromOffset);

  try {
    scan: for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      let cursor = 0;

      while (cursor < buffer.length) {
        const newlineAt = buffer.indexOf(NEWLINE, cursor);
        const segmentEnd = newlineAt === -1 ? buffer.length : newlineAt;
        const segment = buffer.subarray(cursor, segmentEnd);
        const holding = holdsLine(line);

        if (holding && segment.length > 0 && heldBytes + segment.length > maxLineBytes) {
          // Past the cap a caller could ever edit: stop holding the line, and stop walking, rather
          // than assembling a line nobody may have.
          lineTooLong = line;
          stopped = true;
          break scan;
        }
        if (holding && segment.length > 0) {
          held.push(segment);
          heldBytes += segment.length;
        }

        pendingBytes += segment.length;
        offset += segment.length;
        if (segment.length > 0) lastByte = segment[segment.length - 1];

        // The rest of this chunk is carried: the line has not ended in it, which also means the
        // file's last byte is inside this line rather than a terminator.
        if (newlineAt === -1) {
          endsWithNewline = false;
          break;
        }
        // Past the newline itself. A cursor left ON it would read an empty line for ever.
        cursor = newlineAt + 1;
        endsWithNewline = true;

        // `lastByte` is the byte before the newline, which is how a terminator says whether it is
        // CRLF. The file's FIRST one is what the cache keeps, so only a walk from byte 0 sets it;
        // any terminator this walk crossed answers what a window reading it should show.
        if (eol === null && fromOffset === 0) {
          eol = lastByte === CARRIAGE_RETURN ? '\r\n' : '\n';
        }
        if (readEol === null) {
          readEol = lastByte === CARRIAGE_RETURN ? '\r\n' : '\n';
        }

        const finishedLine = line;
        const finishedStart = lineStart;
        // `null` for a line this scan was not asked to hold: an empty buffer would be read as a
        // blank line and put into a window the caller never asked for.
        const bytes = holding ? Buffer.concat(held, heldBytes) : null;
        held.length = 0;
        heldBytes = 0;
        pendingBytes = 0;
        completedLines = finishedLine;
        offset += 1;
        lineStart = offset;
        line = finishedLine + 1;
        if (isCheckpointLine(line)) handlers.onCheckpoint(line, lineStart);
        if (handlers.onLine(finishedLine, finishedStart, bytes) === 'stop') {
          stopped = true;
          break scan;
        }
      }
    }

    if (!stopped) {
      // A final segment with no terminator is still a line, and the walked position is the size.
      if (pendingBytes > 0) {
        completedLines = line;
        handlers.onLine(line, lineStart, holdsLine(line) ? Buffer.concat(held, heldBytes) : null);
      }
      reachedEof = true;
    }
  } catch (error) {
    // A read the filesystem refused — a mode this process may not read, a file removed mid-walk —
    // leaves as the same refusal the rest of the edit path speaks, never as a 500 whose message
    // is Node's own and names a server path.
    throw mapFileSystemError(error, EDIT_PATH_FILE_SYSTEM_ERRORS);
  } finally {
    stream.destroy();
  }

  return {
    nextLine: line,
    nextOffset: reachedEof ? offset : lineStart,
    completedLines,
    reachedEof,
    lineTooLong,
    endsWithNewline,
    // Only a walk that began at byte 0 can speak for the file's FIRST terminator — and, when it
    // finds none at all, for the absence itself.
    beganAtFileStart: fromOffset === 0,
    eol,
    readEol,
  };
}

/**
 * Creates the byte-level line index of the edit path: one walker, one 16-entry cache keyed by real
 * path and revision, and the checkpoints that let a deep window start where the last one stopped.
 */
export function createFileLineIndex(fileSystem: FileTreeFileSystem): FileLineIndex {
  // Least recently used first: every hit re-inserts its key, and the oldest falls off the front.
  const cached = new Map<string, LineIndexEntry>();

  /** The entry for one revision of one file, created on first mention and made most-recent. */
  function entryFor(realPath: string, rev: string): LineIndexEntry {
    const key = `${realPath}|${rev}`;
    const existing = cached.get(key);
    if (existing) {
      cached.delete(key);
      cached.set(key, existing);
      return existing;
    }

    // Line 1 starts at byte 0 of every file, so the first checkpoint is a fact rather than a claim.
    const created: LineIndexEntry = {
      checkpoints: new Map([[1, 0]]),
      totalLines: null,
      size: null,
      endsWithNewline: null,
      eol: null,
    };
    cached.set(key, created);
    if (cached.size > MAXIMUM_CACHED_FILES) {
      const oldestKey = cached.keys().next().value;
      if (oldestKey !== undefined) cached.delete(oldestKey);
    }
    return created;
  }

  /** The greatest checkpoint at or before `line` — where a scan toward it starts. Line 1 always is one. */
  function checkpointAtOrBefore(entry: LineIndexEntry, line: number): number {
    let probe = 1 + Math.floor((line - 1) / CHECKPOINT_STRIDE) * CHECKPOINT_STRIDE;
    while (probe > 1 && !entry.checkpoints.has(probe)) {
      probe -= CHECKPOINT_STRIDE;
    }
    return probe;
  }

  /** The greatest checkpoint an entry holds — where a scan with nothing to aim at resumes. */
  function lastCheckpoint(entry: LineIndexEntry): number {
    let greatest = 1;
    for (const checkpoint of entry.checkpoints.keys()) {
      if (checkpoint > greatest) greatest = checkpoint;
    }
    return greatest;
  }

  function recordCheckpoints(entry: LineIndexEntry): (line: number, offset: number) => void {
    return (line, offset) => entry.checkpoints.set(line, offset);
  }

  /** Keeps the whole-file facts a scan that walked to the end has just established. */
  function recordEndOfFile(entry: LineIndexEntry, outcome: ScanOutcome): void {
    if (!outcome.reachedEof) return;
    entry.totalLines = outcome.completedLines;
    entry.size = outcome.nextOffset;
    entry.endsWithNewline = outcome.endsWithNewline;
    if (outcome.eol !== null) {
      entry.eol = outcome.eol;
    } else if (outcome.beganAtFileStart) {
      // A walk from byte 0 with no terminator anywhere has nothing to choose between: an empty or
      // single-line file is written with LF, and the save that follows it writes LF back.
      entry.eol ??= '\n';
    }
  }

  /** The shape, when every one of its four facts is already known — otherwise `null`. */
  function knownShape(entry: LineIndexEntry): FileLineShape | null {
    return entry.totalLines !== null && entry.size !== null
      && entry.endsWithNewline !== null && entry.eol !== null
      ? { size: entry.size, totalLines: entry.totalLines, endsWithNewline: entry.endsWithNewline, eol: entry.eol }
      : null;
  }

  return {
    /**
     * Whole lines `start` … until one of four stops: `maxLines` kept, the next line passing
     * `maxBytes`, a kept line passing `maxLineBytes`, or the end of the file. The first line is kept
     * whatever the byte budget says — a window that could return nothing would be unopenable — and
     * a `start` past the end is an empty window rather than an error.
     */
    async readWindow(realPath, rev, start, maxLines, maxBytes, maxLineBytes): Promise<FileLineRead> {
      const entry = entryFor(realPath, rev);
      const from = checkpointAtOrBefore(entry, start);
      const kept: Buffer[] = [];
      let keptBytes = 0;

      const outcome = await scanLines(
        fileSystem,
        realPath,
        entry.checkpoints.get(from) ?? 0,
        from,
        { collectFromLine: start, maxLineBytes },
        {
          onCheckpoint: recordCheckpoints(entry),
          onLine: (line, _startOffset, bytes) => {
            if (bytes === null) return 'continue';
            if (kept.length >= maxLines) return 'stop';
            if (kept.length > 0 && keptBytes + bytes.length > maxBytes) return 'stop';
            kept.push(bytes);
            keptBytes += bytes.length;
            return 'continue';
          },
        },
      );

      recordEndOfFile(entry, outcome);

      return {
        lines: kept,
        startLine: start,
        eof: outcome.reachedEof,
        totalLines: entry.totalLines,
        tooLongLine: outcome.lineTooLong,
        // The file's own first terminator when the index has it, and otherwise the first one this
        // walk crossed — a window must show the file's EOL without a walk to the top to learn it.
        eol: entry.eol ?? outcome.readEol,
      };
    },

    /** Where `line` starts, `size` for `totalLines + 1` (an append), `null` past that. */
    async lineOffset(realPath, rev, line): Promise<number | null> {
      const entry = entryFor(realPath, rev);
      const knownTotal = entry.totalLines;
      const knownSize = entry.size;
      if (knownTotal !== null && knownSize !== null) {
        if (line > knownTotal + 1) return null;
        if (line === knownTotal + 1) return knownSize;
      }

      const from = checkpointAtOrBefore(entry, line);
      if (from === line) return entry.checkpoints.get(line) ?? 0;

      const found = { offset: null as number | null };
      const outcome = await scanLines(
        fileSystem,
        realPath,
        entry.checkpoints.get(from) ?? 0,
        from,
        { collectFromLine: line, maxLineBytes: null },
        {
          onCheckpoint: recordCheckpoints(entry),
          onLine: (currentLine, startOffset) => {
            if (currentLine !== line) return 'continue';
            found.offset = startOffset;
            return 'stop';
          },
        },
      );

      if (found.offset !== null) return found.offset;
      recordEndOfFile(entry, outcome);
      const total = entry.totalLines;
      const size = entry.size;
      return total !== null && size !== null && line === total + 1 ? size : null;
    },

    /**
     * Size, line count, final terminator and EOL — one full walk of a revision. A resumed walk
     * establishes the first three, but `eol` is the file's FIRST terminator and only a walk that
     * began at byte 0 has seen it, so a missing `eol` is what sends this back to the top.
     */
    async fileShape(realPath, rev): Promise<FileLineShape> {
      const entry = entryFor(realPath, rev);
      const alreadyKnown = knownShape(entry);
      if (alreadyKnown) return alreadyKnown;

      const from = entry.eol === null ? 1 : lastCheckpoint(entry);
      const outcome = await scanLines(
        fileSystem,
        realPath,
        entry.checkpoints.get(from) ?? 0,
        from,
        { collectFromLine: 1, maxLineBytes: null },
        { onCheckpoint: recordCheckpoints(entry), onLine: () => 'continue' },
      );

      recordEndOfFile(entry, outcome);
      const shape = knownShape(entry);
      if (shape) return shape;
      throw new Error(`The line index did not reach the end of "${realPath}"`);
    },
  };
}
