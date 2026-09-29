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
 * The lanes that use it are `dispatch-souls` (its launcher souls), `kanban-metis` (its board
 * sessions) and `dispatcher` (its plans). They differ in what they read and in what they send, and
 * in nothing below.
 *
 * A PICTURE MAY TAKE ITS TIME TO ARRIVE. Most of those lanes answer from memory, but the dispatcher's
 * whole picture is one `dispatcher status --json` — a subprocess — so its `snapshot` answers a
 * PROMISE. Such a lane is never allowed to pile readings up: a tick that arrives while the previous
 * reading is still out is SKIPPED rather than queued, because a queue of readings answers with
 * pictures the host has already moved past. What the lane serves meanwhile is the last picture that
 * LANDED, which is also what a failed reading leaves behind — a broken document keeps the tab on the
 * last good picture instead of blanking it.
 *
 * AND BEFORE THE FIRST READING LANDS THERE IS NO PICTURE AT ALL. A promise lane hands out nothing it
 * has not read: `current()` answers `null`, and a reader that needs a picture now asks for one with
 * `whenLanded`, which waits — bounded — for that first landing. There is deliberately no stand-in to
 * hand in: a made-up empty picture is indistinguishable, on the wire and in every client downstream,
 * from a real reading of an empty host.
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
};

export type PolledLane<TPicture> = {
  start(): void;
  stop(): void;
  /**
   * The last picture taken. Pictures are rebuilt whole on every tick and never mutated in place, so
   * this is safe to serialize straight into a response — and `null` until a promise-returning lane's
   * first reading lands, which is the honest answer and never a placeholder. A synchronous lane's
   * construction reading IS a picture, so a `null` there is a type's, not a fact's; a failed reading
   * is never a picture, and leaves the last good one standing.
   */
  current(): TPicture | null;
  /**
   * The picture a reader should be given, waiting out a promise-returning lane's gap: the last
   * reading that landed, or — while none has — the first one that does, within `timeoutMs`. Answers
   * `null` when that wait ends with nothing landed, which a caller answers "not read yet" to rather
   * than with a picture it does not have.
   *
   * The bound belongs to the reader, not to the lane: the lane cannot tell a request that would
   * rather wait from one that would rather be told, so it takes the wait as an argument and gives
   * the caller's own answer back when it times out.
   */
  whenLanded(timeoutMs: number): Promise<TPicture | null>;
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
   * Readers waiting for a first picture, each woken once — by a landing, or by its own bound when
   * the wait ends with nothing. Empty on every synchronous lane and on any promise lane that has
   * already landed, which is the ordinary state; it only fills during the gap a boot's first
   * subprocess read leaves open.
   */
  const waiting = new Set<(picture: TPicture) => void>();

  const wakeWaiting = (next: TPicture): void => {
    if (waiting.size === 0) return;
    // Copied and cleared before any waker runs: a woken promise resolves a microtask later, but the
    // copy is what makes this file's own state settled no matter when that microtask runs.
    const woken = [...waiting];
    waiting.clear();
    for (const wake of woken) wake(next);
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
    // The picture is the lane's from here on, and every reader waiting for a first one has it. Both
    // happen BEFORE the compare below: a picture that landed is a picture, whether or not the frame
    // carrying it makes it out to some socket.
    picture = next;
    wakeWaiting(next);
    // A landing with no interval armed seeds the picture and says nothing.
    if (timer === null) return;
    try {
      const serialized = compare(next);
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
   * its landing takes over — and until it lands the lane holds NO picture, which is what `current()`
   * answers with and what `whenLanded` waits out. There is deliberately nothing to pass in as a
   * stand-in: a caller-supplied empty picture would be served, and published by every client
   * downstream, exactly as if the host had been read and found empty.
   */
  const seedPicture = (): TPicture | null => {
    const first = dependencies.snapshot();
    if (!isThenable(first)) return first;
    inFlight = first;
    void first.then(land, fail);
    return null;
  };

  // The picture the last reading took, or `null` while a promise-returning lane's first reading is
  // still out. Seeded with a reading rather than left undefined so `current()` answers with something
  // real even if the lane is never started.
  let picture: TPicture | null = seedPicture();

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

    current(): TPicture | null {
      return picture;
    },

    whenLanded(timeoutMs: number): Promise<TPicture | null> {
      // The ordinary case answers on the spot, without a timer or a registration.
      if (picture !== null) return Promise.resolve(picture);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(wake);
          resolve(null);
        }, timeoutMs);
        const wake = (next: TPicture): void => {
          clearTimeout(timer);
          resolve(next);
        };
        waiting.add(wake);
      });
    },
  };
}
