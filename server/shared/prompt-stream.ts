/**
 * The prompt stream a long-lived Claude CLI conversation is fed through, and the idle clock that
 * closes it: the two pieces that let a message join a process already running, kept apart from any
 * one provider's internals.
 *
 * Two rules this file exists to keep:
 * - The prompt stream never ends on its own. The SDK closes the CLI's stdin the moment its input
 *   iterable is exhausted and the CLI reads that EOF as "wind down", so the queue parks between
 *   messages and ends only when `end()` is called.
 * - The idle clock measures silence since the last MESSAGE, not since the last turn ended, and it
 *   never closes a process that is busy — a turn in flight, a background task, a watcher. Busy is
 *   re-asked every minute until it clears; the process is closed only then.
 *
 * It lives in `server/shared/` rather than beside either caller because it has two, and a second
 * queue would be a second answer to the one question of when the CLI sees EOF: the Claude runtime
 * reads it through `providers/list/claude/chat-process.ts` (which re-exports it, so the runtime's
 * import never moved), and the companion module's session will hold its one streaming-input query
 * open on the same queue and the same closer without importing the Claude provider.
 *
 * consumer: server/modules/providers/list/claude/chat-process.ts (for claude-runtime.provider.js),
 * server/modules/companion/session/companion-session.ts
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Two hours of silence since the last message closes an idle process (the operator's ruling). */
export const DEFAULT_IDLE_CLOSE_MS = 2 * 60 * 60 * 1000;
const MIN_IDLE_CLOSE_MS = 5_000;
// A busy process is asked again this often, never closed on the spot.
const BUSY_RECHECK_MS = 60_000;

export type PromptQueue = {
  stream: AsyncIterable<SDKUserMessage>;
  /** Queues one message for the CLI; false once the queue has ended. */
  push(message: SDKUserMessage): boolean;
  /** Ends the stream — the only way the CLI ever sees EOF on this path. */
  end(): void;
  readonly ended: boolean;
};

/**
 * The CLI's input for the life of the process: yields what has been pushed, parks while empty,
 * and returns only after `end()`.
 */
export function createPromptQueue(initial: SDKUserMessage[]): PromptQueue {
  const pending: SDKUserMessage[] = [...initial];
  let ended = false;
  let wake: (() => void) | null = null;
  const signal = (): void => {
    const waiting = wake;
    wake = null;
    waiting?.();
  };
  const stream = (async function* () {
    for (;;) {
      while (pending.length > 0) {
        yield pending.shift() as SDKUserMessage;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
  return {
    stream,
    push(message) {
      if (ended) return false;
      pending.push(message);
      signal();
      return true;
    },
    end() {
      if (ended) return;
      ended = true;
      signal();
    },
    get ended() {
      return ended;
    }
  };
}

/**
 * The idle window for one process: a per-turn request (a probe shortening it), else the
 * `CLAUDE_CHAT_IDLE_CLOSE_MS` environment, else two hours. Anything under five seconds is not a
 * window a conversation can live in and falls back to the default.
 */
export function resolveIdleCloseMs(requested: unknown): number {
  const asked = typeof requested === 'number' ? requested : Number(process.env.CLAUDE_CHAT_IDLE_CLOSE_MS);
  if (!Number.isFinite(asked) || asked < MIN_IDLE_CLOSE_MS) return DEFAULT_IDLE_CLOSE_MS;
  // A client may shorten the window (a probe does), never lengthen it past the default.
  return Math.min(asked, DEFAULT_IDLE_CLOSE_MS);
}

export type IdleCloser = {
  /** Restarts the silence clock — called on every message, and only then. */
  touch(idleMs?: number): void;
  cancel(): void;
};

export function createIdleCloser(deps: {
  idleMs: number;
  isBusy: () => boolean;
  close: (silentForMs: number) => void;
  /** Called each time the window is reached while the process is busy and the close is deferred. */
  onBusy?: (silentForMs: number) => void;
}): IdleCloser {
  let idleMs = deps.idleMs;
  let lastMessageAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let cancelled = false;

  const arm = (delayMs: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delayMs);
    // The hold must never keep the API alive on its own.
    timer.unref();
  };
  const fire = (): void => {
    timer = null;
    if (cancelled) return;
    if (deps.isBusy()) {
      deps.onBusy?.(Date.now() - lastMessageAt);
      arm(BUSY_RECHECK_MS);
      return;
    }
    deps.close(Date.now() - lastMessageAt);
  };

  arm(idleMs);
  return {
    touch(nextIdleMs) {
      if (cancelled) return;
      if (typeof nextIdleMs === 'number') idleMs = nextIdleMs;
      lastMessageAt = Date.now();
      arm(idleMs);
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}
