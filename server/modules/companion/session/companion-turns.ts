import { randomUUID } from 'node:crypto';

import type { CompanionActivity, CompanionSound, CompanionTurnOutcome } from '@/shared/companion-types.js';

import { createSentenceStream, DEFAULT_SOUND_TAGS, parseExpression } from './sentence-stream.js';

/**
 * Her turns: when one starts, which sentences are its own, and which `result` ends it.
 *
 * A turn starts when a message is pushed while she is idle (`admit`) and ends at the CLI's `result`.
 * The hard part is knowing WHICH result: a message pushed mid-turn is usually folded into that turn,
 * but one that lands just after the model finished is not — it runs as a turn of its own, and a Stop
 * is answered by a result of the stopped turn that arrives after a new turn may have begun. So every
 * message is stamped with a uuid at push time, the tracker remembers which turn each uuid was pushed
 * into, and a result lists the uuids it consumed (`user_message_uuids`):
 *   - a result that lists a uuid of the turn in flight ends it;
 *   - a result that lists only uuids of a turn already stopped is that turn's late answer: it ends
 *     nothing, and the turn in flight keeps going;
 *   - a message the ended turn did not consume starts the next turn at once, so the panel never shows
 *     her speaking outside a turn.
 * A result that lists no uuid at all (the CLI's startup failures) is read as the turn in flight's.
 *
 * Each sentence carries its turn's id and its index in the turn, counting only sentences that had
 * something to show (`parseExpression` answers null for the rest). A turn that is stopped or failed
 * drops the half-sentence it had buffered: what she had not finished saying was never said.
 *
 * Consumers: `session/companion-session.ts`, which owns one tracker per account.
 */

/**
 * One sentence of hers, parsed: the turn it belongs to, its place in that turn from 0, the leading
 * `mood` (`null` for none), the `speech` text a voice synthesizes (sounds kept as `<tag>`), the
 * `display` text the panel draws and the `sounds` as offsets into `display`. Handed to the sentence
 * callback; consumed by the companion store (which writes the log line) and the voice.
 */
export type CompanionSentence = {
  turnId: string;
  index: number;
  mood: string | null;
  speech: string;
  display: string;
  sounds: CompanionSound[];
};

/**
 * The four callbacks a turn reports through, each told exactly once per event. `onTurnStarted` and
 * `onTurnEnded` bracket a turn (`error` is the sentence for the panel when the outcome is `failed`,
 * `null` otherwise); `onActivity` gets `thinking` when the turn starts and `idle` when it ends. A
 * callback that throws is the caller's to guard — the session wraps each, so one can never break her
 * loop. Consumed by `companion-session.ts`, whose `CompanionSessionDeps` includes this type.
 */
export type TurnSink = {
  onSentence(sentence: CompanionSentence): void;
  onTurnStarted(turnId: string): void;
  onTurnEnded(turnId: string, outcome: CompanionTurnOutcome, error: string | null): void;
  onActivity(activity: CompanionActivity): void;
};

/** What `createTurnTracker` answers; the session holds one per account. */
type TurnTracker = {
  /** The id of the turn in flight; `null` while she is idle. */
  readonly turnId: string | null;
  /** A message with this uuid was pushed: it joins the turn in flight, or starts one. */
  admit(uuid: string): void;
  /** One streamed delta of her speech. */
  text(delta: string): void;
  /** A content block ended: the sentence it ended in is complete even with no whitespace after it. */
  blockEnded(): void;
  /** A `result` consumed `uuids` (empty when the CLI named none): `live` when it concerned the turn in flight, `stale` when it answered a turn already stopped. */
  result(uuids: readonly string[], failure: string | null): 'live' | 'stale';
  /** Her Stop: the turn in flight ends `stopped` and its messages stay known, so its late result is told from the next turn's. False when none was in flight. */
  stop(): boolean;
  /** `uuids` were still queued when a Stop interrupted, and will run as a turn of their own. */
  adopt(uuids: readonly string[]): void;
  /** The process is gone: the turn in flight ends with `outcome`, and every message is forgotten. */
  release(outcome: 'stopped' | 'failed', error: string | null): void;
};

