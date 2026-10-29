import type { CompanionFrame, CompanionLogEntry, CompanionNote, CompanionPicture } from '@/shared/companion-types';

/**
 * How a page folds what Kaylee tells it into the picture it holds: `reduceCompanion(picture, frame)` is the whole of it.
 * PURE, and importing nothing but types, so `tsx` can run it on frames recorded off a real socket and the result can be
 * set beside a fresh `GET /api/companion` — the check that a page which only ever heard frames draws what the server holds.
 *
 * A CLEAR IS THE ONE FRAME NOT TO FOLD TWICE. A page seeds its picture with a GET while frames are already arriving on the
 * socket, and the two are not ordered against each other, so a frame can reach a picture that already holds it. A log
 * entry or a note is kept by its id (a second fold finds it and changes nothing); every other frame but a clear replaces
 * the field it names, so folding it again writes the same value. A clear would wipe what came after it, so the provider
 * never replays one over a fresh read: it drops what it had queued and reads again. A frame whose kind this build does
 * not know is left alone — a newer server may send one — and the picture comes back as the same object.
 *
 * A FRAME THIS PAGE CANNOT READ IS LEFT ALONE, the same as one of an unknown kind. The provider holds the page's one picture
 * above the whole workspace, so a payload of the wrong shape (a server of another version, a frame cut short) that was
 * folded in would be drawn by every consumer and take the app down with it. Each frame's payload is checked for the fields
 * the panel draws from before it replaces anything, and a picture read from the server is checked the same way
 * (`isCompanionPicture`); a read that fails the check is a failed read, never a picture.
 *
 * `companion_pending` replaces the one action waiting for his word (`null` when it was taken, withdrawn, replaced or
 * lapsed on the server), and a frame cut short of the fields the action card draws from is left alone like any other.
 * `companion_cleared` empties what Clear empties on the server — the log, the notes, the draft, the pending action, the
 * walk, the focus, her activity and the turn — so the panel is bare at once; the provider also reads the picture again,
 * which is the server's own word on the rest. `companion_open` changes nothing here: it is an order to the page whose
 * client id it names, which the provider carries out.
 */

/** How many log entries a page keeps: the newest, as `GET /api/companion` carries. The server stores more; the panel draws no more than this. */
const LOG_KEPT = 200;

//----------------- THE SHAPES A PAGE DRAWS FROM ------------
// Not the whole contract: the fields the panel, the door and the palette read, so a payload that lacks one is refused
// instead of drawn. Everything a field may be besides its type (a draft's target kind, a phase's name) is the panel's to tolerate.

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** Absent is `null` on every companion wire, so `undefined` is a frame cut short. */
const orNull = (isShape: (value: unknown) => boolean) => (value: unknown): boolean => value === null || isShape(value);

const isSessionRef = (value: unknown): boolean => isRecord(value) && isText(value.sessionId) && isText(value.name) && isText(value.project);
const isEntry = (value: unknown): value is CompanionLogEntry =>
  isRecord(value) && isNumber(value.id) && isText(value.at) && isText(value.role) && isText(value.text) && Array.isArray(value.sounds);
const isNote = (value: unknown): value is CompanionNote => isRecord(value) && isNumber(value.id) && isText(value.title) && isText(value.text);
const isSettings = (value: unknown): value is CompanionPicture['settings'] =>
  isRecord(value) && isText(value.name) && isText(value.model) && typeof value.live === 'boolean';
const isProcess = (value: unknown): value is CompanionPicture['process'] => isRecord(value) && isText(value.state);
const isActivity = (value: unknown): value is CompanionPicture['activity'] =>
  isRecord(value)
  && isText(value.phase)
  && orNull(isSessionRef)(value.session)
  && orNull(Array.isArray)(value.files)
  && orNull((walk) => isRecord(walk) && isNumber(walk.at) && isNumber(walk.total))(value.walk);
const isDraft = (value: unknown): boolean => isRecord(value) && isText(value.text) && isRecord(value.target);
/** The action card draws `say`, `expiresAt` and the target's words, and walks `carried[].lines`, so a payload without them is refused rather than drawn. */
const isPending = (value: unknown): boolean =>
  isRecord(value)
  && isText(value.id)
  && isText(value.action)
  && isText(value.say)
  && isText(value.preparedAt)
  && isText(value.expiresAt)
  && isRecord(value.target)
  && Array.isArray(value.carried)
  && value.carried.every((group) => isRecord(group) && Array.isArray(group.lines));
const isWalk = (value: unknown): boolean => isRecord(value) && isSessionRef(value.session) && Array.isArray(value.items) && isNumber(value.at);

/**
 * Whether a picture read from the server has every part a page draws from. Consumed by this module's CompanionProvider, which
 * refuses a read that fails it (the page keeps what it had) rather than hand the whole workspace a picture it cannot draw.
 */
