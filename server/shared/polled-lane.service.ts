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
 * wire. What "changed" means is the lane's own serialization of its picture — for most of this
 * server's lanes, the whole array — which catches an entry appearing, an entry ending and a
 * heartbeat going stale with the same comparison.
 *
 * The lanes that use it are `plan-runner` (its runs, and the arc deck beside them), `dispatch-souls`
 * (its launcher souls), `kanban-metis` (its board sessions) and `dispatcher` (its plans). They
 * differ in what they read and in what they send, and in nothing below.
 *
 * A PICTURE MAY TAKE ITS TIME TO ARRIVE. Most of those lanes answer from memory, but the dispatcher's
 * whole picture is one `dispatcher status --json` — a subprocess — so its `snapshot` answers a
 * PROMISE. Such a lane is never allowed to pile readings up: a tick that arrives while the previous
 * reading is still out is SKIPPED rather than queued, because a queue of readings answers with
 * pictures the host has already moved past. What the lane serves meanwhile is the last picture that
 * LANDED, which is also what a failed reading leaves behind — a broken document keeps the tab on the
 * last good picture instead of blanking it.
 */

export type PolledLaneDependencies<TPicture, TFrame> = {
  /**
   * The whole picture as of now. Called on every tick; it is expected to be cheap and to never
   * throw — and it may answer a PROMISE, for a lane whose reading is not from memory (see the note
   * above). A promise that rejects is treated exactly as a throw is: reported once, and the last
   * picture kept.
   */
  snapshot: () => TPicture | Promise<TPicture>;
  /** Wraps one picture as the frame to send. Called only when the picture changed. */
  frame: (picture: TPicture) => TFrame;
  /**
   * How this lane turns a picture into the string it compares for change — the one question "did
   * anything move?" is answered with. The default is the whole picture, `JSON.stringify`ed, which is
   * right for every lane whose reading is pure data.
   *
   * A lane whose picture carries a CLOCK RE-DERIVED ON EVERY READ has to state its own, or its
   * picture differs from itself between two ticks and the lane speaks on every one of them. The
   * dispatcher's is the one that does: `report.py::snapshot` stamps `generated_at` from the
   * dispatcher's own clock at second resolution, on a poll of two seconds, so its lane drops that key
   * here (`dispatcher-watcher.service.ts`).
   *
   * What is compared is not what is sent. `frame` is what goes on the wire and it carries the clock
   * whole, so a lane's own serialization changes WHEN the lane speaks and never WHAT it says.
   */
  serialize?: (picture: TPicture) => string;
  /** Puts one frame on every open chat socket. Called only when the picture changed. */
  broadcast: (frame: TFrame) => void;
  /** How often to look, in milliseconds. */
  pollMs: number;
  /**
   * Injected by the composition root — this server has no logger, and a module that must say
   * something takes a closure rather than reaching for one (`system.module.ts:57-58`).
   */
  logError: (message: string) => void;
  /**
   * The picture `current()` answers with until the first reading of a PROMISE-returning snapshot
   * lands. A synchronous snapshot makes it redundant — the construction reading is the seed — and
   * a lane that answers promises WITHOUT one is refused at construction rather than left serving an
   * `undefined` its type says cannot happen.
   */
  initial?: TPicture;
};

export type PolledLane<TPicture> = {
  start(): void;
  stop(): void;
  /**
   * The last picture taken. Pictures are rebuilt whole on every tick and never mutated in place, so
   * this is safe to serialize straight into a response. For a promise-returning lane it is `initial`
   * until the first reading lands, and the last one that landed after that — a failed reading is
   * never a picture.
   */
  current(): TPicture;
};

/** Whether a reading is still on its way — a promise, by the only test that matters: it has a `then`. */
function isThenable<TPicture>(value: TPicture | Promise<TPicture>): value is Promise<TPicture> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<TPicture>).then === 'function';
}

