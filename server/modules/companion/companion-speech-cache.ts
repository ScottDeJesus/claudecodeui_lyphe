import type { AppError } from '@/shared/utils.js';

/**
 * One account's speech cache: the PCM of each sentence of her CURRENT turn, kept so a page that asks again (a reconnect
 * mid-turn, a second request for the sentence being spoken) is served with no second Gemini call.
 *
 * `Map<turnId, Map<index, SpeechEntry>>`, with three bounds:
 *   - at most `SPEECH_CACHE_MAX_BYTES` (4 MB, about 87 s of audio) per account: past it the oldest FINISHED sentence goes
 *     first; a sentence still being synthesized is never dropped for room, because someone is listening to it;
 *   - the AUDIO is freed when the next turn starts (`startTurn`) and when `SPEECH_CACHE_TTL_MS` (ten minutes) have passed
 *     since a sentence was last added: one timer, set when a sentence is added and cancelled when the audio is freed, so it
 *     is an expiry and not a poll. The expiry frees audio and nothing else: the turn stays hers, so a sentence asked for
 *     after a long gap inside one running turn is synthesized again;
 *   - freed by `end` when the account is cleared or the server stops, which also retires the turn.
 * The CURRENT turn is the one `startTurn` named last (until `end`); a sentence of any other turn is not speakable, which is
 * how a turn "already cleared" reads as unknown and how a page cannot spend on a turn that is over.
 *
 * A sentence still being synthesized when its audio is freed is not stopped: it finishes for the page that holds it. It
 * is kept as an ORPHAN (outside `turns`, so no new request finds it) for as long as it runs, so that a cut naming its turn
 * and `end` still reach it and stop the spend.
 *
 * An entry is a sentence's life: `pcm` is the audio so far, `done` is true once no more will come (finished, failed or
 * aborted), and `abort` stops the synthesis underneath. `opened` settles when the first audio arrives (`null`) or when the
 * sentence could not be spoken (the `AppError` the door answers). Requests FOLLOW an entry (`follow`): each one reads what has
 * arrived and then waits, on a wake and never a poll, for the rest. The synthesis stops when its LAST follower is gone,
 * so a closed page costs nothing more; an entry that stopped before its end leaves the cache, because replaying half a
 * sentence would be worse than asking again.
 *
 * Consumers: `companion-speech.ts` (fills and follows entries), `companion-account.ts` (one cache per account; tells it
 * when a turn starts) and `companion.service.ts` (ends it on Clear and on shutdown).
 */

/** The most audio one account's cache holds, in bytes. */
const SPEECH_CACHE_MAX_BYTES = 4 * 1024 * 1024;

/** How long after a sentence was last added the whole cache is freed, in ms. */
const SPEECH_CACHE_TTL_MS = 10 * 60_000;

/** One sentence's audio and life; see the file header. Consumed by `companion-speech.ts`. */
export type SpeechEntry = {
  pcm: Buffer[];
  done: boolean;
  abort: AbortController;
  /** Bytes in `pcm`, so the bound is counted without walking the chunks. */
  bytes: number;
  /** Requests reading this entry; the synthesis is aborted when the last one leaves before it finished. */
  followers: number;
  /** `null` once the first audio has arrived; the refusal or failure the door answers when the sentence could not be spoken. */
  opened: Promise<AppError | null>;
  /** Wakes of the requests waiting for more audio; each is called once and removed. */
  wakes: Set<() => void>;
};

/** What `createSpeechCache` answers; the account holds one. Consumed by `companion-speech.ts`, `companion-account.ts` and `companion.service.ts`. */
export type SpeechCache = {
  /** A new turn began: the audio of the old one is forgotten, and `turnId` is now the only speakable turn. A sentence still being sent to a page finishes for that page, and a cut naming the old turn or `end` still stops it. */
  startTurn(turnId: string): void;
  /** Whether `turnId` is the turn whose sentences may be spoken. */
  isCurrent(turnId: string): boolean;
  find(turnId: string, index: number): SpeechEntry | undefined;
  /** Adds an entry for a sentence about to be synthesized and starts the cache's ten-minute expiry. */
  put(turnId: string, index: number, entry: SpeechEntry): void;
  /** Takes `entry` out of the cache if it is still the one held for that sentence (a newer one may have replaced it). */
  remove(turnId: string, index: number, entry: SpeechEntry): void;
  /** Keeps the cache within its byte bound, dropping the oldest finished sentences first. Called after each chunk lands. */
  trim(): void;
  /** The cut: stops every synthesis of `turnId` still in flight, those of a superseded turn included, so nothing more is spent; finished sentences stay. Answers how many it stopped. */
  abortTurn(turnId: string): number;
  /** Stops every synthesis, orphans included, and forgets everything, the current turn too: Clear, and the server stopping. */
  end(): void;
  /** True the first time it is asked for `turnId`: the turn's one "I could not speak" line is written then and not again. */
  claimRefusalLine(turnId: string): boolean;
};

/** A new entry, empty and not yet opened. `opened` is given by the caller once the synthesis is started. */
export function createSpeechEntry(opened: (entry: SpeechEntry) => Promise<AppError | null>): SpeechEntry {
  const entry: SpeechEntry = { pcm: [], done: false, abort: new AbortController(), bytes: 0, followers: 0, opened: Promise.resolve(null), wakes: new Set() };
  entry.opened = opened(entry);
  return entry;
}

function wake(entry: SpeechEntry): void {
  const pending = [...entry.wakes];
  entry.wakes.clear();
  for (const resume of pending) resume();
}

/** Adds one piece of audio to `entry` and wakes whoever is waiting for it. Consumed by `companion-speech.ts`. */
export function appendAudio(entry: SpeechEntry, piece: Buffer): void {
  entry.pcm.push(piece);
  entry.bytes += piece.length;
  wake(entry);
}

