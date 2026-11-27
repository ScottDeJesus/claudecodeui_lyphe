import fs from 'node:fs';
import path from 'node:path';

import type { TranscriptFileEvent } from '@/modules/providers/index.js';

/**
 * The byte-offset tail: files that are appended to, followed live, with no replay.
 *
 * This is the whole of the mechanics and none of the meaning — it hands over complete LINES and
 * knows nothing about what is written in them. It is separated from the transcript tap because the
 * two change for different reasons: the offsets and the windowed read below would be untouched by a
 * new tool name, and the tap's mapping would be untouched by a change to how history is skipped.
 *
 * The tail is TOLD, never looking: the transcript feed hands it every add, change and unlink of a
 * file with the size it reached, and the tail reads from its offset to that size. It reads only what
 * the feed tells it of, so while nothing is written it does no work at all.
 *
 * Offsets are in MEMORY and never on disk, which is the point rather than an omission. The durable
 * cursors next door (`ep_cursors`) are right for a prose index and wrong for a live tap: shared with
 * them, this would replay months of history into the canvas on first paint, and two consumers
 * advancing one cursor would starve each other. A transcript older than the process starts at the
 * size the feed knew before its first change, so its history is never read.
 */

/** Ceiling on how much of one file is read per pass, so a burst of output cannot balloon the heap. */
const MAX_READ_BYTES = 4 * 1024 * 1024;

/** The complete lines in a freshly read chunk, plus the offset that follows them. */
function completeLines(chunk: Buffer, offset: number): { lines: string[]; next: number } {
  const lastBreak = chunk.lastIndexOf(0x0a);
  // Not one newline in the chunk: the caller decides whether that is a half-flushed line or a
  // record too long to fit, because only it knows whether the chunk reached the end of the file.
  if (lastBreak === -1) return { lines: [], next: offset };
  return { lines: chunk.subarray(0, lastBreak).toString('utf8').split('\n'), next: offset + lastBreak + 1 };
}

export type TranscriptTailDependencies = {
  /** The directory whose `*.jsonl` files are followed, at any depth below it. */
  root: string;
  /** The transcript feed's door: every add, change and unlink with its size. Returns the unsubscribe. */
  subscribe: (listener: (event: TranscriptFileEvent) => void) => () => void;
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

  /**
   * The files whose trouble has already been reported — a read that failed, or a record too long to
   * fit the window — cleared as soon as one reads cleanly. A live transcript is written to many times
   * a second, so without this a file would write one identical line per event for as long as the
   * condition lasted, and a corpus-wide permission fault would bury the journal.
   */
  const reported = new Set<string>();

  let running = false;
  let unsubscribe: (() => void) | null = null;

  /** The files being read right now: one read per file at a time. */
  const reading = new Set<string>();
  /** The size each running read goes on to: an event that lands mid-read raises it. */
  const targets = new Map<string, number>();
  const rootPrefix = path.resolve(dependencies.root) + path.sep;

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
        // on every event for that file and keep it dark forever, so the record is skipped and the
        // tail resumes at the next line.
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
   * Reads `file` from its offset toward `size`, window after window, unless a read of it is already
   * running — then that read is handed `size` as its new target and goes on to it before it ends. A pass
   * that leaves the offset where it was (a half-flushed line) stops: the event that completes the line
   * starts the next read.
   */
  const readTo = async (file: string, size: number): Promise<void> => {
    targets.set(file, size);
    if (reading.has(file)) return;
    reading.add(file);
    try {
      while (running) {
        const offset = offsets.get(file);
        const target = targets.get(file);
        if (offset === undefined || target === undefined || offset >= target) return;
        const next = await readAppended(file, offset, target);
        // An event that moved the offset while this pass read (an add, a shrink, an unlink) wins.
        if (offsets.get(file) !== offset) continue;
        offsets.set(file, next);
        if (next === offset && targets.get(file) === target) return;
      }
    } finally {
      reading.delete(file);
      targets.delete(file);
    }
  };

  /**
   * The feed's event, for a `*.jsonl` under root. A change to a file this tail holds no offset for starts
   * where the feed last knew the file, so a transcript older than the process is read from where its
   * new writing starts and never from 0. No stat is taken here: the event carries the size.
   */
  const onFeedEvent = (event: TranscriptFileEvent): void => {
    const file = event.filePath;
    if (!file.startsWith(rootPrefix) || !file.endsWith('.jsonl')) return;
    if (event.kind === 'unlink') {
      offsets.delete(file);
      targets.delete(file);
      return;
    }
    const known = event.kind === 'add' ? 0 : (offsets.get(file) ?? event.previousSize ?? event.size);
    offsets.set(file, Math.min(known, event.size));
    guard(readTo(file, event.size));
  };

  /**
   * Runs one read without letting it outlive this process. Reads are fire-and-forget by design — the
   * feed calls its listeners inside its own report and must not wait on a file — but an unobserved
   * rejection is not harmless: this server runs on Node, whose default is to terminate on one, and the
   * process it would take down is the one carrying every chat socket. Every path inside the read is
   * guarded, so this is the floor under that, not a substitute for it.
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
      unsubscribe = dependencies.subscribe(onFeedEvent);
    },

    stop: () => {
      if (!running) return;
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      offsets.clear();
      targets.clear();
    },
  };
}
