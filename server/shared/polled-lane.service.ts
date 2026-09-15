/**
 * The poll-and-broadcast mechanism every state lane on this server shares: read a picture off
 * disk, put a frame on the wire when — and only when — that picture changed.
 *
 * A POLL, deliberately, and not `fs.watch`. Three of the four things a lane like this must notice
 * emit no usable watch event: a state file is often REPLACED through a scratch file plus
 * `os.replace`, so a change arrives as a rename on a path that keeps being recreated; a brand-new
 * run or launch directory can appear at any moment under a root that would need its own recursive
 * watch; and a run going stale is a LAPSED heartbeat — the absence of a write, which no filesystem
 * event can ever report. Two seconds of stats over a few dozen small files is the cheaper honesty.
 *
 * The frame is sent only when the picture actually changed, so a quiet host puts nothing on the
 * wire. What "changed" means is the lane's own serialization of its picture — for both of this
 * server's lanes, the whole array — which catches an entry appearing, an entry ending and a
 * heartbeat going stale with the same comparison.
 *
 * The two lanes that use it are `plan-runner` (its runs) and `dispatch-souls` (its launcher
 * souls). They differ in what they read and in what they send, and in nothing below.
 */

export type PolledLaneDependencies<TPicture, TFrame> = {
  /** The whole picture as of now. Called on every tick; it is expected to be cheap and to never throw. */
  snapshot: () => TPicture;
  /** Wraps one picture as the frame to send. Called only when the picture changed. */
  frame: (picture: TPicture) => TFrame;
  /** Puts one frame on every open chat socket. Called only when the picture changed. */
  broadcast: (frame: TFrame) => void;
  /** How often to look, in milliseconds. */
  pollMs: number;
  /**
   * Injected by the composition root — this server has no logger, and a module that must say
   * something takes a closure rather than reaching for one (`system.module.ts:57-58`).
   */
  logError: (message: string) => void;
};

export type PolledLane<TPicture> = {
  start(): void;
  stop(): void;
  current(): TPicture;
};

export function createPolledLane<TPicture, TFrame>(
  dependencies: PolledLaneDependencies<TPicture, TFrame>,
): PolledLane<TPicture> {
  let timer: NodeJS.Timeout | null = null;
  // The picture the last tick took. Seeded with a reading rather than left undefined so `current()`
  // answers with something real even if the lane is never started.
  let picture: TPicture = dependencies.snapshot();

  /**
   * The last picture that was BROADCAST, serialized. Comparing the string rather than the value is
   * what makes "changed" mean "any field of anything in it moved", which is what a client needs,
   * and it is the same test that catches an entry appearing, an entry ending and a heartbeat going
   * stale.
   *
   * `null` means nothing has been announced on this lane yet, so the first tick always speaks —
   * including the empty picture, which is a fact a client needs and not a non-event.
   */
  let lastBroadcast: string | null = null;

  /**
   * Messages already reported. A tick failing usually keeps failing every two seconds, and a
   * broken state directory would otherwise write thousands of identical lines into the journal and
   * bury everything else in it.
   *
   * The composition root's own door dedups too, and this is deliberately not folded into it: the
   * lane's contract is "once per distinct message" whatever closure it is handed, and a probe that
   * injects a bare `console.error` must get that behaviour without knowing to ask.
   */
  const reported = new Set<string>();

  const tick = (): void => {
    try {
      const next = dependencies.snapshot();
      const serialized = JSON.stringify(next);
      picture = next;
      if (serialized === lastBroadcast) return;
      // Recorded AFTER the send returns, never before. `lastBroadcast` is a claim that this picture
      // went out, so a `broadcast` that throws part-way must leave it at the last picture that
      // actually did — otherwise the next tick, finding nothing changed, short-circuits above and
      // the frame is suppressed for as long as the picture holds still. The dedup in the catch
      // below would silence the second report of it too, so the lane would go quiet with one line
      // in the journal to explain it.
      //
      // The cost of the honest order is a re-send to whichever clients the failed sweep did reach.
      // That is free: the frame is the whole picture, so receiving it twice is receiving it once.
      dependencies.broadcast(dependencies.frame(next));
      lastBroadcast = serialized;
    } catch (error) {
      // A tick NEVER takes the interval down with it: a half-replaced file or a directory that
      // vanished mid-read is a normal event on a live state dir, and a lane that died on the first
      // one would leave its tab frozen on an old picture with nothing saying so.
      const message = error instanceof Error ? error.message : String(error);
      if (reported.has(message)) return;
      reported.add(message);
      dependencies.logError(`snapshot tick failed: ${message}`);
    }
  };

  return {
    start(): void {
      if (timer !== null) return; // idempotent: a second start would double every frame
      // One reading immediately, so the first GET after boot answers with the real picture rather
      // than an empty list for the length of one interval.
      tick();
      timer = setInterval(tick, dependencies.pollMs);
      // The poll is never a reason for the process to stay alive at shutdown.
      timer.unref();
    },

    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      // A restarted lane announces the truth again: the sockets listening then are not the ones
      // that heard the last frame.
      lastBroadcast = null;
    },

    /**
     * The last picture taken. Pictures are rebuilt whole on every tick and never mutated in place,
     * so this is safe to serialize straight into a response.
     */
    current(): TPicture {
      return picture;
    },
  };
}
