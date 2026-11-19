import { firstLine, runDispatcherCommand, type CommandDependencies } from '@/modules/dispatcher/index.js';
import { kanbanCardsService } from '@/modules/kanban/index.js';
import { AppError } from '@/shared/utils.js';

import { AS_DISPATCHER, askOnce, attachShotOnce, boardAnswer, cardOnBoard, changeCardFor, markStep, noteDecisionOnce, setSteps } from './kanban-dispatch.cards.js';
import { readNotes, type DispatcherNote } from './kanban-dispatch.notes.js';

/** Lines remembered as already logged; at this many the memory starts over, so a long-lived server stays bounded. */
const SAID_LINES_MAX = 500;

/** HTTP statuses that mean the note itself is at fault: retrying it can never help. */
const CLIENT_ERROR_MIN = 400;
const CLIENT_ERROR_MAX = 499;

/** Leads every journal line this file writes, so the line's source is obvious. */
const LOG_PREFIX = '[kanban-dispatch]';

/** What a note is stamped with; null stamps it with no result. */
type Stamp = Record<string, unknown> | null;

/** A note whose card, or for link and close the card its payload names, is no longer on its board. */
const GONE: Stamp = { gone: true };

/** The seams the applier needs: the dispatcher command runner and the journal. */
export type NoteApplierDependencies = { commands: CommandDependencies; log: (line: string) => void };

/** Pokes a pass and stops the applier. */
export type NoteApplier = { poke(): void; stop(): void };

/** A new note kind must get a case; reaching this at runtime means one was missed. */
function assertNever(value: never): never {
  throw new Error(`unhandled dispatcher note: ${JSON.stringify(value)}`);
}

/**
 * Applies one note through the kanban services and returns what to stamp it with.
 * A card that left its board is stamped gone, so its note is not retried forever.
 */
function applyNote(note: DispatcherNote): Stamp {
  const card = cardOnBoard(note.card, note.board);
  if (card === null) return GONE;
  switch (note.kind) {
    case 'steps':
      setSteps(card, note.steps);
      return null;
    case 'step':
      markStep(card, note);
      return null;
    case 'status':
      if (card.status !== note.status) kanbanCardsService.moveCard(card.id, { status: note.status }, AS_DISPATCHER);
      return null;
    case 'tags':
      for (const tag of note.add) kanbanCardsService.addTag(card.id, tag, AS_DISPATCHER);
      for (const tag of note.remove) kanbanCardsService.removeTag(card.id, tag, AS_DISPATCHER);
      return null;
    case 'question':
      askOnce(card, note);
      return null;
    case 'decision':
      noteDecisionOnce(card, note);
      return null;
    case 'text': {
      const change = note.field === 'plan' ? { plan: note.value } : { closingRemarks: note.value };
      kanbanCardsService.updateCard(card.id, change, AS_DISPATCHER);
      return null;
    }
    case 'shot':
      attachShotOnce(card, note);
      return null;
    case 'tokens':
      kanbanCardsService.addCardTokens(card.id, note.delta, AS_DISPATCHER);
      return null;
    case 'card':
      return { card: changeCardFor(note.board, note) };
    case 'board':
      return boardAnswer(note.board, note.card);
    case 'link': {
      const target = cardOnBoard(note.target, note.board);
      if (target === null) return GONE;
      for (const tag of note.tags) kanbanCardsService.addTag(target.id, tag, AS_DISPATCHER);
      if (note.decision !== null) noteDecisionOnce(target, note.decision);
      return null;
    }
    case 'close': {
      const target = cardOnBoard(note.target, note.board);
      if (target === null) return GONE;
      kanbanCardsService.updateCard(target.id, { closingRemarks: note.closingRemarks }, AS_DISPATCHER);
      if (target.status !== 'done') kanbanCardsService.moveCard(target.id, { status: 'done' }, AS_DISPATCHER);
      return null;
    }
    default:
      return assertNever(note);
  }
}

/** How a dispatcher command ended, in the words the journal uses. */
function exitWords(exit: number | null): string {
  return exit === null ? 'did not answer' : `exited ${exit}`;
}

/** The one line that says why a dispatcher command failed: its stderr, else its stdout. */
function failureLine(result: { stdout: string; stderr: string }): string {
  return firstLine(result.stderr) || firstLine(result.stdout);
}

/** Text of anything thrown, so a non-Error throw still reaches the journal. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for an AppError in the 4xx range: the note's own fault, which retrying cannot fix. */
function isNoteRefusal(error: unknown): error is AppError {
  return error instanceof AppError && error.statusCode >= CLIENT_ERROR_MIN && error.statusCode <= CLIENT_ERROR_MAX;
}

