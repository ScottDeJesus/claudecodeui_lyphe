import { companionDb } from '@/modules/database/index.js';
import type { CompanionLogRow, CompanionNoteRow, CompanionStateRow } from '@/modules/database/index.js';
import { sendToUser } from '@/modules/websocket/index.js';
import type {
  CompanionDraft,
  CompanionDraftTarget,
  CompanionFrame,
  CompanionLogEntry,
  CompanionNote,
  CompanionNoteKind,
  CompanionNoteRef,
  CompanionPendingAction,
  CompanionSessionRef,
  CompanionSound,
  CompanionWalk,
} from '@/shared/companion-types.js';
import { isList, isRecord, isText, isWholeFrom } from '@/shared/document-fields.js';

import { isStoredPending, withoutPin } from './companion-pending.js';
import type { CompanionStoredPending } from './companion-pending.js';
import { isUnansweredList, type UnansweredMessage } from './companion-unanswered.js';

/**
 * Her record of one account — state, log and notes — over `companionDb`, which speaks in rows.
 * This file maps a row to the wire contract (`CompanionSessionRef`, `CompanionDraft`,
 * `CompanionPendingAction`, `CompanionWalk`, `CompanionLogEntry`, `CompanionNote`) and back, and does the one thing a bare
 * repository cannot: every write goes to THIS account's pages as the matching `companion_*` frame,
 * through `sendToUser`, and to no other account's (the floor's, `companion_floor`, included). The page folds frames into its picture, so a
 * write that sent none would leave it stale.
 *
 * The store is made for one account and closes over its id, so a call cannot reach another
 * account's rows or pages. The write comes first and the frame second, in the same tick: a failed
 * write sends nothing, and two writes reach a page in the order they were made. The frames of
 * things that are not rows (a turn, her activity, her process, the settings, the open order,
 * the clear) go through `emit`.
 *
 * THE PENDING ACTION is held here WITH its pin (`CompanionStoredPending`, `companion-pending.ts`): what the prepare pinned is
 * the server's alone, so `setPending` writes the whole of it to `pending_json` and sends the action WITHOUT the pin, and the
 * picture is built the same way. Her record of actions (`companion_actions`) is a fact about the house and is not this store's
 * to wipe: Clear ends a standing action's row `cancelled` (in the repository's own transaction; a row a take is carrying out is left for the take) and never deletes it.
 *
 * A JSON column that does not read as its shape (a hand edit, a later build's shape) is dropped
 * with a warning that names the account and column, never thrown: the picture must still load.
 *
 * Consumer: `companion.service.ts`, which makes one store per account and serves the conversation's
 * callbacks and her tools from it: the picture, the verbs behind the routes, the alert and focus feeds.
 */

/**
 * What `readState` answers: every column of the account's state row as the contract's shapes, `null`
 * for a column that holds nothing. `pending` is the stored action WITH its pin (a value that does not
 * read as one is none): server-only, so anything that reaches a page goes through `withoutPin`.
 * Consumed by `companion.service.ts` (the picture, the resume id, `<state>`).
 */
export type CompanionStoredState = {
  providerSessionId: string | null;
  /** The fingerprint of her tools and prompt when `providerSessionId` began (`session/companion-shape.ts`); `null` for none, and for a conversation begun before it was kept. */
  sessionShape: string | null;
  focus: CompanionSessionRef | null;
  draft: CompanionDraft | null;
  pending: CompanionStoredPending | null;
  walk: CompanionWalk | null;
  floor: string | null;
};

/** A draft as a caller hands it over: the store stamps `updatedAt`. Consumed by `companion.service.ts`, which writes the draft for the routes and her tools. */
export type CompanionDraftInput = Omit<CompanionDraft, 'updatedAt'>;

/** A walkthrough as a caller hands it over: the store stamps `updatedAt`. Consumed by `companion-walk.ts`, which moves the held walk for his press. */
export type CompanionWalkInput = Omit<CompanionWalk, 'updatedAt'>;

/**
 * A log line as a caller hands it over: `id` and `at` are the store's; what a line does not have is
 * left out. Consumed by `companion.service.ts`, which writes his typed lines, her sentences and system
 * lines (through the conversation's callbacks) and the alerts the feed hands it.
 */
