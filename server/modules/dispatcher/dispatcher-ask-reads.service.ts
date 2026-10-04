import type { DispatcherStateEvent } from '@/shared/types.js';

/**
 * Used by `dispatcher-asks.service.ts`: one fresh store read for an answer or a tap, coalesced, and the
 * memo of keys a read found closed.
 */

export type AskReadsDependencies = {
  /** One fresh read of the store's plans; THROWS when the dispatcher did not answer. */
  read: () => Promise<Pick<DispatcherStateEvent, 'plans' | 'generated_at'>>;
  /** The book's own `observe`, run on each picture a read brings. */
  observe: (picture: Pick<DispatcherStateEvent, 'plans' | 'generated_at'>) => void;
  log: (message: string) => void;
};

/**
 * How long a key the store was READ and did not carry stays known as closed, so a replayed token or a
 * repeated click is answered without another read of a megabyte document. Short, because it is a memo
 * of a fact the store may change (an ask a designer left open comes back — `raise` forgets the memo of
 * the key it puts up); and never written from a failed read, which says nothing about the ask.
 */
const CLOSED_MEMO_MS = 5_000;

/**
 * The read behind an answer or a tap this book does not hold the ask for. Used by
 * `dispatcher-asks.service.ts`, which hands it the store read, its own `observe`, and the journal.
 */
export function createAskReads(dependencies: AskReadsDependencies): {
  catchUp(undone: string): Promise<boolean>;
  knownClosed(key: string): boolean;
  rememberClosed(key: string): void;
  /** `raise` forgets the memo of a key it puts up. */
  forget(key: string): void;
} {
  /** Keys the store was read and did not carry, and when — see `CLOSED_MEMO_MS`. */
  const closed = new Map<string, number>();
  /** The store read now out for an answer or a tap, and the ONE read queued behind it (`freshRead`). */
  let reading: Promise<Error | null> | null = null;
  let readingNext: Promise<Error | null> | null = null;

  /** One read of the store, brought into the book. Resolves the error when the dispatcher did not answer, `null` when it did. */
  const readNow = (): Promise<Error | null> => {
    const run = (async (): Promise<Error | null> => {
      try {
        dependencies.observe(await dependencies.read());
        return null;
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    })().finally(() => { reading = null; });
    reading = run;
    return run;
  };

  /**
   * A read that began AFTER the caller did. One already out may have begun before the caller's ask was
   * recorded and cannot answer for it, so a caller that finds one out waits for the read behind it — and
   * every caller arriving meanwhile shares that ONE, so a burst of taps costs two reads, not one each.
   */
  const freshRead = (): Promise<Error | null> => {
    if (reading === null) return readNow();
    readingNext ??= reading.then(() => {
      readingNext = null;
      return readNow();
    });
    return readingNext;
  };

  /**
   * Reads the store now and brings the book into line with it — `observe` on a fresh picture, for a
   * caller (an answer, a tap) that cannot wait for the poll's next one. Answers whether the dispatcher
   * did; when it did not, the journal says what was left undone, and the prompt comes back on the next
   * picture that reads.
   */
  const catchUp = async (undone: string): Promise<boolean> => {
    const failure = await freshRead();
    if (failure === null) return true;
    dependencies.log(`[Dispatcher] ${undone}: the store could not be read (${failure.message})`);
    return false;
  };

  /** Whether a key the store was read and did not carry is still inside its memo — a replay needs no read. */
  const knownClosed = (key: string): boolean => {
    const at = closed.get(key);
    if (at === undefined) return false;
    if (Date.now() - at < CLOSED_MEMO_MS) return true;
    closed.delete(key);
    return false;
  };

  /** Notes a key a successful read did not carry, forgetting the memos that have run out while it is at it. */
  const rememberClosed = (key: string): void => {
    const now = Date.now();
    for (const [known, at] of closed) {
      if (now - at >= CLOSED_MEMO_MS) closed.delete(known);
    }
    closed.set(key, now);
  };

  const forget = (key: string): void => {
    closed.delete(key);
  };

  return { catchUp, knownClosed, rememberClosed, forget };
}