/** The activity of a turn with no tool running. Consumed by `companion-account.ts`, which puts her back to it when a tool ends. */
export const THINKING_ACTIVITY: CompanionActivity = { phase: 'thinking', session: null, files: null, walk: null };
/** The activity of no turn at all: what the panel shows before her first one and after each ends. Consumed by `companion-account.ts`. */
export const IDLE_ACTIVITY: CompanionActivity = { phase: 'idle', session: null, files: null, walk: null };

type Turn = { id: string; nextIndex: number; stream: ReturnType<typeof createSentenceStream> };

/** Consumed by `companion-session.ts`: one tracker per account's conversation. */
export function createTurnTracker(sink: TurnSink): TurnTracker {
  let current: Turn | null = null;
  // Every message of ours that no result has consumed yet, with the turn it was pushed into.
  const owners = new Map<string, Turn>();

  const speak = (turn: Turn, raw: string): void => {
    const parsed = parseExpression(raw, DEFAULT_SOUND_TAGS);
    if (parsed === null) return;
    sink.onSentence({ turnId: turn.id, index: turn.nextIndex, ...parsed });
    turn.nextIndex += 1;
  };

  const begin = (): Turn => {
    const turn: Turn = { id: randomUUID(), nextIndex: 0, stream: createSentenceStream((raw) => speak(turn, raw)) };
    current = turn;
    sink.onTurnStarted(turn.id);
    sink.onActivity(THINKING_ACTIVITY);
    return turn;
  };

  const inFlight = (): boolean => current !== null;

  const end = (outcome: CompanionTurnOutcome, error: string | null): void => {
    const turn = current;
    if (turn === null) return;
    current = null;
    sink.onTurnEnded(turn.id, outcome, error);
    // A caller may answer the end by pushing, which starts the next turn inside this callback; that turn is
    // already `thinking`, and an `idle` after it would show her idle for the whole of a turn she is working.
    if (!inFlight()) sink.onActivity(IDLE_ACTIVITY);
  };

  /** Whether a result is still owed for a turn that was stopped: its trailing events must not become a turn. */
  const stoppedTurnOwesResult = (): boolean => [...owners.values()].some((turn) => turn !== current);

  return {
    get turnId() {
      return current?.id ?? null;
    },
    admit(uuid) {
      owners.set(uuid, current ?? begin());
    },
    text(delta) {
      if (current === null && stoppedTurnOwesResult()) return;
      (current ?? begin()).stream.push(delta);
    },
    blockEnded() {
      current?.stream.flush();
    },
    result(uuids, failure) {
      const answeredTurns = uuids.map((uuid) => owners.get(uuid));
      for (const uuid of uuids) owners.delete(uuid);
      const turn = current;
      if (uuids.length > 0 && (turn === null || !answeredTurns.includes(turn))) return 'stale';
      if (turn === null) return 'live';
      if (failure === null) turn.stream.flush();
      end(failure === null ? 'answered' : 'failed', failure);
      if (failure === null) {
        const unconsumed = [...owners].filter(([, owner]) => owner === turn);
        if (unconsumed.length > 0) {
          const next = begin();
          for (const [uuid] of unconsumed) owners.set(uuid, next);
        }
      }
      return 'live';
    },
    stop() {
      if (current === null) return false;
      end('stopped', null);
      return true;
    },
    adopt(uuids) {
      const queued = uuids.filter((uuid) => owners.has(uuid));
      if (queued.length === 0) return;
      const turn = current ?? begin();
      for (const uuid of queued) owners.set(uuid, turn);
    },
    release(outcome, error) {
      end(outcome, error);
      owners.clear();
    },
  };
}
