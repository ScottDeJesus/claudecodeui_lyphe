/**
 * THE PLACING PASS. The house files bug tickets (`~/.claude/scripts/bug file`); this server places each one on
 * the board whose folders hold the ticket's path. A pass runs `dispatcher bug pending --json`, makes each
 * ticket's card through the kanban card services (each write one transaction, one audit row whose actor is the
 * ticket's source, one frame), then stamps the ticket back with `dispatcher bug placed <id> --result -`. The
 * server opens no file of the dispatcher's; it runs the dispatcher's verbs and reads what they print. Each card
 * carries its ticket's tag (`ticket:<id>`), so a pass that finds the ticket still filed (a restart, a second server
 * during a handover, a stamp that did not take) stamps the card already made instead of making another; an owed
 * stamp is retried until it lands, whether or not the ticket is still listed.
 */

import { firstLine, runDispatcherCommand, type CommandDependencies } from '@/modules/dispatcher/index.js';
import { kanbanAttachmentsService, kanbanBoardsService, kanbanCardsService, kanbanRosterService, type KanbanWriteEvent } from '@/modules/kanban/index.js';
import { KANBAN_PRIORITIES, type KanbanBoard, type KanbanPriority, type KanbanStatus, type KanbanWriteContext } from '@/shared/kanban-types.js';

import { fail, isList, isRecord, isRequiredText, isText, ok, oneOf, requiredText, texts, textField, type Payload, type Read } from './kanban-dispatch.fields.js';

/** The four doors a ticket is filed through; the actor of a card a ticket placed is one of them. */
export const TICKET_SOURCES: ReadonlySet<string> = new Set(['chat', 'soul', 'nightly', 'cerberus']);

/** Leads every journal line this file writes. */
const LOG_PREFIX = '[kanban-dispatch]';
const EXIT_OK = 0;
const CARD_CREATED_KIND = 'card.created';
const TICKET_ID_MIN = 1;
const ABSOLUTE_PATH_START = '/';
const NO_BOARD_PREFIX = 'no board names ';
const NO_LIST_PREFIX = 'dispatcher bug pending --json printed no list: ';
const PENDING_ARGS = ['bug', 'pending', '--json'];
/** Filed and unplaced tickets together: the pass that also takes the tickets no board could take before. */
const UNPLACED_PENDING_ARGS = ['bug', 'pending', '--unplaced', '--json'];
/** The tag a placed card carries naming its ticket: the board's own record that the ticket already has a card, so a restart, a second server during a handover, or a forgotten owed stamp never makes a second one. An id in a tag is a key, never a word a reader is shown (INV-76). */
const TICKET_TAG_PREFIX = 'ticket:';

/** The lanes a filed ticket opens in. */
type TicketLane = Extract<KanbanStatus, 'todo' | 'active'>;
const TICKET_LANES: readonly TicketLane[] = ['todo', 'active'];

type PendingTicket = {
  id: number;
  source: string;
  path: string;
  title: string;
  description: string;
  priority: KanbanPriority;
  shots: string[];
  tags: string[];
  lane: TicketLane;
};
type PendingListing = { tickets: PendingTicket[]; unread: string[] };
type BoardRecord = { id: string; name: string; repos: string[]; autonomy: boolean };
/** What a ticket is stamped with: the card and its board, or the reason no board names its folder. */
type Stamp = { unplaced: string } | { board: BoardRecord; card: { id: string } };

/** The placing pass: one sweep over the dispatcher's tickets, each placed or stamped. */
export type TicketPlacer = { pass(withUnplaced: boolean): Promise<void> };

/**
 * True for a card a ticket placed. The teller never tells `created` for such a card, because the placing
 * stamp already wrote the dispatcher's row for it; every other write of that card is told as any card's is.
 */
export function isPlacedTicketCreation(write: KanbanWriteEvent): boolean {
  return write.kind === CARD_CREATED_KIND && TICKET_SOURCES.has(write.actor);
}

/**
 * Creates the placer, which keeps the stamps owed between passes. `commands` runs the listing; `stampCommands`
 * runs the stamp, whose ceiling covers the model sort a stamp on a board that runs itself makes before it answers.
 */
