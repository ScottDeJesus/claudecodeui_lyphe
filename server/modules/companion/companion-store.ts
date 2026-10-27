import { companionDb } from '@/modules/database/index.js';
import type { CompanionLogRow, CompanionNoteRow, CompanionStateRow } from '@/modules/database/index.js';
import { sendToUser } from '@/modules/websocket/index.js';
import type {
  CompanionDraft,
  CompanionDraftTarget,
  CompanionFrame,
  CompanionLogEntry,
  CompanionNote,
  CompanionSessionRef,
  CompanionSound,
  CompanionWalk,
} from '@/shared/companion-types.js';
import { isList, isRecord, isText, isWholeFrom } from '@/shared/document-fields.js';

/**
 * Her record of one account — state, log and notes — over `companionDb`, which speaks in rows.
 * This file maps a row to the wire contract (`CompanionSessionRef`, `CompanionDraft`,
 * `CompanionWalk`, `CompanionLogEntry`, `CompanionNote`) and back, and does the one thing a bare
 * repository cannot: every write goes to THIS account's pages as the matching `companion_*` frame,
 * through `sendToUser`, and to no other account's (the floor's, `companion_floor`, included). The page folds frames into its picture, so a
 * write that sent none would leave it stale.
 *
 * The store is made for one account and closes over its id, so a call cannot reach another
 * account's rows or pages. The write comes first and the frame second, in the same tick: a failed
 * write sends nothing, and two writes reach a page in the order they were made. The frames of
 * things that are not rows (a turn, her activity, her process, the settings, the open-chat order,
 * the clear) go through `emit`.
 *
 * A JSON column that does not read as its shape (a hand edit, a later build's shape) is dropped
 * with a warning that names the account and column, never thrown: the picture must still load.
 *
 * Consumer: `companion.service.ts`, which makes one store per account and serves the conversation's
 * callbacks and her tools from it: the picture, the verbs behind the routes, the alert and focus feeds.
 */

/**
 * What `readState` answers: every column of the account's state row as the contract's shapes, `null`
 * for a column that holds nothing. Consumed by `companion.service.ts` (the picture, the resume id, `<state>`).
 */
export type CompanionStoredState = {
  providerSessionId: string | null;
  focus: CompanionSessionRef | null;
  draft: CompanionDraft | null;
  walk: CompanionWalk | null;
  floor: string | null;
};

/** A draft as a caller hands it over: the store stamps `updatedAt`. Consumed by `companion.service.ts`, which writes the draft for the routes and her tools. */
export type CompanionDraftInput = Omit<CompanionDraft, 'updatedAt'>;

/** A walkthrough as a caller hands it over: the store stamps `updatedAt`. Consumed by `companion.service.ts`, which writes the walk for her `walk` tool. */
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
      | 'companion_open_chat'
      | 'companion_cleared';
  }
>;

/**
 * One account's store, with the frame each write sends noted on its verb. Consumed by
 * `companion.service.ts` (the registry makes one per account).
 */
export type CompanionStore = {
  readState(): CompanionStoredState;
  /** Her CLI conversation, `null` after Clear. No frame: a page has no use for it. */
  setProviderSessionId(providerSessionId: string | null): void;
  /** The client id holding the floor. `companion_floor` for a client id, on every write (a page learns the rest with the picture); a cleared floor (`null`) sends nothing. */
  setFloor(floor: string | null): void;
  /** `companion_focus`. */
  setFocus(focus: CompanionSessionRef | null): void;
  /** `companion_draft`, with the stored draft (stamped now) or `null`. Answers what was stored. */
  setDraft(draft: CompanionDraftInput | null): CompanionDraft | null;
  /** `companion_walk`, with the stored walk (stamped now) or `null`. Answers what was stored. */
  setWalk(walk: CompanionWalkInput | null): CompanionWalk | null;
  /** `companion_sentence` for her own sentences (`role: 'kaylee'`), `companion_log` for every other line. Answers the stored line. */
  appendLog(entry: CompanionLogLineInput): CompanionLogEntry;
  /** Her sentence `index` of the turn `turnId`, or `null` when the log holds none (an unknown turn or index, or a log that was cleared). No frame. */
  readSentence(turnId: string, index: number): CompanionLogEntry | null;
  /** The newest `limit` lines, oldest first. */
  readLog(limit: number): CompanionLogEntry[];
  /** `companion_note`. */
  addNote(note: { title: string; text: string }): CompanionNote;
  listNotes(): CompanionNote[];
  /** `companion_note_removed`, only when this account had the note. Answers whether it did. */
  removeNote(id: number): boolean;
  emit(frame: CompanionEmittedFrame): void;
  /** Deletes the log and notes, empties the state, then `companion_cleared`. */
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
    focus: readJsonColumn(userId, 'focus_json', row?.focus_json ?? null, isSessionRef),
    draft: readJsonColumn(userId, 'draft_json', row?.draft_json ?? null, isDraft),
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

function toNote(row: CompanionNoteRow): CompanionNote {
  return { id: row.id, at: row.at, title: row.title, text: row.text };
}

/**
 * Builds the store for one account; `userId` is the account whose rows are read and whose pages are told.
 * Consumed by `companion.service.ts`, once per account in its registry.
 */
export function createCompanionStore(userId: number): CompanionStore {
  const send = (frame: CompanionFrame): void => sendToUser(userId, frame);

  return {
    readState: () => toStoredState(userId, companionDb.readState(userId)),

    setProviderSessionId(providerSessionId) {
      companionDb.writeState(userId, { provider_session_id: providerSessionId });
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
      const note = toNote(companionDb.addNote(userId, input));
      send({ kind: 'companion_note', note });
      return note;
    },

    listNotes: () => companionDb.listNotes(userId).map(toNote),

    removeNote(id) {
      const removed = companionDb.removeNote(userId, id);
      if (removed) send({ kind: 'companion_note_removed', id });
      return removed;
    },

    emit: send,

    clearAccount() {
      companionDb.clearAccount(userId);
      send({ kind: 'companion_cleared' });
    },
  };
}
