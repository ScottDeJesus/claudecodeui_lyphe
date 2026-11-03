import { randomUUID } from 'node:crypto';

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { ClaudeImageBlock } from '@/shared/image-attachments.js';

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
 *     so a restart storm leaves one entry and gets one answer. A process that ends hands over what it had been given BEFORE
 *     its CLI has said its last word: a turn that finished as the stop landed is reported while the process winds down, and
 *     that report takes its entries out again (`answerLate`), so a turn that did complete is never said a second time.
 * Only his messages are kept across a process (`words`): an alert or a chat's news is the house's, and the house
 * tells her again what is still true. The kept list is written to the account's row after every change that alters it
 * (`write`) — the list is what the next process is handed, so a message is on disk before the CLI could lose it.
 *
 * The row is shared: a handover boot serves, and so makes its ledger, while its predecessor is still answering, so two ledgers write
 * one list, each from a copy it read earlier. Writing the whole of that copy would bring back an entry the other ledger has answered
 * and removed since, and the next boot would say it again. So a ledger remembers the uuids the row held when it last read or wrote it
 * (`lastSeen`) and, before every write and before the takeover's resend (`reconcile`), sets the row against them: an INHERITED entry
 * that was seen and is gone from the row was removed by the other process and is let go; an entry on the row that was never seen was
 * added by it and is taken in. What this ledger removed itself stays removed: the row still holds it, and it was seen.
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
 * be assembled again and kept: `body` `''` with `via` `'spoken'` is a press that carried no words, or only her name with `heard: 'name'`; `at` is when he said it) and
 * `stoppedBy` once the turn it was in was stopped (`null` before, and for a message pushed after the stop). `images` are the pictures
 * riding with `message`, as the image blocks it carries after its text: MEMORY ONLY, beside `words` and never in it, so the list written to
 * disk (`{ uuid, ...sent.words }`) holds the attachment records and never a byte; a message said again keeps them (`restate`), and one said
 * again after a restart reads them from the upload store afresh. Consumed by `companion-session.ts`.
 */
export type Sent = {
  uuid: string;
  message: SDKUserMessage;
  words: Omit<UnansweredMessage, 'uuid'> | null;
  images: ClaudeImageBlock[];
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
  /** The launch ends and the process goes with it: what is kept becomes inherited, the rest is forgotten. Answers the uuids of his messages this launch's CLI had, which is what a result that lists none would have answered. */
  handOff(): string[];
  /** A launch already handed off reported, while its process wound down, that its turn FINISHED: the inherited entries `uuids` names were answered, and are taken out. Answers how many. */
  answerLate(uuids: readonly string[]): number;
  /** Brings `inherited()` level with the row: what the other process of a handover answered since this ledger last looked is let go, and what it added is taken in. The takeover's resend calls it first. */
  reconcile(): void;
  /** A failure of hers: what was given and what was held is forgotten, so it cannot loop. */
  fail(): void;
  /** Clear: nothing is kept. */
  forgetAll(): void;
  /** The entries a previous process left, oldest first. */
  inherited(): readonly UnansweredMessage[];
};

/** The account's row as the ledger uses it: `read` the stored list (it throws when the row cannot be read), `write` replaces it. */
export type LedgerRow = { read(): UnansweredMessage[]; write(list: UnansweredMessage[]): void };

/** Consumed by `companion-session.ts`, which hands it the account's row: what the row holds at boot is what a previous process left. */
export function createLedger(userId: number, row: LedgerRow): Ledger {
  /** The row's list, or `null` when it cannot be read (logged): the conversation goes on with what the ledger holds. */
  function readRow(): UnansweredMessage[] | null {
    try {
      return row.read();
    } catch (error) {
      console.error(`[Companion] account ${userId}: the messages her last process never answered could not be read`, error);
      return null;
    }
  }

  const atBoot = readRow() ?? [];
  let inherited = [...atBoot];
  const given = new Map<string, Sent>();
  let held: Sent[] = [];
  let written = JSON.stringify(atBoot);
  // The uuids the row held when this ledger last read or wrote it: the row now, set against them, is what the other process did since (`absorb`).
  let lastSeen = new Set(atBoot.map((entry) => entry.uuid));
  // Which stop marked a message: the count of the stop. A message the CLI took before a stop and one it took before a later stop must not be mistaken for each other.
  let stops = 0;
  const markedBy = new WeakMap<Sent, number>();

  /** His messages this process's CLI was given or holds, in order, less those his own cut took out. */
  const ownKept = (): UnansweredMessage[] =>
    [...given.values(), ...held].flatMap((sent) => (sent.words !== null && sent.stoppedBy !== 'operator' ? [{ uuid: sent.uuid, ...sent.words }] : []));

  /** His messages in order: what a previous process left, then what this one holds. */
  const kept = (): UnansweredMessage[] => [...inherited, ...ownKept()];

  /**
   * Takes in what the other process did to the row since the last look. An inherited entry that was seen and is no longer on the row was answered
   * there: let go. An entry on the row that was never seen and is not one of this process's own pushes was added there: inherited, so the write that
   * follows keeps it. An inherited entry never seen (`keep` made it, and it is not written yet) stands.
   */
  function absorb(): void {
    const stored = readRow();
    if (stored === null) return;
    const onRow = new Set(stored.map((entry) => entry.uuid));
    const stillOwed = inherited.filter((entry) => onRow.has(entry.uuid) || !lastSeen.has(entry.uuid));
    const added = stored.filter((entry) => !lastSeen.has(entry.uuid) && !given.has(entry.uuid) && !held.some((sent) => sent.uuid === entry.uuid));
    inherited = [...stillOwed, ...added];
    lastSeen = onRow;
  }

  /** Writes the kept list, after the row's own changes are taken in (`absorb`), when it changed. A write that fails is logged and tried again at the next change: the conversation goes on. */
  function persist(): void {
    absorb();
    const list = kept();
    const json = JSON.stringify(list);
    if (json === written) return;
    try {
      row.write(list);
      written = json;
      lastSeen = new Set(list.map((entry) => entry.uuid));
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
      // The row is read BEFORE own entries become inherited: afterwards one missing from the row (the other process's write landed over it) could not be told from one it answered, and would be let go.
      absorb();
      const handed = ownKept();
      inherited = [...inherited, ...handed];
      given.clear();
      held = [];
      persist();
      return handed.map((entry) => entry.uuid);
    },
    answerLate(uuids) {
      const owed = inherited.length;
      inherited = inherited.filter((entry) => !uuids.includes(entry.uuid));
      // Counted before `persist`, which sets the row against the list and may take entries in or let them go.
      const answered = owed - inherited.length;
      persist();
      return answered;
    },
    reconcile: persist,
    fail() {
      given.clear();
      held = [];
      persist();
    },
    forgetAll() {
      // Whatever the row holds is seen first, so nothing the other process added is taken in. The row itself is emptied by `clearAccount`, which the service calls right after.
      absorb();
      inherited = [];
      given.clear();
      held = [];
      persist();
    },
    inherited: () => inherited,
  };
}