/**
 * Creates the board's note applier. Each pass applies the dispatcher's unapplied notes in id order;
 * pokes that arrive during a pass cost exactly one more pass.
 */
export function createNoteApplier(dependencies: NoteApplierDependencies): NoteApplier {
  const { commands } = dependencies;
  const said = new Set<string>();
  let running = false;
  let again = false;
  let stopped = false;
  /**
   * Notes applied whose stamp did not take, keyed by the note's id (stable and unique in the dispatcher's store);
   * a later pass retries only the stamp, so no note is applied twice by this process.
   */
  const owedStamps = new Map<number, Stamp>();

  /** Logs a line only the first time it is seen, so a note that fails on every poke does not bury the journal. */
  function say(line: string): void {
    if (said.has(line)) return;
    if (said.size >= SAID_LINES_MAX) said.clear();
    said.add(line);
    dependencies.log(line);
  }

  /** Applies one note; a refusal by the note becomes a stamp, any other failure returns null so its card waits. */
  function tryApply(note: DispatcherNote): { stamp: Stamp } | null {
    try {
      return { stamp: applyNote(note) };
    } catch (error) {
      const where = `note ${note.id} (${note.kind} on card ${note.card})`;
      if (isNoteRefusal(error)) {
        say(`${LOG_PREFIX} ${where} refused: ${error.message}`);
        return { stamp: { refused: error.message } };
      }
      say(`${LOG_PREFIX} ${where} failed: ${messageOf(error)}`);
      return null;
    }
  }

  /** Stamps a note applied with the dispatcher; false when the stamp did not take, so its card waits. */
  async function stampNote(id: number, stamp: Stamp): Promise<boolean> {
    const args = ['card', 'applied', String(id)];
    const result = stamp === null
      ? await runDispatcherCommand(commands, args)
      : await runDispatcherCommand(commands, [...args, '--result', '-'], JSON.stringify(stamp));
    if (result.exit === 0) return true;
    say(`${LOG_PREFIX} dispatcher card applied ${id} ${exitWords(result.exit)}: ${failureLine(result)}`);
    return false;
  }

  /** The notes the printout holds, or null after logging why it could not be read. */
  function readOrSay(printed: string): ReturnType<typeof readNotes> | null {
    try {
      return readNotes(printed);
    } catch (error) {
      say(`${LOG_PREFIX} dispatcher card notes unreadable: ${messageOf(error)}`);
      return null;
    }
  }

  /** One sweep; once a note of a card fails, that card's later notes wait while other cards go on. */
  async function pass(): Promise<void> {
    const listed = await runDispatcherCommand(commands, ['card', 'notes', '--json']);
    if (listed.exit !== 0) {
      say(`${LOG_PREFIX} dispatcher card notes ${exitWords(listed.exit)}: ${failureLine(listed)}`);
      return;
    }
    const read = readOrSay(listed.stdout);
    if (read === null) return;
    for (const line of read.unread) say(`${LOG_PREFIX} a note this server cannot read: ${line}`);
    const listedIds = new Set(read.notes.map((note) => note.id));
    for (const id of owedStamps.keys()) if (!listedIds.has(id)) owedStamps.delete(id);
    const held = new Set<string>();
    for (const note of read.notes) {
      const key = `${note.board}/${note.card}`;
      if (held.has(key)) continue;
      let stamp: Stamp;
      if (owedStamps.has(note.id)) {
        stamp = owedStamps.get(note.id) ?? null;
      } else {
        const outcome = tryApply(note);
        if (outcome === null) {
          held.add(key);
          continue;
        }
        stamp = outcome.stamp;
      }
      if (await stampNote(note.id, stamp)) {
        owedStamps.delete(note.id);
      } else {
        owedStamps.set(note.id, stamp);
        held.add(key);
      }
    }
  }

  /** Runs passes back to back while pokes keep arriving; a throw ends that pass, is logged, and the runner carries on. */
  async function run(): Promise<void> {
    running = true;
    try {
      do {
        again = false;
        try {
          await pass();
        } catch (error) {
          say(`${LOG_PREFIX} pass failed: ${messageOf(error)}`);
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  }

  return {
    /** Asks for a pass now; a poke during a running pass queues exactly one more. */
    poke(): void {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      void run();
    },
    /** Ends the applier: no poke starts a pass after this, and the running pass stops looping. */
    stop(): void {
      stopped = true;
    },
  };
}