/** No more audio will come for `entry`, whatever the reason; everyone waiting for it is woken to end. Consumed by `companion-speech.ts`. */
export function finishEntry(entry: SpeechEntry): void {
  entry.done = true;
  wake(entry);
}

/** Resolves on the next wake of `entry`, or when `signal` aborts: whoever waits checks both after. */
function nextWake(entry: SpeechEntry, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const resume = (): void => {
      entry.wakes.delete(resume);
      signal.removeEventListener('abort', resume);
      resolve();
    };
    entry.wakes.add(resume);
    signal.addEventListener('abort', resume, { once: true });
  });
}

/**
 * Joins a request to `entry`. Answers the function that leaves it again, once: called when the request is over for any
 * reason, and aborts the synthesis when it was the last request and the sentence had not finished. Consumed by `companion-speech.ts`.
 */
export function joinEntry(entry: SpeechEntry, signal: AbortSignal): () => void {
  entry.followers += 1;
  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    signal.removeEventListener('abort', leave);
    entry.followers -= 1;
    if (entry.followers === 0 && !entry.done) entry.abort.abort();
  };
  // A request that goes away before it ever reads (a page that hung up while the first audio was awaited) is gone all the same.
  if (signal.aborted) leave();
  else signal.addEventListener('abort', leave, { once: true });
  return leave;
}

/**
 * The audio of `entry` from its start: what has arrived, then each piece as it arrives, until the sentence is done or
 * `signal` aborts. The audio is complete when it ends with the entry done and not aborted; one that stopped early simply ends
 * (the door's response ends where the audio stopped). Consumed by `companion-speech.ts`.
 */
export async function* followEntry(entry: SpeechEntry, signal: AbortSignal, leave: () => void): AsyncGenerator<Buffer> {
  try {
    let next = 0;
    for (;;) {
      while (next < entry.pcm.length) yield entry.pcm[next++];
      if (entry.done || signal.aborted) return;
      await nextWake(entry, signal);
    }
  } finally {
    leave();
  }
}

/** Consumed by `companion-account.ts`: one cache per account, made with the account and ended with it. */
export function createSpeechCache(): SpeechCache {
  const turns = new Map<string, Map<number, SpeechEntry>>();
  let current: string | null = null;
  let refusalLineTurn: string | null = null;
  let expiry: NodeJS.Timeout | null = null;
  // Syntheses still running whose turn's audio was freed (entry → the turn it was for). Finished ones are dropped whenever the cache is touched.
  const orphans = new Map<SpeechEntry, string>();

  function dropFinishedOrphans(): void {
    for (const entry of orphans.keys()) {
      if (entry.done) orphans.delete(entry);
    }
  }

  function stopTimer(): void {
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
  }

  /** Frees the audio: every entry leaves `turns`, and the current turn stays. A synthesis in flight is not aborted: its requests still hold it, it becomes an orphan, and it stops when the last leaves (or on a cut or `end`). */
  function freeAudio(): void {
    dropFinishedOrphans();
    for (const [turnId, entries] of turns) {
      for (const entry of entries.values()) {
        if (!entry.done) orphans.set(entry, turnId);
      }
    }
    turns.clear();
    stopTimer();
  }

  function abortUnfinished(entries: Iterable<SpeechEntry>): void {
    for (const entry of entries) {
      if (!entry.done) entry.abort.abort();
    }
  }

  return {
    startTurn(turnId) {
      freeAudio();
      current = turnId;
    },
    isCurrent: (turnId) => current === turnId,
    find: (turnId, index) => turns.get(turnId)?.get(index),
    put(turnId, index, entry) {
      dropFinishedOrphans();
      const entries = turns.get(turnId) ?? new Map<number, SpeechEntry>();
      entries.set(index, entry);
      turns.set(turnId, entries);
      // Ten minutes from the LAST sentence added: a long turn is not freed under the page that is still listening to it.
      stopTimer();
      expiry = setTimeout(freeAudio, SPEECH_CACHE_TTL_MS);
      expiry.unref();
    },
    remove(turnId, index, entry) {
      const entries = turns.get(turnId);
      if (entries?.get(index) !== entry) return;
      entries.delete(index);
      if (entries.size === 0) turns.delete(turnId);
    },
    trim() {
      let total = 0;
      for (const entries of turns.values()) for (const entry of entries.values()) total += entry.bytes;
      for (const [turnId, entries] of turns) {
        for (const [index, entry] of entries) {
          if (total <= SPEECH_CACHE_MAX_BYTES) return;
          if (!entry.done) continue;
          total -= entry.bytes;
          entries.delete(index);
        }
        if (entries.size === 0) turns.delete(turnId);
      }
    },
    abortTurn(turnId) {
      let stopped = 0;
      const entries = turns.get(turnId);
      for (const [index, entry] of entries ?? []) {
        if (entry.done) continue;
        entry.abort.abort();
        entries?.delete(index);
        stopped += 1;
      }
      if (entries?.size === 0) turns.delete(turnId);
      for (const [entry, owner] of orphans) {
        if (owner !== turnId || entry.done) continue;
        entry.abort.abort();
        orphans.delete(entry);
        stopped += 1;
      }
      return stopped;
    },
    end() {
      for (const entries of turns.values()) abortUnfinished(entries.values());
      abortUnfinished(orphans.keys());
      turns.clear();
      orphans.clear();
      current = null;
      stopTimer();
    },
    claimRefusalLine(turnId) {
      if (refusalLineTurn === turnId) return false;
      refusalLineTurn = turnId;
      return true;
    },
  };
}
