/**
 * A hint frame, paced: `{ kind, at }` sent at most once per `minGapMs`, and never lost.
 *
 * `tell()` is the writer saying "something changed". When the last frame is at least the gap old the
 * frame goes at once; otherwise ONE timer is armed for the rest of the gap (none when one is already
 * armed) and the frame goes when it fires, so a burst of writes costs one frame now and one at the end
 * of the gap, and the last write of a burst is always announced. The timer is armed by a tell and fires
 * once: there is no interval here, and a quiet source costs nothing.
 *
 * The frame names nothing (MAN-453's hint rule): a client that hears it reads its own route again.
 */

export type PacedHintFrame = { kind: string; at: number };

export type PacedHintDependencies = {
  kind: string;
  minGapMs: number;
  send: (frame: PacedHintFrame) => void;
};

export type PacedHint = {
  tell(): void;
  stop(): void;
};

export function createPacedHint(dependencies: PacedHintDependencies): PacedHint {
  const { kind, minGapMs, send } = dependencies;
  // The gap is measured on the monotonic clock: a wall clock stepped back (NTP, a resume) must not
  // hold the one pending send for the length of the step. `at` stays wall time, for the reader.
  let lastSentAtMono = Number.NEGATIVE_INFINITY;
  let pending: NodeJS.Timeout | null = null;

  const sendNow = (): void => {
    lastSentAtMono = performance.now();
    send({ kind, at: Date.now() });
  };

  return {
    tell() {
      if (pending !== null) return;
      const remainingMs = lastSentAtMono + minGapMs - performance.now();
      if (remainingMs <= 0) {
        sendNow();
        return;
      }
      pending = setTimeout(() => {
        pending = null;
        sendNow();
      }, remainingMs);
      // A pending hint is no reason to keep the process alive at shutdown.
      pending.unref();
    },
    stop() {
      if (pending !== null) clearTimeout(pending);
      pending = null;
    },
  };
}
