import { firstLine, runDispatcherCommand, type CommandDependencies } from '@/modules/dispatcher/index.js';
import { kanbanAttachmentsService, kanbanBoardsService, kanbanCardsService, type KanbanWriteEvent } from '@/modules/kanban/index.js';
import type { KanbanBoard, KanbanCardDetail } from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { DISPATCHER_ACTOR } from './kanban-dispatch.cards.js';
import { isPlacedTicketCreation } from './kanban-dispatch.tickets.js';
import { selfRunningBoards, todoCardIdsOf } from './kanban-dispatch.todo.js';

/**
 * The longest text field the dispatcher takes; it refuses a longer one as `card_told.TEXT_MAX`.
 * A cut card is better than an untold one, so long text is cut rather than dropped.
 */
const TEXT_CHARS_MAX = 20_000;
const CARD_GONE_STATUS = 404;
const EXIT_TOLD = 0;
const EXIT_REFUSED = 2;
/** The card fields whose change the dispatcher is told about. */
const TOLD_FIELDS: readonly string[] = ['title', 'description', 'body', 'priority'];

export type TellEvent = 'created' | 'queued' | 'updated' | 'answered' | 'stopped' | 'board-off' | 'board-on';

/**
 * The five tells that start or change work (board-on among them) need the switch on both at the write and at the send, so a
 * switch turned off while one waits in its chain withdraws it. `stopped` and `board-off` are not here:
 * they are told whatever the switch reads, because a stop is always safe and is the board's only way to
 * halt a walk already out once the switch is off.
 */
const NEEDS_AUTONOMY_AT_SEND: ReadonlySet<TellEvent> = new Set(['created', 'queued', 'updated', 'answered', 'board-on']);

/** A tell to send. Only board-off concerns the board alone; every other tell names its card too. */
type Tell =
  | { event: 'board-off'; boardId: string; actor: string }
  | { event: Exclude<TellEvent, 'board-off'>; boardId: string; cardId: string; actor: string };

type CardTell = Extract<Tell, { cardId: string }>;
type CommandResult = Awaited<ReturnType<typeof runDispatcherCommand>>;
type BoardRecord = { id: string; name: string; repos: string[] };
type CardRecord = {
  id: string;
  title: string;
  description: string;
  body: string;
  tags: KanbanCardDetail['tags'];
  priority: KanbanCardDetail['priority'];
  status: KanbanCardDetail['status'];
  archived: boolean;
  attachments: string[];
};
type AnswerRecord = { question: string; selected: string[]; other: string };

/** The JSON the dispatcher reads on stdin. `card` and `answers` appear only on card tells. */
type TellRecord = { board: BoardRecord; card?: CardRecord; answers?: AnswerRecord[] };

/**
 * Whether a card.updated write changed a field the dispatcher reads. A write that touched only
 * other fields is not worth a tell.
 */
function touchesToldField(payload: Record<string, unknown>): boolean {
  const fields: unknown = payload.fields;
  return Array.isArray(fields) && fields.some((field: unknown) => typeof field === 'string' && TOLD_FIELDS.includes(field));
}

/**
 * THE SEAM'S TABLE — the one place the seven mappings live. Each row quotes the seam line it mirrors,
 * so a change to the seam is a change to exactly one row here.
 */
const TELLS: readonly { event: TellEvent; when: (write: KanbanWriteEvent) => boolean }[] = [
  {
    event: 'created',
    when: (write) => write.kind === 'card.created',
  }, // card.created -> created
  {
    event: 'queued',
    when: (write) => write.kind === 'card.moved' && write.payload.to === 'todo',
  }, // card.moved to todo, by a person -> queued
  {
    event: 'updated',
    when: (write) => write.kind === 'card.updated' && touchesToldField(write.payload),
  }, // card.updated (title, description, body, priority) -> updated
  {
    event: 'answered',
    when: (write) => write.kind === 'question.answered' && write.card !== null && write.card.openQuestions === 0,
  }, // question.answered, no question of the card left open -> answered
  {
    event: 'stopped',
    when: (write) =>
      (write.kind === 'card.moved' && (write.payload.to === 'not_ready' || write.payload.to === 'done')) ||
      write.kind === 'card.archived',
  }, // card.moved to not_ready or done by a person; card.archived -> stopped
  {
    event: 'board-on',
    when: (write) => write.kind === 'board.updated' && write.payload.autonomy === true,
  }, // board.updated turning autonomy on -> board-on, once for each live card in To Do
  {
    event: 'board-off',
    when: (write) => (write.kind === 'board.updated' || write.kind === 'board.archived') && write.payload.autonomy === false,
  }, // board.updated turning autonomy off, or board.archived of a board that ran itself -> board-off
];