export type CompanionLogLineInput = {
  role: CompanionLogEntry['role'];
  text: string;
  via?: CompanionLogEntry['via'];
  turnId?: string | null;
  index?: number | null;
  mood?: string | null;
  sounds?: CompanionSound[];
};

/**
 * The frames that carry no row of the store's: she tells these, the store only delivers them.
 * Consumed by `companion.service.ts`, which builds them from the conversation's turn, activity and process callbacks.
 */
export type CompanionEmittedFrame = Extract<
  CompanionFrame,
  {
    kind:
      | 'companion_turn'
      | 'companion_activity'
      | 'companion_process'
      | 'companion_settings'
      | 'companion_open'
      | 'companion_cleared';
  }
>;

/**
 * One account's store, with the frame each write sends noted on its verb. Consumed by
 * `companion.service.ts` (the registry makes one per account).
 */
export type CompanionStore = {
  readState(): CompanionStoredState;
  /** Her CLI conversation with the shape of her tools and prompt it began with, written together (`null`, `null` after Clear). No frame: a page has no use for it. */
  setProviderSession(providerSessionId: string | null, sessionShape: string | null): void;
  /** The handover her last refused resume left for her first message after the fresh start (`session/companion-handover.ts`), or `null` for none. No frame. */
  readHandover(): string | null;
  /** Stores the handover, or `null` to empty it (the launch that was handed the message that carried it is up, Clear). Kept on the row so a crash, or a launch that fails before `init`, does not lose it. No frame. */
  setHandover(handover: string | null): void;
  /** His messages no turn of hers has answered yet, oldest first (an empty column, or one that is not that shape, is none). */
  readUnanswered(): UnansweredMessage[];
  /** Replaces the list (`[]` stores none). No frame: it is the next process's, not a page's. */
  setUnanswered(unanswered: readonly UnansweredMessage[]): void;
  /** The client id holding the floor. `companion_floor` for a client id, on every write (a page learns the rest with the picture); a cleared floor (`null`) sends nothing. */
  setFloor(floor: string | null): void;
  /** `companion_focus`. */
  setFocus(focus: CompanionSessionRef | null): void;
  /** `companion_draft`, with the stored draft (stamped now) or `null`. Answers what was stored. */
  setDraft(draft: CompanionDraftInput | null): CompanionDraft | null;
  /** `companion_pending`, with the action WITHOUT its pin, or `null`. Writes `pending_json` with the pin. Answers what was sent. Her record of actions (`companion_actions`) is the caller's. */
  setPending(next: CompanionStoredPending | null): CompanionPendingAction | null;
  /** `companion_walk`, with the stored walk (stamped now) or `null`. Answers what was stored. */
  setWalk(walk: CompanionWalkInput | null): CompanionWalk | null;
  /** `companion_sentence` for her own sentences (`role: 'kaylee'`), `companion_log` for every other line. Answers the stored line. */
  appendLog(entry: CompanionLogLineInput): CompanionLogEntry;
  /** Her sentence `index` of the turn `turnId`, or `null` when the log holds none (an unknown turn or index, or a log that was cleared). No frame. */
  readSentence(turnId: string, index: number): CompanionLogEntry | null;
  /** The newest `limit` lines, oldest first. */
  readLog(limit: number): CompanionLogEntry[];
  /** `companion_note`. A card is a `note` about nothing unless it is given its `kind` and the `ref` it is about. */
  addNote(note: { title: string; text: string; kind?: CompanionNoteKind; ref?: CompanionNoteRef | null }): CompanionNote;
  listNotes(): CompanionNote[];
  /** `companion_note_removed`, only when this account had the note. Answers whether it did. */
  removeNote(id: number): boolean;
  /** `companion_note_pinned` with the card's id and the state it is in now, only when this account had the card (a card already in that state is told again, so a page that missed it learns it). Answers whether it did. */
  setNotePinned(id: number, pinned: boolean): boolean;
  emit(frame: CompanionEmittedFrame): void;
  /** Deletes the log and the UNPINNED notes (a pinned card is his keep), empties the state (a standing action's row in `companion_actions` ends `cancelled`, and stays; one a take is carrying out is the take's to end), then `companion_cleared`. */
  clearAccount(): void;
};