export function createPolledLane<TPicture, TFrame>(
  dependencies: PolledLaneDependencies<TPicture, TFrame>,
): PolledLane<TPicture> {
  let timer: NodeJS.Timeout | null = null;

  /**
   * The reading started by the construction seed, while it is still out. `null` means nothing is in
   * flight — the state a tick must find before it may start a reading of its own. This is the whole
   * of "no overlap": a reading runs to its end whatever the interval does in between.
   */
  let inFlight: Promise<TPicture> | null = null;

  /**
   * The comparison this lane makes: one picture as the string that decides whether the frame goes
   * out. `serialize` on the dependencies is where a lane replaces it, and where the one lane that
   * does says why.
   */
  const compare = dependencies.serialize ?? ((picture: TPicture): string => JSON.stringify(picture));

  /**
   * The last picture that was BROADCAST, as `compare` writes it. Comparing the string rather than the
   * value is what makes "changed" mean "any field of anything in it moved", which is what a client
   * needs, and it is the same test that catches an entry appearing, an entry ending and a heartbeat
   * going stale.
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

  /** One failure, said once per distinct message. The message is the reading's own: never invented here. */
  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (reported.has(message)) return;
    reported.add(message);
    dependencies.logError(`snapshot tick failed: ${message}`);
  };

  /**
   * A reading came back, and its picture is the lane's.
   *
   * The picture is kept whether or not anybody is listening — a lane that was never started, or one
   * that was stopped while its reading was out, still answers `current()` with the last reading it
   * took, exactly as the synchronous seed does. The FRAME goes out only while the lane runs.
   *
   * `inFlight` is cleared FIRST, and before anything that can throw: it is the one piece of this
   * lane's state that must never be left set, or a `broadcast` that threw would wedge every later
   * tick behind a reading that already finished and report it a second time.
   */
  const land = (next: TPicture): void => {
    inFlight = null;
    if (timer === null) {
      picture = next;
      return;
    }
    try {
      const serialized = compare(next);
      picture = next;
      if (serialized === lastBroadcast) return;
      // Recorded AFTER the send returns, never before. `lastBroadcast` is a claim that this picture
      // went out, so a `broadcast` that throws part-way must leave it at the last picture that
      // actually did — otherwise the next tick, finding nothing changed, short-circuits above and
      // the frame is suppressed for as long as the picture holds still.
      //
      // The cost of the honest order is a re-send to whichever clients the failed sweep did reach.
      // That is free: the frame is the whole picture, so receiving it twice is receiving it once.
      dependencies.broadcast(dependencies.frame(next));
      lastBroadcast = serialized;
    } catch (error) {
      // A landing NEVER takes the interval down with it: a half-replaced file or a directory that
      // vanished mid-read is a normal event on a live state dir, and a lane that died on the first
      // one would leave its tab frozen on an old picture with nothing saying so.
      report(error);
    }
  };

  /** A reading did not come back. The lane is free again, and the picture it serves is unchanged. */
  const fail = (error: unknown): void => {
    inFlight = null;
    report(error);
  };

  /**
   * The construction reading: the seed.
   *
   * A synchronous snapshot answers a value here and the lane starts with a real picture without ever
   * being started. A promise cannot be awaited in a constructor, so the reading is left IN FLIGHT and
   * its landing takes over — and until it lands, the lane holds the `initial` picture its caller
   * passed. That parameter is not optional for such a lane: the alternative is a `current()` that
   * answers `undefined` while its type promises a picture, which is the one failure this whole file
   * exists to avoid.
   */
  const seedPicture = (): TPicture => {
    const first = dependencies.snapshot();
    if (!isThenable(first)) return first;
    if (dependencies.initial === undefined) {
      throw new Error(
        'a lane whose snapshot answers a promise must be given an `initial` picture: it is what `current()` answers until the first reading lands',
      );
    }
    inFlight = first;
    void first.then(land, fail);
    return dependencies.initial;
  };

  // The picture the last reading took. Seeded with a reading rather than left undefined so
  // `current()` answers with something real even if the lane is never started — and, for a
  // promise-returning lane, seeded with `initial` until that reading lands.
  let picture: TPicture = seedPicture();

  const tick = (): void => {
    // A reading still out is the whole of "no overlap": this tick is skipped, never queued.
    if (inFlight !== null) return;
    let next: TPicture | Promise<TPicture>;
    try {
      next = dependencies.snapshot();
    } catch (error) {
      fail(error);
      return;
    }
    if (isThenable(next)) {
      const reading = Promise.resolve(next);
      inFlight = reading;
      // `land` and `fail` both clear `inFlight` first and neither throws by contract — the same
      // contract the interval callback relies on below — so this promise cannot reject unhandled.
      void reading.then(land, fail);
      return;
    }
    land(next);
  };

  return {
    start(): void {
      if (timer !== null) return; // idempotent: a second start would double every frame
      // The interval is armed BEFORE the first reading, because `land` puts a frame on the wire only
      // while the lane runs: a reading that landed during a tick with no timer set would seed the
      // picture and hold the frame back for a whole interval.
      timer = setInterval(tick, dependencies.pollMs);
      // The poll is never a reason for the process to stay alive at shutdown.
      timer.unref();
      // One reading immediately, so the first GET after boot answers with the real picture rather
      // than an empty list for the length of one interval.
      tick();
    },

    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      // A restarted lane announces the truth again: the sockets listening then are not the ones
      // that heard the last frame.
      lastBroadcast = null;
    },

    current(): TPicture {
      return picture;
    },
  };
}