/**
 * The tell a write earns, or null when no row of the seam's table names one. The first matching row
 * wins, so the table's order is the precedence if two rows ever both hold.
 */
export function tellEventOf(write: KanbanWriteEvent): TellEvent | null {
  return TELLS.find((row) => row.when(write))?.event ?? null;
}

export type CardTellerDependencies = {
  commands: CommandDependencies;
  log: (line: string) => void;
  logError: (line: string) => void;
};

/** What the dispatch module holds of the teller: the write listener and the start's catch-up. */
export type CardTeller = {
  /**
   * The listener subscribed to `onKanbanWrite`. It decides synchronously whether a write is one to tell
   * and queues those tells, then returns: the write has already committed and must not wait for the
   * dispatcher.
   */
  onWrite: (write: KanbanWriteEvent) => void;
  /**
   * Queues board-on for every live To Do card of every self-running board and answers how many. It is
   * the catch-up for cards no switch-on reached (they entered To Do while the board was off): the
   * dispatcher queues only a card it holds withdrawn or has never heard of, so a second run queues none.
   */
  tellSelfRunningTodo: (actor: string) => number;
};

export function createCardTeller(dependencies: CardTellerDependencies): CardTeller {
  const chains = new Map<string, Promise<void>>();
  const queueAll = (tells: readonly Tell[]): number => {
    for (const tell of tells) {
      queueTell(tell, chains, dependencies);
    }
    return tells.length;
  };
  return {
    onWrite: (write) => {
      try {
        queueAll(tellsFor(write));
      } catch (error) {
        dependencies.logError(`[kanban-dispatch] could not queue a tell for ${write.kind}: ${errorMessage(error)}`);
      }
    },
    tellSelfRunningTodo: (actor) =>
      selfRunningBoards().reduce((told, board) => told + queueAll(boardOnTells(board.id, actor)), 0),
  };
}

/**
 * The tells a write earns: none, one, or for a switch turned on one board-on per live card in the
 * board's To Do. A write by the dispatcher itself, a write with no board and a card a ticket placed are
 * never told, and the tells that start work need the board's switch on at the write.
 */
function tellsFor(write: KanbanWriteEvent): Tell[] {
  if (write.actor === DISPATCHER_ACTOR || write.boardId === null || isPlacedTicketCreation(write)) {
    return [];
  }
  const event = tellEventOf(write);
  if (event === null) {
    return [];
  }
  const board = kanbanBoardsService.getBoard(write.boardId);
  if (board === null || (NEEDS_AUTONOMY_AT_SEND.has(event) && !board.autonomy)) {
    return [];
  }
  if (event === 'board-off') {
    return [{ event, boardId: write.boardId, actor: write.actor }];
  }
  if (event === 'board-on') {
    return boardOnTells(write.boardId, write.actor);
  }
  if (write.cardId === null) {
    return [];
  }
  return [{ event, boardId: write.boardId, cardId: write.cardId, actor: write.actor }];
}

/** One board-on tell per live card in the board's To Do, in the lane's order: each is work a person approved by putting it there. */
function boardOnTells(boardId: string, actor: string): CardTell[] {
  return todoCardIdsOf(boardId).map((cardId): CardTell => ({ event: 'board-on', boardId, cardId, actor }));
}

/**
 * The chain a tell queues on: one per card, and one per board for board-off and board-on. A board's
 * board-on tells share its chain, so they go out one at a time in the lane's order and a switch turned
 * off after it was turned on is told after them.
 */
function chainKeyOf(tell: Tell): string {
  return tell.event === 'board-off' || tell.event === 'board-on' ? `board ${tell.boardId}` : `card ${tell.cardId}`;
}

/** The subject a log line names: `<board>/<card>`, or `board <board>` for board-off. */
function subjectOf(tell: Tell): string {
  return tell.event === 'board-off' ? `board ${tell.boardId}` : `${tell.boardId}/${tell.cardId}`;
}

/**
 * Queues a tell behind the previous tell of the same subject, so the dispatcher hears them in the
 * order the writes happened. The entry removes itself once its tell ends, unless a later tell has
 * already replaced it. The catch keeps one failed tell from breaking the chain behind it.
 */
function queueTell(tell: Tell, chains: Map<string, Promise<void>>, dependencies: CardTellerDependencies): void {
  const key = chainKeyOf(tell);
  const turn = (chains.get(key) ?? Promise.resolve())
    .then(() => sendTell(tell, dependencies))
    .catch((error: unknown) => {
      dependencies.logError(`[kanban-dispatch] ${tell.event} for ${subjectOf(tell)} failed: ${errorMessage(error)}`);
    });
  const entry: Promise<void> = turn.then(() => {
    if (chains.get(key) === entry) {
      chains.delete(key);
    }
  });
  chains.set(key, entry);
}