const isSessionRef = (value: unknown): value is CompanionSessionRef =>
  isRecord(value) && isText(value.sessionId) && isText(value.name) && isText(value.project);

const isDraftTarget = (value: unknown): value is CompanionDraftTarget =>
  isRecord(value)
  && ((value.kind === 'session' && isSessionRef(value.session))
    || (value.kind === 'new' && isText(value.projectPath) && isText(value.projectName)));

const isDraft = (value: unknown): value is CompanionDraft =>
  isRecord(value) && isDraftTarget(value.target) && isText(value.text) && isText(value.updatedAt);

const isWholeNumber = isWholeFrom(0);

const isWalk = (value: unknown): value is CompanionWalk =>
  isRecord(value)
  && isSessionRef(value.session)
  && isList(value.items)
  && value.items.every(isText)
  && isWholeNumber(value.at)
  && isText(value.updatedAt);

const isSound = (value: unknown): value is CompanionSound =>
  isRecord(value) && isText(value.tag) && isWholeNumber(value.at);

/**
 * One JSON column read as its shape, or `null` for none: an empty column, or one that is not
 * JSON or not the shape (which is warned about once per read, naming the account and column).
 */
function readJsonColumn<T>(userId: number, column: string, raw: string | null, isShape: (value: unknown) => value is T): T | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isShape(parsed)) return parsed;
    console.warn(`[Companion] Dropping ${column} of account ${userId}: it does not have the expected shape`);
  } catch (error) {
    console.warn(`[Companion] Dropping ${column} of account ${userId}: it is not JSON`, { error: error instanceof Error ? error.message : String(error) });
  }
  return null;
}

function toStoredState(userId: number, row: CompanionStateRow | null): CompanionStoredState {
  return {
    providerSessionId: row?.provider_session_id ?? null,
    sessionShape: row?.session_shape ?? null,
    focus: readJsonColumn(userId, 'focus_json', row?.focus_json ?? null, isSessionRef),
    draft: readJsonColumn(userId, 'draft_json', row?.draft_json ?? null, isDraft),
    pending: readJsonColumn(userId, 'pending_json', row?.pending_json ?? null, isStoredPending),
    walk: readJsonColumn(userId, 'walk_json', row?.walk_json ?? null, isWalk),
    floor: row?.floor ?? null,
  };
}

function toLogEntry(userId: number, row: CompanionLogRow): CompanionLogEntry {
  const sounds = readJsonColumn(userId, `companion_log.sounds_json (row ${row.id})`, row.sounds_json, (value): value is CompanionSound[] => isList(value) && value.every(isSound));
  return {
    id: row.id,
    at: row.at,
    role: row.role,
    via: row.via,
    turnId: row.turn_id,
    index: row.turn_index,
    text: row.text,
    mood: row.mood,
    sounds: sounds ?? [],
  };
}

/** Keyed by the contract's union, so a kind added to `CompanionNoteKind` without a word here is a compile error rather than a card read back as a `note`. */
const NOTE_KINDS: Record<CompanionNoteKind, true> = { note: true, list: true, diff: true, plan: true, page: true };

const isNoteKind = (value: string): value is CompanionNoteKind => Object.hasOwn(NOTE_KINDS, value);

const isNoteRef = (value: unknown): value is CompanionNoteRef => {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'card': return isText(value.plan);
    case 'chat': return isText(value.sessionId);
    case 'page': return isText(value.pageId) && (value.blockId === null || isText(value.blockId));
    case 'project': return isText(value.path);
    default: return false;
  }
};

/**
 * One card row as the wire's note. A `ref_json` that does not parse (or is not a ref) reads as no ref, with the one line
 * `readJsonColumn` logs; a `kind` the contract does not know reads as a `note`, with one line of its own.
 */
function toNote(userId: number, row: CompanionNoteRow): CompanionNote {
  if (!isNoteKind(row.kind)) console.warn(`[Companion] Reading companion_notes.kind "${row.kind}" of account ${userId} (row ${row.id}) as a note: it is not a kind of card`);
  return {
    id: row.id,
    at: row.at,
    title: row.title,
    text: row.text,
    kind: isNoteKind(row.kind) ? row.kind : 'note',
    ref: readJsonColumn(userId, `companion_notes.ref_json (row ${row.id})`, row.ref_json, isNoteRef),
    pinned: row.pinned === 1,
  };
}

