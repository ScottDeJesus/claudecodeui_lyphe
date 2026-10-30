import { notesService } from '@/modules/notes/index.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';
import type { Note } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { LIST_ABOUT_NOTHING, NOTE_ABOUT_NOTHING } from './card-shapes.js';
import { answerRead, whenWords } from './eyes-answer.js';
import { clipLine, counted, fitLines, maskCredentials } from './line-words.js';

/**
 * `read_notes`: his notes, read through the Notes tab's own service (`notesService`), the signed-in account's alone. `scope` is:
 *   - `list`: every note, newest updated first, one line each: `<title> · <first eight words> · updated <when>`, up to 20;
 *   - a note's id or its title, whole: the title and its time, then its text, handed whole when short and as a dactyl's digest when
 *     long;
 *   - a phrase over titles and text: the one note that holds it answered whole, several as lines.
 * Nothing here writes a note. With `panel: true` the whole answer goes on his panel. A note is his own writing and is handed over
 * uncut, except that a value that looks like a credential is masked (`maskCredentials`): one of his notes opens with an API key.
 *
 * Consumed by `panel-reads.ts`, which builds the tool.
 */

/** The words of a note's text its list line carries. */
const PREVIEW_WORDS = 8;

/** The longest title and preview a list line carries. */
const TITLE_MAX = 70;
const PREVIEW_MAX = 80;

/** What a dactyl is asked of a long note, and of a list that came out past 2,000 characters (`NO_SPEND` is added by `wholeOrDigest`). */
const NOTE_BRIEF = 'What does this say, and what does it ask or decide? At most 12 lines; cite L<n>.';
const LIST_BRIEF = 'List the notes, one line each, newest first, keeping each title. At most 15 lines; cite L<n>.';

/** The id shape the Notes tab mints (a UUID). Anything else is a title or a phrase. */
const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first eight words of a note's text, "…" when there are more, or "(no text)". */
function preview(text: string): string {
  const words = text.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return '(no text)';
  const head = words.slice(0, PREVIEW_WORDS).join(' ');
  return clipLine(words.length > PREVIEW_WORDS ? `${head}…` : head, PREVIEW_MAX);
}

/** One note as one line: `<title> · <first eight words> · updated <when>`. */
const noteLine = (note: Note): string => `${clipLine(note.title, TITLE_MAX)} · ${preview(note.description)} · updated ${whenWords(note.updatedAt)}`;

/** One note, whole: its title and time first, then its text (or the whole of both on his panel). A credential in it is masked, as in its list line. */
function noteAnswer(deps: CompanionToolDeps, note: Note, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  const title = maskCredentials(note.title);
  const body = maskCredentials(note.description).trim();
  return answerRead(
    deps,
    { panel, title, text: body === '' ? '(no text)' : body, label: 'note', brief: NOTE_BRIEF, intro: `${title} · updated ${whenWords(note.updatedAt)}`, shape: NOTE_ABOUT_NOTHING },
    signal
  );
}

/** `read_notes`: see the file's head. */
export function readNotes(
  deps: CompanionToolDeps,
  args: { scope: string; panel?: boolean },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> | ToolTextResult {
  const panel = args.panel === true;
  const scope = args.scope.trim();
  const lower = scope.toLowerCase();

  if (NOTE_ID.test(scope)) {
    try {
      return noteAnswer(deps, notesService.get(deps.userId, lower), panel, signal);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return deps.refuse(`He has no note with the id ${scope}. read_notes list shows his notes.`);
      throw error;
    }
  }

  // Newest updated first, as the line says: the service's own order is by when a note was made or last saved, which this fixes.
  const notes = notesService.list(deps.userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (lower === 'list') {
    if (notes.length === 0) return textResult('He has no notes.');
    return answerRead(
      deps,
      { panel, title: 'His notes', text: fitLines(notes.map(noteLine)), label: 'notes', brief: LIST_BRIEF, intro: `${counted(notes.length, 'note')}, newest first:`, shape: LIST_ABOUT_NOTHING },
      signal
    );
  }

  const exact = notes.filter((note) => note.title.toLowerCase() === lower);
  const fits = exact.length > 0 ? exact : notes.filter((note) => note.title.toLowerCase().includes(lower) || note.description.toLowerCase().includes(lower));
  if (fits.length === 0) return textResult(`No note holds "${scope}" in its title or text. read_notes list shows his notes.`);
  if (fits.length === 1) return noteAnswer(deps, fits[0], panel, signal);
  return answerRead(
    deps,
    { panel, title: `Notes: ${scope}`, text: fitLines(fits.map(noteLine)), label: 'notes', brief: LIST_BRIEF, intro: `${counted(fits.length, 'note')} fit "${scope}":`, shape: LIST_ABOUT_NOTHING },
    signal
  );
}
