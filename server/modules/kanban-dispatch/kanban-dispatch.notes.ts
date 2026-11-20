import { KANBAN_PRIORITIES, KANBAN_STATUSES, type KanbanPriority, type KanbanStatus } from '@/shared/kanban-types.js';

import { count, fail, firstReason, flag, isList, isRecord, isRequiredText, isText, ok, oneOf, recordField, requiredText, textField, texts, type Payload, type Read } from './kanban-dispatch.fields.js';

/** Where a step stands in the card's walk: waiting, in progress, or finished. */
export type NoteStepState = 'pending' | 'active' | 'done';

/** A question and the choice made on it, kept so a link can cite the decision behind it. */
export type NoteDecision = { question: string; choice: string };

/** What a note changes on the board; each kind carries only the fields its change needs. */
export type NoteBody =
  | { kind: 'steps'; steps: string[] }
  | { kind: 'step'; text: string; state: NoteStepState; note: string }
  | { kind: 'status'; status: KanbanStatus }
  | { kind: 'tags'; add: string[]; remove: string[] }
  | { kind: 'question'; text: string; options: string[]; free: boolean }
  | { kind: 'decision'; question: string; choice: string }
  | { kind: 'text'; field: 'plan' | 'closingRemarks' | 'changelog'; value: string }
  | { kind: 'shot'; path: string; name: string }
  | { kind: 'tokens'; delta: { tokensIn: number; tokensOut: number; cacheRead: number; cacheCreate: number } }
  | { kind: 'card'; title: string; description: string; tags: string[]; priority: KanbanPriority }
  | { kind: 'board'; board: string }
  | { kind: 'link'; target: string; tags: string[]; decision: NoteDecision | null }
  | { kind: 'close'; target: string; closingRemarks: string };

/** The field a text note writes: the plan, the closing remarks, or the changelog line. */
type TextField = Extract<NoteBody, { kind: 'text' }>['field'];

/** A note as the board applies it: where it lands (id, board, card, title) plus what it does. */
export type DispatcherNote = { id: number; board: string; card: string; title: string } & NoteBody;

/** The notes that read, and one line for each entry that did not; a bad note costs only itself. */
export type NotesReading = { notes: DispatcherNote[]; unread: string[] };

type NoteHead = { id: number; board: string; card: string; title: string; kind: string; payload: Payload };

type PayloadReading = NoteBody | string;

type BodyReader = (payload: Payload) => PayloadReading;

/** Note ids count up from one, so zero or a negative id cannot name a real note. */
const MIN_NOTE_ID = 1;
const DEFAULT_PRIORITY: KanbanPriority = 'medium';
const STEP_STATES: readonly NoteStepState[] = ['pending', 'active', 'done'];
const LIST_ERROR_PREFIX = 'dispatcher card notes --json printed no list: ';

/** Only a positive integer can name a note in the dispatcher's list. */
function noteId(payload: Payload): Read<number> {
  const value = payload['id'];
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_NOTE_ID
    ? ok(value)
    : fail('id is not a positive integer');
}

/** A decision needs both its question and its choice, since one without the other says nothing. */
function readDecisionPair(payload: Payload): Read<NoteDecision> {
  const question = requiredText(payload, 'question');
  const choice = requiredText(payload, 'choice');
  if (!question.ok || !choice.ok) return fail(firstReason(question, choice));
  return ok({ question: question.value, choice: choice.value });
}

/** A link's decision is optional: absent or null means the link stands without one. */
function readOptionalDecision(payload: Payload): Read<NoteDecision | null> {
  const value = payload['decision'];
  if (value === undefined || value === null) return ok(null);
  return isRecord(value) ? readDecisionPair(value) : fail('decision must be an object');
}

/** An empty list would seed no checklist, so steps must carry at least one text. */
function readSteps(payload: Payload): PayloadReading {
  const steps = texts(payload, 'steps', isRequiredText);
  if (!steps.ok) return steps.reason;
  return steps.value.length > 0 ?{ kind: 'steps', steps: steps.value } : 'steps must be a non-empty list';
}

/** One checklist step: its text, where it stands, and an optional note on it. */
function readStep(payload: Payload): PayloadReading {
  const text = requiredText(payload, 'text');
  const state = oneOf(payload, 'state', STEP_STATES);
  const note = textField(payload, 'note', '');
  if (!text.ok || !state.ok || !note.ok) return firstReason(text, state, note);
  return { kind: 'step', text: text.value, state: state.value, note: note.value };
}

