/**
 * The durable record of the asks already pushed — ONE JSON OBJECT, `{ [promptKey]: raisedAtMs }`, in a
 * row the composition root names (`dispatcher-prompts.module.ts` keeps it in `app_config`). Why it is
 * durable and why a name in it means "do not push again" is the asks service's head
 * (`dispatcher-asks.service.ts`, "ONE PUSH PER ASK, NOT PER PROCESS"); this file is only the record.
 *
 * EVERY CALL READS THE ROW FRESH AND WRITES IT WHOLE. The dev server's handover runs two processes over
 * one database for a moment, and a copy held in memory would write the other's names away. The row is a
 * handful of names (the asks open right now), so the read costs nothing next to the two-second poll that
 * drives it.
 *
 * IT NEVER THROWS. A row that cannot be read or parsed is an empty record — the old behaviour, one push
 * more and never one less — and a write that fails is one journal line (the name is then simply not
 * remembered, and the next process pushes the ask once more).
 */

/** How long a name outlives its ask when nothing retracted it — a process that died before it could (`prune`). Seven days: far past any ask's life, short enough that the record stays a handful of names. */
const KEEP_UNRETRACTED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The record of the asks already pushed, by the ask's name (`keyOf`), durable across restarts. Taken by
 * `dispatcher-asks.service.ts` as an argument (`DispatcherAsksDependencies.raisedMemory`), so that file
 * writes no database. NEVER THROWS: a record that cannot be read answers "not held" — one push more,
 * never a lost one.
 */
export type AskRaisedMemory = {
  /** Whether a process already pushed the ask this name stands for. */
  has: (promptKey: string) => boolean;
  /** Records that the ask was pushed at `at` (epoch ms). */
  add: (promptKey: string, at: number) => void;
  /** Drops the name — the ask is over (it left the picture, or its answer was taken) or its answer was refused, so its next raise is a new state. Never while a carry is out. */
  forget: (promptKey: string) => void;
  /** Drops every name older than the keep time that is not in `keep` (the open asks of the picture): the asks that left while no process held them. */
  prune: (keep: ReadonlySet<string>, now: number) => void;
};

/** The row the record lives in, as the composition root hands it over — this file names no database. */
type RaisedAsksStorage = {
  /** The row's text, or `null` when there is none (or it could not be read). */
  read: () => string | null;
  /** Replaces the row's text. May throw; the record journals it. */
  write: (raw: string) => void;
  /** Injected by the composition root — this server has no logger. */
  log: (message: string) => void;
};

// Used by `dispatcher-prompts.module.ts`, which hands it the `app_config` row and passes the record to the asks book as `raisedMemory`.
export function createRaisedAsksMemory(storage: RaisedAsksStorage): AskRaisedMemory {
  const readMarks = (): Map<string, number> => {
    const raw = storage.read();
    if (raw === null) return new Map();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      storage.log(`[Dispatcher] the record of asks already pushed is not JSON (${error instanceof Error ? error.message : String(error)}) — read as empty`);
      return new Map();
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map();
    const marks = new Map<string, number>();
    for (const [promptKey, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) marks.set(promptKey, at);
    }
    return marks;
  };

  const writeMarks = (marks: ReadonlyMap<string, number>): void => {
    try {
      storage.write(JSON.stringify(Object.fromEntries(marks)));
    } catch (error) {
      storage.log(`[Dispatcher] could not record the asks already pushed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    has: (promptKey) => readMarks().has(promptKey),
    add: (promptKey, at) => {
      const marks = readMarks();
      marks.set(promptKey, at);
      writeMarks(marks);
    },
    forget: (promptKey) => {
      const marks = readMarks();
      if (marks.delete(promptKey)) writeMarks(marks);
    },
    prune: (keep, now) => {
      const marks = readMarks();
      let dropped = false;
      for (const [promptKey, at] of marks) {
        if (!keep.has(promptKey) && now - at > KEEP_UNRETRACTED_MS) dropped = marks.delete(promptKey) || dropped;
      }
      if (dropped) writeMarks(marks);
    },
  };
}