export function isCompanionPicture(value: unknown): value is CompanionPicture {
  return isRecord(value)
    && isSettings(value.settings)
    && Array.isArray(value.models) && value.models.every((model) => isRecord(model) && isText(model.value) && isText(model.label))
    && isProcess(value.process)
    && isActivity(value.activity)
    && orNull(isText)(value.turnId)
    && orNull(isText)(value.floor)
    && orNull(isSessionRef)(value.focus)
    && orNull(isDraft)(value.draft)
    && orNull(isPending)(value.pending)
    && orNull(isWalk)(value.walk)
    && Array.isArray(value.notes) && value.notes.every(isNote)
    && Array.isArray(value.log) && value.log.every(isEntry);
}

// ---------------------------

/** Inserts `item` by ascending `id` into a list already in that order, or returns the same list when its id is held. */
function insertById<Item extends { id: number }>(list: Item[], item: Item): Item[] {
  const last = list[list.length - 1];
  if (last === undefined || item.id > last.id) return [...list, item];
  if (list.some((held) => held.id === item.id)) return list;
  const next = [...list, item];
  next.sort((a, b) => a.id - b.id);
  return next;
}

/** A log entry joins the log in id order, and only the newest `LOG_KEPT` stay. */
function appendEntry(log: CompanionLogEntry[], entry: CompanionLogEntry): CompanionLogEntry[] {
  const next = insertById(log, entry);
  if (next === log) return log;
  return next.length > LOG_KEPT ? next.slice(next.length - LOG_KEPT) : next;
}

/** A note card joins the notes in id order; the same note twice is one card. */
function addNote(notes: CompanionNote[], note: CompanionNote): CompanionNote[] {
  return insertById(notes, note);
}

/**
 * Consumed by this module's CompanionProvider, which folds each `companion_*` frame of the one socket into the page's
 * picture with it, and by `.verify/companion-reducer.mjs`, which runs it under `tsx` on recorded frames.
 */
export function reduceCompanion(picture: CompanionPicture, frame: CompanionFrame): CompanionPicture {
  switch (frame.kind) {
    // A sentence joins the log by its id like any entry; the log draws it in its turn's paragraph by `turnId` and `index`.
    case 'companion_sentence':
    case 'companion_log': {
      if (!isEntry(frame.entry)) return picture;
      const log = appendEntry(picture.log, frame.entry);
      return log === picture.log ? picture : { ...picture, log };
    }
    case 'companion_turn':
      if (!isText(frame.turnId)) return picture;
      if (frame.state === 'started') return { ...picture, turnId: frame.turnId };
      // An end for a turn this picture does not hold as running (an older one, or one it never heard begin) leaves the running turn alone.
      return picture.turnId === frame.turnId ? { ...picture, turnId: null } : picture;
    case 'companion_activity':
      return isActivity(frame.activity) ? { ...picture, activity: frame.activity } : picture;
    case 'companion_focus':
      return orNull(isSessionRef)(frame.focus) ? { ...picture, focus: frame.focus } : picture;
    case 'companion_draft':
      return orNull(isDraft)(frame.draft) ? { ...picture, draft: frame.draft } : picture;
    case 'companion_pending':
      return orNull(isPending)(frame.pending) ? { ...picture, pending: frame.pending } : picture;
    case 'companion_walk':
      return orNull(isWalk)(frame.walk) ? { ...picture, walk: frame.walk } : picture;
    case 'companion_note': {
      if (!isNote(frame.note)) return picture;
      const notes = addNote(picture.notes, frame.note);
      return notes === picture.notes ? picture : { ...picture, notes };
    }
    case 'companion_note_removed':
      return isNumber(frame.id) && picture.notes.some((note) => note.id === frame.id)
        ? { ...picture, notes: picture.notes.filter((note) => note.id !== frame.id) }
        : picture;
    case 'companion_settings':
      return isSettings(frame.settings) ? { ...picture, settings: frame.settings } : picture;
    case 'companion_process':
      return isProcess(frame.process) ? { ...picture, process: frame.process } : picture;
    // The floor moved (or was written again by its holder): the page whose client id it is plays her voice, every other shows the text.
    case 'companion_floor':
      return isText(frame.floor) && frame.floor !== picture.floor ? { ...picture, floor: frame.floor } : picture;
    case 'companion_cleared':
      return {
        ...picture,
        log: [],
        notes: [],
        draft: null,
        pending: null,
        walk: null,
        focus: null,
        turnId: null,
        activity: { phase: 'idle', session: null, files: null, walk: null },
      };
    default:
      // `companion_open`, and any kind a newer server sends.
      return picture;
  }
}