/** A move to another column, which the board can only make to a column it has. */
function readStatus(payload: Payload): PayloadReading {
  const status = oneOf(payload, 'status', KANBAN_STATUSES);
  return status.ok ? { kind: 'status', status: status.value } : status.reason;
}

/** Tag edits; with both lists empty the note would change nothing, so it is refused. */
function readTags(payload: Payload): PayloadReading {
  const add = texts(payload, 'add', isRequiredText);
  const remove = texts(payload, 'remove', isRequiredText);
  if (!add.ok || !remove.ok) return firstReason(add, remove);
  if (add.value.length + remove.value.length === 0)return 'add and remove are both empty';
  return { kind: 'tags', add: add.value, remove: remove.value };
}

/** A question for the human; `free` says whether a typed answer is taken besides the options. */
function readQuestion(payload: Payload): PayloadReading {
  const text = requiredText(payload, 'text');
  const options = texts(payload, 'options', isText);
  const free = flag(payload, 'free');
  if (!text.ok || !options.ok || !free.ok) return firstReason(text, options, free);
  return { kind: 'question', text: text.value, options: options.value, free: free.value };
}

/** A choice the walk took for the operator and states, recorded on the card with the question it answers. */
function readDecision(payload: Payload): PayloadReading {
  const decision = readDecisionPair(payload);
  if (!decision.ok) return decision.reason;
  return { kind: 'decision', ...decision.value };
}

/** The payload keys a text note may carry, each with the field it writes. */
const TEXT_FIELDS: readonly { key: string; field: TextField }[] = [
  { key: 'plan', field: 'plan' },
  { key: 'closing_remarks', field: 'closingRemarks' },
  { key: 'changelog', field: 'changelog' },
];

/** Plan, closing remarks or the changelog line, exactly one, since a note naming several or none cannot say which field to write. */
function readText(payload: Payload): PayloadReading {
  const present = TEXT_FIELDS.flatMap(({ key, field }) => {
    const value = payload[key];
    return isText(value) ? [{ field, value }] : [];
  });
  const [only, ...rest] = present;
  if (only === undefined || rest.length > 0) {
    return 'exactly one of plan, closing_remarks or changelog must be a string';
  }
  return { kind: 'text', field: only.field, value: only.value };
}

/** A screenshot; its path must be absolute, since a relative one resolves against wherever the board runs. */
function readShot(payload: Payload): PayloadReading {
  const path = textField(payload, 'path');
  const name = textField(payload, 'name', '');
  if (!path.ok || !name.ok) return firstReason(path, name);
  return path.value.startsWith('/') ? { kind: 'shot', path: path.value, name: name.value } : 'path must start with /';
}

/** Token spend for the card; each count must be a real amount, and an absent one is none spent. */
function readTokens(payload: Payload): PayloadReading {
  const tokensIn = count(payload, 'in');
  const tokensOut = count(payload, 'out');
  const cacheRead = count(payload, 'cache_read');
  const cacheCreate = count(payload, 'cache_create');
  if (!tokensIn.ok || !tokensOut.ok || !cacheRead.ok || !cacheCreate.ok) {
    return firstReason(tokensIn, tokensOut, cacheRead, cacheCreate);
  }
  return {
    kind: 'tokens',
    delta: {
      tokensIn: tokensIn.value,
      tokensOut: tokensOut.value,
      cacheRead: cacheRead.value,
      cacheCreate: cacheCreate.value,
    },
  };
}

/** A card's new title, description, tags and priority; priority falls back to medium when omitted. */
function readCard(payload: Payload): PayloadReading {
  const title = requiredText(payload, 'title');
  const description = textField(payload, 'description', '');
  const tags = texts(payload, 'tags', isRequiredText);
  const priority = oneOf(payload, 'priority', KANBAN_PRIORITIES, DEFAULT_PRIORITY);
  if (!title.ok || !description.ok || !tags.ok || !priority.ok) {
    return firstReason(title, description, tags, priority);
  }
  return {
    kind: 'card',
    title: title.value,
    description: description.value,
    tags: tags.value,
    priority: priority.value,
  };
}

