import { randomUUID } from 'node:crypto';

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { UnansweredMessage } from '../companion-unanswered.js';

/**
 * What her conversation owes an answer to: every message of ours that no `result` has consumed yet, kept in
 * three places by where it is.
 *   - GIVEN: the CLI has it (or its launch was handed it as the first message). A `result` that lists its uuid
 *     takes it out (`take`).
 *   - HELD: pushed while a stop was still being answered, so not yet given to the CLI (`hold`); the session
 *     gives them, in order, once the stopped turn's result is in (`release` moves them to GIVEN and hands them back).
 *   - INHERITED: his words a previous process was given and never answered. They are on disk and in no CLI; the
 *     next process pushes them again, each under a new uuid, and the new push REPLACES the entry (`give(sent, replacing)`),
 *     so a restart storm leaves one entry and gets one answer.
 * Only his messages are kept across a process (`words`): an alert or a chat's news is the house's, and the house
 * tells her again what is still true. The kept list is written to the account's row after every change that alters it
 * (`write`) — the list is what the next process is handed, so a message is on disk before the CLI could lose it.
 *
 * A stop marks the messages the CLI already had (`stoppedBy`): they are the turn that was stopped, whose result will list them.
 * His own cut or Stop takes them out of the kept list at once — he did not want that answer — while the server's stop keeps
 * them, because a handover is not his word. The mark is a guess until the aborted result is in: that result lists what the
 * aborted request took, so a message the same stop marked and the result did NOT list was never part of it (`strandedBy`), and
 * the CLI runs it as a turn of its own.
 *
 * Consumers: `session/companion-session.ts`, which owns one ledger per account's conversation.
 */

/** Who stopped a turn: the operator (his cut, or his Stop) or the server (a handover or shutdown). Consumed by `companion-session.ts` and `companion-session-types.ts`. */
export type StopSource = 'operator' | 'server';

/**
 * One message of ours, as assembled and pushed (`message`, whose id is `uuid`), with his raw `words` when it is his (so it can
 * be assembled again and kept: `body` `''` with `via` `'spoken'` is a press that carried no words, `at` is when he said it) and
 * `stoppedBy` once the turn it was in was stopped (`null` before, and for a message pushed after the stop). Consumed by
 * `companion-session.ts`.
 */
export type Sent = {
  uuid: string;
  message: SDKUserMessage;
  words: Omit<UnansweredMessage, 'uuid'> | null;
  stoppedBy: StopSource | null;
};

/** What `createLedger` answers; the session holds one per account. */
type Ledger = {
  /** Records `sent` as given to the CLI; `replacing` is the inherited entry it now stands for. */
  give(sent: Sent, replacing?: UnansweredMessage): void;
  /** His new words that no launch can carry yet (a wake waiting for a handover): kept as an inherited entry, which the push that says them later replaces (`give`'s `replacing`). Answers the entry. */
  keep(words: Omit<UnansweredMessage, 'uuid'>): UnansweredMessage;
  /** Records `sent` as withheld until the stopped turn's result is in; `replacing` as for `give`. */
  hold(sent: Sent, replacing?: UnansweredMessage): void;
  /** The held messages, in order, now recorded as given: the caller pushes them to the CLI. */
  release(): Sent[];
  /** The messages a `result` listed, out of the ledger: answered, or the aborted request's. */
  take(uuids: readonly string[]): Sent[];
  /** The turn being stopped is every message the CLI has: they are marked, and his own Stop takes them off the kept list. */
  markStopped(by: StopSource): void;
  /** `uuids` were still queued behind the stopped turn and will run: they are not part of it. */
  unmarkStopped(uuids: readonly string[]): void;
  /** After a stop's aborted result listed `listed`: the uuids of messages that SAME stop marked and the result did not list. The aborted request never took them. */
  strandedBy(listed: readonly Sent[]): string[];
  /** How many messages are marked and still owed a result. */
  stoppedCount(): number;
  /** Everything a replacement launch must be handed, in order: what was given (but not what his Stop cut), then what was held. */
  carry(): Sent[];
  /** The launch ends and the process goes with it: what is kept becomes inherited, the rest is forgotten. */
  handOff(): void;
  /** A failure of hers: what was given and what was held is forgotten, so it cannot loop. */
  fail(): void;
  /** Clear: nothing is kept. */
  forgetAll(): void;
  /** The entries a previous process left, oldest first. */
  inherited(): readonly UnansweredMessage[];
};