/**
 * Builds the store for one account; `userId` is the account whose rows are read and whose pages are told.
 * Consumed by `companion.service.ts`, once per account in its registry.
 */
export function createCompanionStore(userId: number): CompanionStore {
  const send = (frame: CompanionFrame): void => sendToUser(userId, frame);

  return {
    readState: () => toStoredState(userId, companionDb.readState(userId)),

    setProviderSession(providerSessionId, sessionShape) {
      // One statement: an id never stands with another conversation's shape.
      companionDb.writeState(userId, { provider_session_id: providerSessionId, session_shape: sessionShape });
    },

    readHandover: () => companionDb.readState(userId)?.handover ?? null,

    setHandover(handover) {
      companionDb.writeState(userId, { handover });
    },

    readUnanswered: () => readJsonColumn(userId, 'unanswered_json', companionDb.readState(userId)?.unanswered_json ?? null, isUnansweredList) ?? [],

    setUnanswered(unanswered) {
      companionDb.writeState(userId, { unanswered_json: unanswered.length === 0 ? null : JSON.stringify(unanswered) });
    },

    setFloor(floor) {
      companionDb.writeState(userId, { floor });
      // Every write, not only a change: a page that missed the move (a socket that reconnected) hears it again the next time anyone speaks to her.
      if (floor !== null) send({ kind: 'companion_floor', floor });
    },

    setFocus(focus) {
      companionDb.writeState(userId, { focus_json: focus === null ? null : JSON.stringify(focus) });
      send({ kind: 'companion_focus', focus });
    },

    setDraft(input) {
      const draft: CompanionDraft | null = input && { ...input, updatedAt: new Date().toISOString() };
      companionDb.writeState(userId, { draft_json: draft && JSON.stringify(draft) });
      send({ kind: 'companion_draft', draft });
      return draft;
    },

    setPending(next) {
      companionDb.writeState(userId, { pending_json: next === null ? null : JSON.stringify(next) });
      const pending = next === null ? null : withoutPin(next);
      send({ kind: 'companion_pending', pending });
      return pending;
    },

    setWalk(input) {
      const walk: CompanionWalk | null = input && { ...input, updatedAt: new Date().toISOString() };
      companionDb.writeState(userId, { walk_json: walk && JSON.stringify(walk) });
      send({ kind: 'companion_walk', walk });
      return walk;
    },

    appendLog(input) {
      const row = companionDb.appendLog(userId, {
        role: input.role,
        text: input.text,
        via: input.via ?? null,
        turn_id: input.turnId ?? null,
        turn_index: input.index ?? null,
        mood: input.mood ?? null,
        // No sounds is NULL, not "[]": most lines have none.
        sounds_json: input.sounds?.length ? JSON.stringify(input.sounds) : null,
      });
      const entry = toLogEntry(userId, row);
      send({ kind: entry.role === 'kaylee' ? 'companion_sentence' : 'companion_log', entry });
      return entry;
    },

    readLog: (limit) => companionDb.readLog(userId, limit).map((row) => toLogEntry(userId, row)),

    readSentence(turnId, index) {
      const row = companionDb.readSentence(userId, turnId, index);
      return row === null ? null : toLogEntry(userId, row);
    },

    addNote(input) {
      const note = toNote(userId, companionDb.addNote(userId, input));
      send({ kind: 'companion_note', note });
      return note;
    },

    listNotes: () => companionDb.listNotes(userId).map((row) => toNote(userId, row)),

    removeNote(id) {
      const removed = companionDb.removeNote(userId, id);
      if (removed) send({ kind: 'companion_note_removed', id });
      return removed;
    },

    setNotePinned(id, pinned) {
      const found = companionDb.setNotePinned(userId, id, pinned);
      if (found) send({ kind: 'companion_note_pinned', id, pinned });
      return found;
    },

    emit: send,

    clearAccount() {
      companionDb.clearAccount(userId);
      send({ kind: 'companion_cleared' });
    },
  };
}