/** The dispatcher asking for the board's cards (every card but this one), which the board answers with its roster; a blank id names no board. */
function readBoard(payload: Payload): PayloadReading {
  const board = requiredText(payload, 'board');
  return board.ok ? { kind: 'board', board: board.value } : board.reason;
}

/** A link ties this card to a target, optionally with the decision that justified it. */
function readLink(payload: Payload): PayloadReading {
  const target = requiredText(payload, 'card');
  const tags = texts(payload, 'tags', isRequiredText);
  const decision = readOptionalDecision(payload);
  if (!target.ok || !tags.ok || !decision.ok) return firstReason(target, tags, decision);
  return { kind: 'link', target: target.value, tags: tags.value, decision: decision.value };
}

/** A close ends the card; its remarks may be empty but must be present, so the board never writes a guess. */
function readClose(payload: Payload): PayloadReading {
  const target = requiredText(payload, 'card');
  const remarks = textField(payload, 'closing_remarks');
  if (!target.ok || !remarks.ok) return firstReason(target, remarks);
  return { kind: 'close', target: target.value, closingRemarks: remarks.value };
}

/** Each kind's payload reader, keyed by the dispatcher's kind name. */
const BODY_READERS: Record<string, BodyReader> = {
  steps: readSteps,
  step: readStep,
  status: readStatus,
  tags: readTags,
  question: readQuestion,
  decision: readDecision,
  text: readText,
  shot: readShot,
  tokens: readTokens,
  card: readCard,
  board: readBoard,
  link: readLink,
  close: readClose,
};

/** Looks only at the table's own keys, so an inherited name such as 'constructor' is an unknown kind. */
function readerFor(kind: string): BodyReader | undefined {
  return Object.prototype.hasOwnProperty.call(BODY_READERS, kind) ? BODY_READERS[kind] : undefined;
}

/** A note whose head fails has no card to land on, so it is reported and never applied. */
function readHead(entry: unknown): Read<NoteHead> {
  if (!isRecord(entry)) return fail('the entry is not an object');
  const id = noteId(entry);
  const board = textField(entry, 'board');
  const card = textField(entry, 'card');
  const title = textField(entry, 'title');
  const kind = textField(entry, 'kind');
  const payload = recordField(entry, 'payload');
  if (!id.ok || !board.ok || !card.ok || !title.ok || !kind.ok || !payload.ok) {
    return fail(firstReason(id, board, card, title, kind, payload));
  }
  return ok({
    id: id.value,
    board: board.value,
    card: card.value,
    title: title.value,
    kind: kind.value,
    payload: payload.value,
  });
}

/** One entry becomes a note, or the single line that says why it was left out of the reading. */
function readEntry(entry: unknown): DispatcherNote | string {
  const head = readHead(entry);
  if (!head.ok) return `a note whose head does not read: ${head.reason}`;
  const { id, board, card, title, kind, payload } = head.value;
  const reader = readerFor(kind);
  if (reader === undefined) return `note ${id} ${kind}: unknown kind`;
  const body = reader(payload);
  if (typeof body === 'string') return `note ${id} ${kind}: ${body}`;
  return { id, board, card, title, ...body };
}

/**
 * Reads the dispatcher's printed notes. A bad note costs only itself: it is reported in `unread` and skipped.
 * The result is sorted by id so the board applies notes in the order they were written.
 */
export function readNotes(printed: string): NotesReading {
  const notes: DispatcherNote[] = [];
  const unread: string[] = [];
  for (const entry of parseList(printed)) {
    const read = readEntry(entry);
    if (typeof read === 'string') unread.push(read);
    else notes.push(read);
  }
  return { notes: notes.sort((a, b) => a.id - b.id), unread };
}

/** A printout that is not a JSON list comes from another dispatcher build, so it is refused whole. */
function parseList(printed: string): unknown[] {
  const parsed = parseJson(printed);
  if (!isList(parsed)) throw new Error(`${LIST_ERROR_PREFIX}the value is not an array`);
  return parsed;
}

/** The parser's own message goes into the error, so the log shows what the dispatcher actually printed. */
function parseJson(printed: string): unknown {
  try {
    const parsed: unknown = JSON.parse(printed);
    return parsed;
  } catch (error) {
    throw new Error(`${LIST_ERROR_PREFIX}${error instanceof Error ? error.message : String(error)}`);
  }
}
