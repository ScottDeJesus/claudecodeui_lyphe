import { notesDb, type NoteRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { Note, NoteInput, NotesChangedEvent } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The notes lane's four verbs: one account's cards, read newest first, written one row at a time.
 *
 * WHERE THE JUDGING LIVES. The routes decide whether the body's fields are TEXT — that is transport
 * shape, and a route owns it. Everything below decides whether the text is USABLE: how long it may
 * be, whether a title says anything at all, whether an id belongs to a row of this account. So the
 * normalisation and the four refusals live here, where every caller gets them, and not in the route,
 * where only this one mount would.
 *
 * NORMALISE, THEN JUDGE, THEN WRITE — in that order, because the length a person is refused for is
 * the length of the text that would be STORED, not of the keystrokes that arrived.
 *
 * THE FRAME NAMES NOBODY. Every write that landed sends one `notes_changed` to every open socket. It
 * carries no id and no account, so a client of another account learns only that SOMETHING moved and
 * reads its own list again; that read is what tells it whether anything of its own did.
 *
 * Consumers: `notes.routes.ts`, which is handed this object and calls it — the routes judge shape,
 * this module judges content. Reach the table through the database barrel and the sockets through the
 * websocket barrel; nothing here imports a repository or a transport service directly.
 */

/**
 * A title's ceiling, in characters after normalisation.
 *
 * MIRROR OF `NoteForm.tsx`'s `TITLE_MAX_LENGTH`, which caps the input's `maxLength` so the browser stops a
 * hand before the server has to. The two are the same NUMBER and are deliberately not shared: the
 * client build cannot import from `server/`. Change one and change the other.
 */
const TITLE_MAX = 200;

/**
 * A description's ceiling, in characters after normalisation.
 *
 * MIRROR OF `NoteForm.tsx`'s `DESCRIPTION_MAX_LENGTH`, on the same terms as `TITLE_MAX` above: the
 * textarea's `maxLength` and this number are one decision written twice.
 */
const DESCRIPTION_MAX = 20_000;

/**
 * The characters that DRAW AS NOTHING: whitespace (`\s`), format characters, and control characters.
 *
 * The format class is the one that matters: U+200B ZERO WIDTH SPACE and its family — ZWNJ, ZWJ, the
 * bidi marks, U+FEFF — are NOT `\s`, so they survive normalisation, and a title made only of them
 * draws as an empty card that still orders, counts and opens like a real note.
 *
 * The class JUDGES and never rewrites: a ZWJ inside an emoji and the ZWNJ of Persian, Arabic and
 * Indic text are part of a title that says something, and what is stored is the normalised text
 * untouched. MIRROR OF `NoteForm.tsx`'s own class, which gates the submit button — one decision
 * written twice, because the client build cannot import from `server/`. Change one and change the
 * other.
 */
const DRAWS_AS_NOTHING = /[\s\p{Cf}\p{Cc}]/gu;

/** One `notes` row as the wire carries it: camelCase, and the account the row belongs to stays here. */
function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The title as stored: every run of whitespace collapses to one space and the ends are trimmed.
 *
 * A pasted two-line title becomes one line rather than a title with a newline in it, and a title of
 * nothing but spaces reads as empty — which is what the blank check below then refuses, along with a
 * title that draws as nothing (see `DRAWS_AS_NOTHING`).
 */
function normaliseTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/**
 * The description as stored: its trailing whitespace is dropped and nothing else moves.
 *
 * Only the END is trimmed, because leading indentation and interior line breaks are the writer's
 * layout and the card draws them back with `whitespace-pre-wrap`.
 */
function normaliseDescription(description: string): string {
  return description.trimEnd();
}

/** The normalised pair, judged — or the `AppError` that says which of the three rules it broke. */
function validate(title: string, description: string): NoteInput {
  // Everything that draws as nothing is taken out first: if nothing is left, there is no title.
  if (!title.replace(DRAWS_AS_NOTHING, '')) {
    throw new AppError('A note needs a title.', { code: 'TITLE_REQUIRED', statusCode: 400 });
  }
  if (title.length > TITLE_MAX) {
    throw new AppError(`A title can be ${TITLE_MAX} characters at most.`, {
      code: 'TITLE_TOO_LONG',
      statusCode: 400,
    });
  }
  if (description.length > DESCRIPTION_MAX) {
    throw new AppError(`A description can be ${DESCRIPTION_MAX.toLocaleString('en-US')} characters at most.`, {
      code: 'DESCRIPTION_TOO_LONG',
      statusCode: 400,
    });
  }

  return { title, description };
}

/** The one id-shaped refusal, thrown by both writes when no row of the account carries the id. */
function noteNotFound(): AppError {
  return new AppError('That note is no longer there.', { code: 'NOTE_NOT_FOUND', statusCode: 404 });
}

/**
 * Puts one `notes_changed` frame on every open gateway socket.
 *
 * Its ONLY callers are the three writes below, and each calls it AFTER its write landed — a write
 * that refused never told a client it happened.
 *
 * The fan-out copies `kanban-broadcast.service.ts`: `JSON.stringify` once for the whole set, a walk
 * of `connectedClients` skipping any client whose `readyState` is not `WS_OPEN_STATE`, and a catch
 * PER CLIENT, because a dead socket must not cost every client after it in the set their frame.
 *
 * No per-user filtering, and none is possible: the frame names no account. A socket of another
 * account reads its own list and finds nothing changed.
 */
function broadcastNotesChanged(): void {
  const message = JSON.stringify({ kind: 'notes_changed', at: Date.now() } satisfies NotesChangedEvent);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[Notes] could not send a notes_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

/** The notes lane's verbs, as one instance. `notes.routes.ts` is handed this and calls it verbatim. */
export const notesService = {
  /** Every note of one account, newest first — the repository's order, passed through unmapped. */
  list(userId: number): Note[] {
    return notesDb.listForUser(userId).map(toNote);
  },

  /** Creates one note from a whole draft and answers it as stored, `createdAt === updatedAt`. */
  create(userId: number, input: NoteInput): Note {
    const { title, description } = validate(normaliseTitle(input.title), normaliseDescription(input.description));
    const note = toNote(notesDb.create({ userId, title, description }));
    broadcastNotesChanged();
    return note;
  },

  /**
   * Replaces the title and the description of one of the account's notes and answers it as saved.
   *
   * The not-found answer is the repository's: `null` from `update` means no row of THIS account
   * carries the id — a note of another account is, from here, a note that is not there.
   */
  update(userId: number, id: string, input: NoteInput): Note {
    const { title, description } = validate(normaliseTitle(input.title), normaliseDescription(input.description));
    const row = notesDb.update(userId, id, { title, description });
    if (row === null) throw noteNotFound();

    broadcastNotesChanged();
    return toNote(row);
  },

  /** Deletes one of the account's notes; a delete that landed is what sends the frame. */
  remove(userId: number, id: string): void {
    if (!notesDb.remove(userId, id)) throw noteNotFound();

    broadcastNotesChanged();
  },
};

/**
 * The service's own type, taken off the instance rather than written out again: the routes take this,
 * so a verb whose signature drifts fails the typecheck at the route that calls it.
 */
export type NotesService = typeof notesService;
