import fs from 'node:fs';

import type { LLMProvider } from '@/shared/types.js';

/**
 * The transcript feed: the one place the server hears that a provider transcript appeared, grew or went.
 *
 * The sessions watcher hands it chokidar's events. It keeps the size it last knew of every regular file
 * (in memory only, so a transcript older than the process is read from where it stood, never from 0) and
 * publishes each event with that size beside the new one. chokidar drops a change that lands within a few
 * milliseconds of the one before it, so after every add or change the feed arms that file's one settle
 * deadline and takes one more look when it fires: the last write of a burst is never lost. That one-shot
 * deadline, armed only by a file event, is the feed's only timer.
 */

export type TranscriptFileEvent = {
  provider: LLMProvider;
  kind: 'add' | 'change' | 'unlink';
  /** Absolute path. */
  filePath: string;
  /** Bytes after the event; 0 for an unlink. */
  size: number;
  /** The size the feed knew before this event; null when the file is new to it. */
  previousSize: number | null;
};

export type TranscriptFeedListener = (event: TranscriptFileEvent) => void;

export type TranscriptFeedDependencies = {
  settleMs: number;
  lstat: (filePath: string) => Promise<fs.Stats>;
  logError: (message: string) => void;
};

export type TranscriptFeed = {
  /** The watcher's first scan: records the file's size and publishes nothing. */
  seen(provider: LLMProvider, filePath: string, stats: fs.Stats | undefined): void;
  report(kind: 'add' | 'change' | 'unlink', provider: LLMProvider, filePath: string, stats?: fs.Stats): void;
  subscribe(listener: TranscriptFeedListener): () => void;
  close(): void;
};

type GrowthKind = 'add' | 'change';

const SERVER_SETTLE_MS = 250;
const MISSING_FILE_CODES = new Set(['ENOENT', 'ENOTDIR']);

export function createTranscriptFeed(dependencies: TranscriptFeedDependencies): TranscriptFeed {
  const { settleMs, lstat, logError } = dependencies;
  const ledger = new Map<string, number>();
  const deadlines = new Map<string, NodeJS.Timeout>();
  const listeners: TranscriptFeedListener[] = [];
  // Bumped by close(): an lstat begun before it must not refill the ledger it cleared.
  let generation = 0;

  function publish(event: TranscriptFileEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        logError(`[TranscriptFeed] a listener threw on ${event.kind} of ${event.filePath}: ${describeError(error)}`);
      }
    }
  }

  function publishGrowth(kind: GrowthKind, provider: LLMProvider, filePath: string, size: number): void {
    const previousSize = kind === 'add' ? null : (ledger.get(filePath) ?? null);
    ledger.set(filePath, size);
    publish({ provider, kind, filePath, size, previousSize });
    armDeadline(provider, filePath);
  }

  function forget(provider: LLMProvider, filePath: string): void {
    clearDeadline(filePath);
    const previousSize = ledger.get(filePath);
    // A path the feed never admitted was never published, so neither is its going.
    if (previousSize === undefined) {
      return;
    }
    ledger.delete(filePath);
    publish({ provider, kind: 'unlink', filePath, size: 0, previousSize });
  }

  function armDeadline(provider: LLMProvider, filePath: string): void {
    clearDeadline(filePath);
    const deadline = setTimeout(() => {
      deadlines.delete(filePath);
      settle(provider, filePath);
    }, settleMs);
    deadline.unref();
    deadlines.set(filePath, deadline);
  }

  function clearDeadline(filePath: string): void {
    const deadline = deadlines.get(filePath);
    if (deadline) {
      clearTimeout(deadline);
      deadlines.delete(filePath);
    }
  }

  // The deadline's one look: a size the ledger does not hold is the write chokidar dropped.
  function settle(provider: LLMProvider, filePath: string): void {
    whenRegularFile(filePath, (size) => {
      const knownSize = ledger.get(filePath);
      if (knownSize === undefined || size === knownSize) {
        return;
      }
      publishGrowth('change', provider, filePath, size);
    }, () => forget(provider, filePath));
  }

  // Calls admitted with the file's size only when it is a regular file; a symlink never is.
  function admit(filePath: string, stats: fs.Stats | undefined, admitted: (size: number) => void): void {
    if (!stats) {
      whenRegularFile(filePath, admitted);
      return;
    }
    if (stats.isFile()) {
      admitted(stats.size);
    }
  }

  function whenRegularFile(filePath: string, admitted: (size: number) => void, refused?: () => void): void {
    const startedIn = generation;
    lstat(filePath).then(
      (stats) => {
        if (startedIn !== generation) {
          return;
        }
        if (stats.isFile()) {
          admitted(stats.size);
        } else {
          refused?.();
        }
      },
      (error: unknown) => {
        if (!isMissingFile(error)) {
          logError(`[TranscriptFeed] lstat failed for ${filePath}: ${describeError(error)}`);
        }
      },
    );
  }

  return {
    seen(_provider, filePath, stats) {
      admit(filePath, stats, (size) => {
        ledger.set(filePath, size);
      });
    },
    report(kind, provider, filePath, stats) {
      if (kind === 'unlink') {
        forget(provider, filePath);
        return;
      }
      if (kind === 'add') {
        admit(filePath, stats, (size) => publishGrowth('add', provider, filePath, size));
        return;
      }
      // chokidar takes a change's stats with stat(), which follows a symlink even with followSymlinks off,
      // so only the feed's own lstat judges a change; a link found where a file stood is that file's going.
      whenRegularFile(filePath, (size) => publishGrowth('change', provider, filePath, size), () => forget(provider, filePath));
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    close() {
      generation += 1;
      for (const deadline of deadlines.values()) {
        clearTimeout(deadline);
      }
      deadlines.clear();
      ledger.clear();
    },
  };
}

/** The server's one feed, fed by the sessions watcher. */
export const transcriptFeed: TranscriptFeed = createTranscriptFeed({
  settleMs: SERVER_SETTLE_MS,
  lstat: (filePath) => fs.promises.lstat(filePath),
  logError: (message) => console.error(message),
});

export function subscribeTranscriptFeed(listener: TranscriptFeedListener): () => void {
  return transcriptFeed.subscribe(listener);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && MISSING_FILE_CODES.has(error.code);
}
