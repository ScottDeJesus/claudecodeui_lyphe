import fs from 'node:fs';
import path from 'node:path';

/**
 * The byte-offset tail: files that are appended to, followed live, with no replay.
 *
 * This is the whole of the mechanics and none of the meaning — it hands over complete LINES and
 * knows nothing about what is written in them. It is separated from the transcript tap because the
 * two change for different reasons: the offsets, the hot set and the walk below would be untouched
 * by a new tool name, and the tap's mapping would be untouched by a change to how history is
 * skipped.
 *
 * Offsets are in MEMORY and never on disk, which is the point rather than an omission. The durable
 * cursors next door (`ep_cursors`) are right for a prose index and wrong for a live tap: shared with
 * them, this would replay months of history into the canvas on first paint, and two consumers
 * advancing one cursor would starve each other.
 */

/** How often the corpus is walked for files this tail has never seen. */
const DISCOVER_INTERVAL_MS = 15000;

/** How often the recently-touched files are read for appends. Fast enough to feel live. */
const POLL_INTERVAL_MS = 400;

/** How long after its last write a file stays on the hot set, stat'd on every poll tick. */
const HOT_WINDOW_MS = 120000;

/** Depth cap for the discovery walk: `<slug>/<sid>/subagents/agent-*.jsonl` is four deep. */
const MAX_WALK_DEPTH = 6;

/** Ceiling on how much of one file is read per tick, so a burst of output cannot balloon the heap. */
const MAX_READ_BYTES = 4 * 1024 * 1024;

/**
 * Every `*.jsonl` under `root`, whatever depth it sits at.
 *
 * A recursive walk rather than `fs.watch`, for the reason the house already ruled on
 * (`shared/polled-lane.service.ts:1-19`): these files are appended to, but a replaced or recreated
 * one emits no usable event, and the root gains a directory every session.
 *
 * `isFile()` and never `stat()`: a symlink named `*.jsonl` must be judged as a symlink, so a link
 * cannot pull content from outside the corpus (`scripts/episodic_extract.py:69-76`). An unreadable
 * directory is skipped — one that vanished mid-walk is not worth a line in the journal.
 */
async function walkJsonl(root: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_WALK_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkJsonl(full, depth + 1, found);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(full);
  }
}

/** The complete lines in a freshly read chunk, plus the offset that follows them. */
function completeLines(chunk: Buffer, offset: number): { lines: string[]; next: number } {
  const lastBreak = chunk.lastIndexOf(0x0a);
  // Not one newline in the chunk: the caller decides whether that is a half-flushed line or a
  // record too long to fit, because only it knows whether the chunk reached the end of the file.
  if (lastBreak === -1) return { lines: [], next: offset };
  return { lines: chunk.subarray(0, lastBreak).toString('utf8').split('\n'), next: offset + lastBreak + 1 };
}

export type TranscriptTailDependencies = {
  /** The directory walked for `*.jsonl`, at any depth below it. */
  root: string;
  /** Every complete line read, with the file it came from. Called in file order, once per line. */
  onLine: (file: string, line: string) => void;
  /** The server has no logger; a module that must say something takes a closure. */
  logError: (message: string) => void;
};

export type TranscriptTail = { start(): void; stop(): void };

/**
 * Consumed by `universe-transcript.tap.ts`, which is the only thing that reads Claude transcripts:
 * it parses the lines this hands over.
 */
