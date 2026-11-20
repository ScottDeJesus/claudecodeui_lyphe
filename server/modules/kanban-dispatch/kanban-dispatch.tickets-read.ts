/**
 * THE PENDING LISTING'S READER. `dispatcher bug pending --json` is printed by the house, so the placing pass (`kanban-dispatch.tickets.ts`) reads it here once, field by field, into `PendingTicket`s; a ticket that does not read costs only itself. Split from kanban-dispatch.tickets.ts to keep each file under 300 lines.
 */

import { KANBAN_PRIORITIES, type KanbanPriority, type KanbanStatus } from '@/shared/kanban-types.js';

import { fail, isList, isRecord, isRequiredText, isText, ok, oneOf, requiredText, texts, textField, type Payload, type Read } from './kanban-dispatch.fields.js';

/** The five doors a ticket is filed through; the actor of a card a ticket placed is one of them. */
export const TICKET_SOURCES: ReadonlySet<string> = new Set(['chat', 'soul', 'nightly', 'cerberus', 'hunter']);

const TICKET_ID_MIN = 1;
const ABSOLUTE_PATH_START = '/';
const NO_LIST_PREFIX = 'dispatcher bug pending --json printed no list: ';

/** The lanes a filed ticket opens in. */
type TicketLane = Extract<KanbanStatus, 'todo' | 'active'>;

/** The lanes `bug pending` lists a ticket in: the two a card opens in, and `questions`, a card made in To Do that asks first. */
type PendingLane = TicketLane | 'questions';
const PENDING_LANES: readonly PendingLane[] = ['todo', 'active', 'questions'];

export type TicketQuestion = { text: string; options: string[] };

export type PendingTicket = {
  id: number;
  source: string;
  path: string;
  title: string;
  description: string;
  priority: KanbanPriority;
  shots: string[];
  tags: string[];
  lane: PendingLane;
  question: TicketQuestion | null;
};
export type PendingListing = { tickets: PendingTicket[]; unread: string[] };

/** Reads the printout's tickets; a ticket that does not read costs only itself, and the rest keep their order. */
export function readPending(printed: string): PendingListing {
  const tickets: PendingTicket[] = [];
  const unread: string[] = [];
  for (const entry of readListing(printed)) {
    const read = readTicket(entry);
    if (read.ok) tickets.push(read.value);
    else unread.push(unreadLine(entry, read.reason));
  }
  return { tickets, unread };
}

/** The line for a ticket that does not read, named by its id when the id itself reads. */
function unreadLine(entry: unknown, reason: string): string {
  if (isRecord(entry)) {
    const id = readTicketId(entry);
    if (id.ok) return `ticket ${id.value}: ${reason}`;
  }
  return `a ticket that does not read: ${reason}`;
}

/** The printout's list of tickets; a printout with no such list fails whole, since no entry can be placed from it. */
function readListing(printed: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(printed);
  } catch (error) {
    throw new Error(`${NO_LIST_PREFIX}${messageOf(error)}`);
  }
  const place = isRecord(parsed) ? parsed.place : undefined;
  if (!isList(place)) throw new Error(`${NO_LIST_PREFIX}place is not a list`);
  return place;
}

/** Reads one entry field by field; the first field that refuses says why the whole ticket does not read. */
function readTicket(entry: unknown): Read<PendingTicket> {
  if (!isRecord(entry)) return fail('ticket is not an object');
  const id = readTicketId(entry);
  if (!id.ok) return id;
  const source = readSource(entry);
  if (!source.ok) return source;
  const path = requiredText(entry, 'path');
  if (!path.ok) return path;
  if (!isAbsolutePath(path.value)) return fail('path must be an absolute path');
  const title = requiredText(entry, 'title');
  if (!title.ok) return title;
  const description = textField(entry, 'description');
  if (!description.ok) return description;
  const priority = oneOf(entry, 'priority', KANBAN_PRIORITIES);
  if (!priority.ok) return priority;
  const shots = texts(entry, 'shots', isAbsolutePath);
  if (!shots.ok) return shots;
  const tags = texts(entry, 'tags', isRequiredText);
  if (!tags.ok) return tags;
  const lane = oneOf(entry, 'lane', PENDING_LANES);
  if (!lane.ok) return lane;
  const question = readQuestion(entry, lane.value);
  if (!question.ok) return question;
  return ok({
    id: id.value,
    source: source.value,
    path: path.value,
    title: title.value,
    description: description.value,
    priority: priority.value,
    shots: shots.value,
    tags: tags.value,
    lane: lane.value,
    question: question.value,
  });
}

/** A questions ticket's question: its text and its options; a ticket in any other lane asks nothing, so carries null. */
function readQuestion(entry: Payload, lane: PendingLane): Read<TicketQuestion | null> {
  if (lane !== 'questions') return ok(null);
  const asked = entry.question;
  if (!isRecord(asked)) return fail('a questions ticket must carry its question');
  const text = requiredText(asked, 'text');
  if (!text.ok) return text;
  const options = texts(asked, 'options', isRequiredText);
  if (!options.ok) return options;
  return ok({ text: text.value, options: options.value });
}

/** A ticket's id: a whole number from the minimum up. */
function readTicketId(entry: Payload): Read<number> {
  const id = entry.id;
  return typeof id === 'number' && Number.isInteger(id) && id >= TICKET_ID_MIN
    ? ok(id)
    : fail('id must be a positive integer');
}

/** A source must be one of the five doors a ticket is filed through. */
function readSource(entry: Payload): Read<string> {
  const source = entry.source;
  if (!isText(source) || !TICKET_SOURCES.has(source)) {
    return fail(`source must be one of ${Array.from(TICKET_SOURCES).join(', ')}`);
  }
  return ok(source);
}

/** A path from the root: required text that starts with the root's slash. */
function isAbsolutePath(value: unknown): value is string {
  return isRequiredText(value) && value.startsWith(ABSOLUTE_PATH_START);
}

/** The text of anything thrown, so a non-Error throw still reaches the journal. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