/** Consumed by `companion-session.ts`. `initial` is what the account's row held at boot; `write` stores the kept list. */
export function createLedger(userId: number, initial: readonly UnansweredMessage[], write: (list: UnansweredMessage[]) => void): Ledger {
  let inherited = [...initial];
  const given = new Map<string, Sent>();
  let held: Sent[] = [];
  let written = JSON.stringify(initial);
  // Which stop marked a message: the count of the stop. A message the CLI took before a stop and one it took before a later stop must not be mistaken for each other.
  let stops = 0;
  const markedBy = new WeakMap<Sent, number>();

  /** His messages in order, less those his own cut took out. */
  const kept = (): UnansweredMessage[] => [
    ...inherited,
    ...[...given.values(), ...held].flatMap((sent) => (sent.words !== null && sent.stoppedBy !== 'operator' ? [{ uuid: sent.uuid, ...sent.words }] : [])),
  ];

  /** Writes the kept list when it changed. A write that fails is logged and tried again at the next change: the conversation goes on. */
  function persist(): void {
    const list = kept();
    const json = JSON.stringify(list);
    if (json === written) return;
    try {
      write(list);
      written = json;
    } catch (error) {
      console.error(`[Companion] account ${userId}: her unanswered messages could not be stored`, error);
    }
  }

  const replaced = (replacing: UnansweredMessage | undefined): void => {
    if (replacing !== undefined) inherited = inherited.filter((entry) => entry !== replacing);
  };

  return {
    give(sent, replacing) {
      given.set(sent.uuid, sent);
      replaced(replacing);
      persist();
    },
    keep(words) {
      const entry = { uuid: randomUUID(), ...words };
      inherited = [...inherited, entry];
      persist();
      return entry;
    },
    hold(sent, replacing) {
      held.push(sent);
      replaced(replacing);
      persist();
    },
    release() {
      const batch = held;
      held = [];
      for (const sent of batch) given.set(sent.uuid, sent);
      return batch;
    },
    take(uuids) {
      const taken: Sent[] = [];
      for (const uuid of uuids) {
        const sent = given.get(uuid);
        if (sent === undefined) continue;
        given.delete(uuid);
        taken.push(sent);
      }
      persist();
      return taken;
    },
    markStopped(by) {
      stops += 1;
      for (const sent of given.values()) {
        if (sent.stoppedBy !== null) continue;
        sent.stoppedBy = by;
        markedBy.set(sent, stops);
      }
      persist();
    },
    unmarkStopped(uuids) {
      for (const uuid of uuids) {
        const sent = given.get(uuid);
        if (sent === undefined) continue;
        sent.stoppedBy = null;
        markedBy.delete(sent);
      }
      persist();
    },
    strandedBy(listed) {
      const stopsListed = new Set(listed.flatMap((sent) => markedBy.get(sent) ?? []));
      return [...given.values()].filter((sent) => stopsListed.has(markedBy.get(sent) ?? -1)).map((sent) => sent.uuid);
    },
    stoppedCount: () => [...given.values()].filter((sent) => sent.stoppedBy !== null).length,
    carry() {
      const carried = [...[...given.values()].filter((sent) => sent.stoppedBy !== 'operator'), ...held];
      given.clear();
      held = [];
      // The replacement answers these as ordinary messages: whatever stop marked them belonged to the launch that is gone.
      for (const sent of carried) {
        sent.stoppedBy = null;
        markedBy.delete(sent);
        given.set(sent.uuid, sent);
      }
      persist();
      return carried;
    },
    handOff() {
      inherited = kept();
      given.clear();
      held = [];
      persist();
    },
    fail() {
      given.clear();
      held = [];
      persist();
    },
    forgetAll() {
      inherited = [];
      given.clear();
      held = [];
      persist();
    },
    inherited: () => inherited,
  };
}
