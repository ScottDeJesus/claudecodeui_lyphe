import type { HeldSession } from './companion-session-types.js';

/**
 * The wait a refused resume makes for its handover. Writing one takes seconds (the summarizer reads her thread), during which no
 * launch exists: a message that would wake her must not open a launch that starts without the handover, and must not be lost. So while
 * a handover is written every wake is PARKED here, in the order it came, and runs once the write is over — settled, given up or
 * timed out, the session decides which in `settle` — by which time the held conversation is forgotten, so the parked wake plans a fresh
 * launch like any other and its first message carries the handover.
 *
 * The gate only ever holds while no launch is live (the session asks only then), so nothing here can reorder a running conversation. His
 * parked words are on disk before they park (the session keeps them in the ledger), so a server that ends meanwhile loses none of them.
 *
 * Consumers: `session/companion-session.ts`, one gate per account's conversation.
 */

/** What the gate answers; the session holds one. */
type HandoverGate = {
  /** Asked by a wake: is a handover being written? When none is yet and the held conversation is about to be refused with a thread to hand over, this call starts the write. */
  holding(): boolean;
  /** Runs `action` once the write is over, after every action parked before it. Called only when `holding()` answered true. */
  park(action: () => void): void;
  /** Clear or a shutdown: the write is stopped, its answer is dropped, nothing parked runs. His parked words stay in the ledger for the next process. Answers whether a write was under way. */
  abandon(): boolean;
};

/**
 * `refused()` is the held conversation the next launch will refuse when a thread of it exists to hand over, else `null`; `settle` writes
 * the handover and carries out the refusal (store the text, forget the conversation, say it on the panel), never rejecting, and returns
 * early when its signal aborts; `onStart` and `onEnd` tell the session the wake is under way and that nothing is left parked. Consumed by
 * `companion-session.ts`.
 */
export function createHandoverGate(
  userId: number,
  hooks: {
    refused(): HeldSession | null;
    settle(held: HeldSession, signal: AbortSignal): Promise<void>;
    onStart(): void;
    onEnd(): void;
  }
): HandoverGate {
  let writing: AbortController | null = null;
  let parked: Array<() => void> = [];
  // The conversation a write was begun for: if its refusal could not be carried out (the store failed), the same one is not written for again and again.
  let attempted: string | null = null;

  function runParked(): void {
    const waiting = parked;
    parked = [];
    for (const action of waiting) {
      try {
        action();
      } catch (error) {
        console.error(`[Companion] account ${userId}: a wake that waited for her handover failed`, error);
      }
    }
    hooks.onEnd();
  }

  function begin(held: HeldSession): void {
    const mine = new AbortController();
    writing = mine;
    attempted = held.id;
    hooks.onStart();
    hooks
      .settle(held, mine.signal)
      .catch((error: unknown) => {
        console.error(`[Companion] account ${userId}: the handover of session ${held.id} ended in an error`, error);
      })
      .then(() => {
        // Abandoned meanwhile: whoever abandoned it owns what follows.
        if (writing !== mine) return;
        writing = null;
        runParked();
      });
  }

  return {
    holding() {
      if (writing === null) {
        const held = hooks.refused();
        if (held !== null && held.id !== attempted) begin(held);
      }
      return writing !== null;
    },
    park(action) {
      parked.push(action);
    },
    abandon() {
      const wasWriting = writing !== null;
      writing?.abort();
      writing = null;
      parked = [];
      attempted = null;
      return wasWriting;
    },
  };
}