export function createTicketPlacer(dependencies: { commands: CommandDependencies; stampCommands: CommandDependencies; say: (line: string) => void }): TicketPlacer {
  const { commands, stampCommands, say } = dependencies;
  /**
   * Stamps owed to the dispatcher, keyed by ticket id (unique and stable in the house's store). Only stamps naming
   * a card are owed: one that did not take is retried until it lands, whether or not the ticket is still listed; the
   * card's ticket tag, not this map, is what keeps any pass from making a second card for the ticket.
   */
  const owed = new Map<number, Stamp>();

  /** One sweep: the filed tickets, and the unplaced ones too when asked. */
  async function pass(withUnplaced: boolean): Promise<void> {
    const listed = await runDispatcherCommand(commands, withUnplaced ? UNPLACED_PENDING_ARGS : PENDING_ARGS);
    if (listed.exit !== EXIT_OK) {
      say(`${LOG_PREFIX} dispatcher bug pending ${exitWords(listed.exit)}: ${failureLine(listed)}`);
      return;
    }
    const read = readOrSay(listed.stdout);
    if (read === null) return;
    for (const line of read.unread) say(`${LOG_PREFIX} ${line}`);
    for (const ticket of read.tickets) {
      const stamp = owed.get(ticket.id) ?? placeOrNull(ticket);
      if (stamp === null) continue;
      // An unplaced stamp is never owed: it is a reading of the boards as they stood, and the next pass reads them
      // again, so a board made meanwhile takes the ticket.
      if (await stampTicket(ticket.id, stamp)) owed.delete(ticket.id);
      else if (recordsCard(stamp)) owed.set(ticket.id, stamp);
    }
    // An owed stamp is retried until it lands, listed or not: a ticket that ended while its stamp was owed is answered
    // by the house as a late stamp (`bug_place._late` links the card to the ended ticket), so the card is never left with no row.
    const listedIds = new Set(read.tickets.map((ticket) => ticket.id));
    for (const [id, stamp] of [...owed]) {
      if (listedIds.has(id)) continue;
      if (await stampTicket(id, stamp)) owed.delete(id);
    }
  }

  /** The printout's tickets, or null after saying why it could not be read. */
  function readOrSay(printed: string): PendingListing | null {
    try {
      return readPending(printed);
    } catch (error) {
      say(`${LOG_PREFIX} dispatcher bug pending unreadable: ${messageOf(error)}`);
      return null;
    }
  }

  /** The stamp for a ticket; null when no card was made, so the ticket stays filed for a later pass. */
  function placeOrNull(ticket: PendingTicket): Stamp | null {
    const board = kanbanBoardsService.boardForPath(ticket.path);
    if (board === null) return { unplaced: `${NO_BOARD_PREFIX}${ticket.path}` };
    const context: KanbanWriteContext = { actor: ticket.source };
    // A card already carrying the ticket's tag is that ticket's card, so it is stamped again rather than made twice
    // (its tags and shots went on when it was made).
    const placed = cardPlacedFor(board.id, ticket.id);
    if (placed !== null) return { board: boardRecordOf(board), card: { id: placed } };
    const card = makeCardOrNull(board, ticket, context);
    if (card === null) return null;
    addTagsAndShots(card, ticket, context);
    return { board: boardRecordOf(board), card: { id: card.id } };
  }

  /** Creates the ticket's card; a failure is said and null returned, since no card then stands to stamp. */
  function makeCardOrNull(board: KanbanBoard, ticket: PendingTicket, context: KanbanWriteContext): { id: string } | null {
    try {
      return kanbanCardsService.createCard(
        board.id,
        { title: ticket.title, description: ticket.description, priority: ticket.priority, status: ticket.lane },
        context
      );
    } catch (error) {
      say(`${LOG_PREFIX} ticket ${ticket.id} (${ticket.title}) could not be placed on ${board.name}: ${messageOf(error)}`);
      return null;
    }
  }

  /**
   * Adds the ticket's own tag first, then each tag and screenshot, each in its own try: a failed one is said and
   * the rest go on, because the card already stands and must still be stamped, or a later pass would make a second
   * one. The ticket tag goes first so the window in which a card stands without it is as short as it can be.
   */
  function addTagsAndShots(card: { id: string }, ticket: PendingTicket, context: KanbanWriteContext): void {
    // The window between createCard and this tag write (two transactions) is the one moment a second SERVER PROCESS
    // could still miss the card; within one process both run in one synchronous turn, so no pass of this process can
    // see the card untagged.
    for (const tag of [ticketTagOf(ticket.id), ...ticket.tags]) {
      try {
        kanbanCardsService.addTag(card.id, tag, context);
      } catch (error) {
        say(`${LOG_PREFIX} ticket ${ticket.id}: tag ${tag} not added: ${messageOf(error)}`);
      }
    }
    for (const shot of ticket.shots) {
      try {
        kanbanAttachmentsService.addAttachmentFromPath(card.id, shot, context);
      } catch (error) {
        say(`${LOG_PREFIX} ticket ${ticket.id}: shot ${shot} not added: ${messageOf(error)}`);
      }
    }
  }

  /**
   * Writes the stamp back to the dispatcher; true when it took. Any other answer, a refused stamp included,
   * keeps the stamp owed: dropping it would leave the ticket filed, and the next pass would make a second card.
   */
  async function stampTicket(id: number, stamp: Stamp): Promise<boolean> {
    const result = await runDispatcherCommand(stampCommands, ['bug', 'placed', String(id), '--result', '-'], JSON.stringify(stamp));
    if (result.exit === EXIT_OK) {
      say(`${LOG_PREFIX} ${firstLine(result.stdout)}`);
      return true;
    }
    say(`${LOG_PREFIX} dispatcher bug placed ${id} ${exitWords(result.exit)}: ${failureLine(result)}`);
    return false;
  }

  return { pass };
}