/**
 * Sends one tell, or nothing when the board is gone. The four tells that start or change work
 * (NEEDS_AUTONOMY_AT_SEND) need the switch on at the send too, so a switch turned off while one of them
 * waited in its chain withdraws it. `stopped` and `board-off` are sent whatever the switch reads, because
 * a stop is always safe and is the board's only way to halt a walk already out once the switch is off.
 */
async function sendTell(tell: Tell, dependencies: CardTellerDependencies): Promise<void> {
  const board = kanbanBoardsService.getBoard(tell.boardId);
  if (board === null || (NEEDS_AUTONOMY_AT_SEND.has(tell.event) && !board.autonomy)) {
    return;
  }
  const record = tell.event === 'board-off' ? { board: boardOf(board) } : recordOf(board, tell);
  if (record === null) {
    return;
  }
  const result = await runDispatcherCommand(
    dependencies.commands,
    ['card', 'told', '--event', tell.event, '--by', tell.actor],
    JSON.stringify(record),
  );
  reportResult(tell, result, dependencies);
}

/** The record for a card tell; null when the card is gone, since there is then nothing to tell. */
function recordOf(board: KanbanBoard, tell: CardTell): TellRecord | null {
  const card = readCard(tell.cardId);
  if (card === null) {
    return null;
  }
  const base = { board: boardOf(board), card: cardOf(card) };
  return tell.event === 'answered' ? { ...base, answers: answersOf(card) } : base;
}

/**
 * The card read whole, or null when it has been deleted. Any other failure is thrown on, so the
 * chain reports it instead of sending a tell about a card it could not read.
 */
function readCard(cardId: string): KanbanCardDetail | null {
  try {
    return kanbanCardsService.getCard(cardId);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === CARD_GONE_STATUS) {
      return null;
    }
    throw error;
  }
}

function boardOf(board: KanbanBoard): BoardRecord {
  return { id: board.id, name: board.name, repos: board.repos };
}

/** The card as the dispatcher reads it: long text cut, and attachments as the files they resolve to. */
function cardOf(card: KanbanCardDetail): CardRecord {
  return {
    id: card.id,
    title: cutText(card.title),
    description: cutText(card.description),
    body: cutText(card.body),
    tags: card.tags,
    priority: card.priority,
    status: card.status,
    archived: card.archived,
    attachments: attachmentPaths(card.id, card.attachments),
  };
}

/** The absolute paths of a card's attachments; one that resolves to no file is left out. */
function attachmentPaths(cardId: string, attachments: readonly { id: string }[]): string[] {
  return attachments.flatMap((attachment): string[] => {
    const file = kanbanAttachmentsService.resolveAttachmentFile(cardId, attachment.id);
    return file === null ? [] : [file.path];
  });
}

/**
 * Cuts text to TEXT_CHARS_MAX code points. A string already within the cap in UTF-16 units is within
 * it in code points too, so it passes through without being split.
 */
function cutText(text: string): string {
  if (text.length <= TEXT_CHARS_MAX) {
    return text;
  }
  return Array.from(text).slice(0, TEXT_CHARS_MAX).join('');
}

/** Every answered question of the card, with its text and the answer given. */
function answersOf(card: KanbanCardDetail): AnswerRecord[] {
  return card.questions
    .filter((question) => question.answered)
    .map((question) => ({
      question: cutText(question.text),
      selected: question.selected,
      other: cutText(question.other),
    }));
}

/**
 * Logs how the dispatcher answered. Exit 0 is success. Exit 2 is a refusal with its reason on stdout.
 * Any other exit is a failure, and stderr, or stdout when stderr is silent, says why.
 */
function reportResult(tell: Tell, result: CommandResult, dependencies: CardTellerDependencies): void {
  const subject = subjectOf(tell);
  if (result.exit === EXIT_TOLD) {
    dependencies.log(`[kanban-dispatch] ${firstLine(result.stdout)}`);
    return;
  }
  if (result.exit === EXIT_REFUSED) {
    dependencies.logError(`[kanban-dispatch] the dispatcher refused ${tell.event} for ${subject}: ${firstLine(result.stdout)}`);
    return;
  }
  const exit = result.exit === null ? 'did not answer' : `exited ${result.exit}`;
  const detail = firstLine(result.stderr) || firstLine(result.stdout);
  dependencies.logError(`[kanban-dispatch] the dispatcher ${exit} while telling ${tell.event} for ${subject}: ${detail}`);
}

/** The message of whatever was thrown, so a log line keeps the reason whatever the throw was. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