export function createTranscriptTail(dependencies: TranscriptTailDependencies): TranscriptTail {
  /** Bytes consumed of each known file: the start of the first line not yet parsed. */
  const offsets = new Map<string, number>();
  /** The files worth statting — written to recently, or still growing. Everything else is not looked at. */
  const hot = new Set<string>();

  /**
   * The files whose trouble has already been reported — a read that failed, or a record too long to
   * fit the window — cleared as soon as one reads cleanly. A poll tick is 400 ms, so without this a
   * file would write 2.5 identical lines a second for as long as the condition lasted, and a
   * corpus-wide permission fault would bury the journal in one line per file per tick.
   */
  const reported = new Set<string>();

  let discoverTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let running = false;
  let seeded = false;
  let discovering = false;
  let polling = false;

  /**
   * The first byte after the next line break at or beyond `from`, or the end of the file when there
   * is none. Read forward in window-sized steps and DISCARDED: an oversized record is not carried,
   * because carrying it is the unbounded allocation the window exists to prevent.
   */
  const resync = async (handle: fs.promises.FileHandle, from: number, size: number): Promise<number> => {
    let position = from;
    while (position < size) {
      const length = Math.min(size - position, MAX_READ_BYTES);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) break;
      const lineBreak = buffer.subarray(0, bytesRead).indexOf(0x0a);
      if (lineBreak !== -1) return position + lineBreak + 1;
      position += bytesRead;
    }
    // No line break to the end of the file: the record is still being written, so the tail parks at
    // EOF and the rest of it is discarded as it lands.
    return size;
  };

  /** Reads what was appended since `offset` and returns the new offset. Never throws. */
  const readAppended = async (file: string, offset: number, size: number): Promise<number> => {
    const length = Math.min(size - offset, MAX_READ_BYTES);
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(file, 'r');
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const chunk = buffer.subarray(0, bytesRead);

      let next: number;
      /** False only when this pass had to skip a record instead of reading one. */
      let sawCompleteLine = true;
      if (chunk.lastIndexOf(0x0a) === -1 && offset + bytesRead < size) {
        // No line break in a window that did NOT reach the end of the file: one record is longer
        // than the window and no amount of waiting will complete it. A transcript line of 7.9 MB is
        // in the corpus today. Leaving the offset here would re-read and re-allocate the window
        // every 400 ms and keep the file dark forever, so the record is skipped and the tail
        // resumes at the next line.
        next = await resync(handle, offset + bytesRead, size);
        sawCompleteLine = false;
        if (!reported.has(file)) {
          reported.add(file);
          dependencies.logError(
            `[Universe] skipped an oversized transcript record in ${file}: over ${MAX_READ_BYTES} bytes with no line break`,
          );
        }
      } else {
        const complete = completeLines(chunk, offset);
        for (const line of complete.lines) {
          const body = line.trim();
          if (body !== '') dependencies.onLine(file, body);
        }
        next = complete.next;
      }

      // A window that held no newline because the file ENDS there is a half-flushed line, and it is
      // left whole for the next pass — the rule that makes a record straddling two reads parse once
      // and in full rather than twice and in halves.
      if (sawCompleteLine) reported.delete(file);
      return next;
    } catch (error) {
      if (!reported.has(file)) {
        reported.add(file);
        dependencies.logError(
          `[Universe] could not read the transcript at ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return offset;
    } finally {
      await handle?.close();
    }
  };

  /**
   * The walk for files this tail has never seen.
   *
   * A file found on the FIRST walk is seeded to its current size — the tail follows, and history is
   * not activity. A file found later starts at 0, because a transcript that was not there before is
   * new activity by definition, and skipping its opening bytes would drop the first edits of the
   * session that created it.
   */
  const discover = async (): Promise<void> => {
    if (discovering) return;
    discovering = true;
    try {
      const found: string[] = [];
      await walkJsonl(dependencies.root, 0, found);
      const now = Date.now();
      for (const file of found) {
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(file);
        } catch {
          continue;
        }
        if (!offsets.has(file)) offsets.set(file, seeded ? 0 : stat.size);
        if (now - stat.mtimeMs <= HOT_WINDOW_MS) hot.add(file);
      }
      seeded = true;
    } finally {
      discovering = false;
    }
  };

  /**
   * One pass over the hot set: stat, read the appends, and drop what has gone cold.
   *
   * Only the hot files are stat'd. The corpus is over four thousand files, and touching every one of
   * them every 400 ms is a core burnt to learn nothing, since a quiet transcript has nothing to say.
   * A file leaves the set when it has neither grown nor been written to inside the window.
   */
  const poll = async (): Promise<void> => {
    // A tick that overruns its interval must not stack on the one after it.
    if (polling) return;
    polling = true;
    try {
      const now = Date.now();
      for (const file of [...hot]) {
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(file);
        } catch {
          hot.delete(file);
          offsets.delete(file);
          continue;
        }
        const offset = offsets.get(file) ?? 0;
        if (stat.size > offset) offsets.set(file, await readAppended(file, offset, stat.size));
        else if (now - stat.mtimeMs > HOT_WINDOW_MS) hot.delete(file);
      }
    } finally {
      polling = false;
    }
  };

  /**
   * Runs one pass without letting it outlive this process. Both passes are fire-and-forget by
   * design — the timers must not stack — but an unobserved rejection is not harmless: this server
   * runs on Node, whose default is to terminate on one, and the process it would take down is the
   * one carrying every chat socket. Every path inside the passes is guarded, so this is the floor
   * under that, not a substitute for it.
   */
  const guard = (pass: Promise<void>): void => {
    pass.catch((error: unknown) => {
      dependencies.logError(
        `[Universe] the transcript tail's pass threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      // Not awaited: the first walk seeds every offset to end-of-file, and until it lands the hot
      // set is empty, so the poll has nothing to read rather than a corpus to replay.
      guard(discover());
      discoverTimer = setInterval(() => guard(discover()), DISCOVER_INTERVAL_MS);
      pollTimer = setInterval(() => guard(poll()), POLL_INTERVAL_MS);
      // Neither timer is a reason for this process to stay alive: they exist to follow files, and a
      // server that is otherwise finished has nothing left to follow.
      discoverTimer.unref();
      pollTimer.unref();
    },

    stop: () => {
      if (!running) return;
      running = false;
      if (discoverTimer !== null) {
        clearInterval(discoverTimer);
        discoverTimer = null;
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      hot.clear();
      offsets.clear();
      seeded = false;
    },
  };
}