/** Reads the printout's tickets; a ticket that does not read costs only itself, and the rest keep their order. */
function readPending(printed: string): PendingListing {
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
  const lane = oneOf(entry, 'lane', TICKET_LANES);
  if (!lane.ok) return lane;
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
  });
}

/** A ticket's id: a whole number from the minimum up. */
function readTicketId(entry: Payload): Read<number> {
  const id = entry.id;
  return typeof id === 'number' && Number.isInteger(id) && id >= TICKET_ID_MIN
    ? ok(id)
    : fail('id must be a positive integer');
}

/** A source must be one of the four doors a ticket is filed through. */
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

/** How a dispatcher command ended, in the words the journal uses. */
function exitWords(exit: number | null): string {
  return exit === null ? 'did not answer' : `exited ${exit}`;
}

/** The one line that says why a dispatcher command failed: its stderr, else its stdout. */
function failureLine(result: { stdout: string; stderr: string }): string {
  return firstLine(result.stderr) || firstLine(result.stdout);
}

/** The text of anything thrown, so a non-Error throw still reaches the journal. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The board as a stamp names it, so the dispatcher knows where the card went. */
function boardRecordOf(board: KanbanBoard): BoardRecord {
  return { id: board.id, name: board.name, repos: [...board.repos], autonomy: board.autonomy };
}

/** Whether a stamp names a card: only such a stamp is owed, since its card stands and must get its row. */
function recordsCard(stamp: Stamp): stamp is Extract<Stamp, { card: { id: string } }> {
  return 'card' in stamp;
}

/** The id of the first card of the board carrying the ticket's tag, archived ones included (an archived card is still that ticket's card), or null when none stands. */
function cardPlacedFor(boardId: string, ticketId: number): string | null {
  const tag = ticketTagOf(ticketId);
  const card = kanbanRosterService.boardCards(boardId).find((candidate) => candidate.tags.includes(tag));
  return card?.id ?? null;
}

/** The tag a ticket's card carries naming the ticket. */
function ticketTagOf(ticketId: number): string {
  return `${TICKET_TAG_PREFIX}${ticketId}`;
}
