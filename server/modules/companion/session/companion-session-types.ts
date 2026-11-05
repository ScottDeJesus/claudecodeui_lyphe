import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionAttachment, CompanionModel, CompanionProcess } from '@/shared/companion-types.js';
import type { ClaudeImageBlock } from '@/shared/image-attachments.js';

import type { UnansweredMessage } from '../companion-unanswered.js';

import type { StopSource } from './companion-ledger.js';
import type { LastWords } from './companion-handover.js';
import type { MessageReaders } from './companion-message.js';
import type { CompanionCli, CompanionCliLaunch } from './companion-process.js';
import type { TurnSink } from './companion-turns.js';

/**
 * The CLI conversation an account holds: its `id`, and the `shape` (`companion-shape.ts`: her tools, prompt and model provider) it began with, which is
 * `null` for a conversation begun before shapes were kept. Consumed by `companion-session.ts` (resumes only a conversation whose shape
 * is the launch's own) and by `companion-account.ts`, which reads and writes it through the store.
 */
export type HeldSession = { id: string; shape: string | null };

/**
 * Everything one account's session needs from the house, so the session reads nothing itself: the
 * account (`userId` names her working directory), her `tools` (the definitions her MCP server carries;
 * none is valid), the held conversation (`HeldSession`: the CLI session id and its shape) with its writer, the handover of one she is made to
 * drop (`writeHandover`, and the newest exchange the summarizer is not shown, `readLastWords`), the messages of his she has not answered with
 * theirs (`readUnanswered` when the session is made — a previous process left them — and again before each write and the takeover's resend, to
 * see what the other process of a handover did to the row meanwhile; `writeUnanswered` after every change to the list, so it is on disk before the CLI could lose it), the readers every message is
 * assembled from (`MessageReaders`) and the callbacks that tell the house what she did (`TurnSink`, `onProcess` for the
 * process's condition, `onSystemLine` for a line the panel shows in its own tone). A callback that
 * throws is logged and the conversation goes on. `launch` starts one CLI and is the real launcher unless a
 * stand-in replaces it. Consumed by `companion-account.ts`, which fills it.
 */
export type CompanionSessionDeps = MessageReaders &
  TurnSink & {
    userId: number;
    tools: Array<SdkMcpToolDefinition<any>>;
    readProviderSession(): HeldSession | null;
    /** Stores the conversation with the shape it begins with, or `null` to forget it (Clear, a conversation that cannot be resumed); id and shape are written together. */
    writeProviderSession(session: { id: string; shape: string } | null): void;
    /** Stores the handover of a conversation the refused resume drops, on her row, for the first message after the fresh start (`readHandover`, in `MessageReaders`, reads it from there). */
    writeHandover(text: string): void;
    /** Empties the stored handover: the launch that was handed it is up, or Clear. */
    dropHandover(): void;
    /** Her newest exchange as her log holds it (`null` when she has said nothing): the summarizer is not shown it, so the handover's instructions carry it. */
    readLastWords(): LastWords | null;
    readUnanswered(): UnansweredMessage[];
    writeUnanswered(unanswered: UnansweredMessage[]): void;
    launch?(input: CompanionCliLaunch): CompanionCli;
    /** True for a session born beside a predecessor that still answers (a handover boot): every push is held until the takeover's `resendUnanswered` (`companion-restart.ts`). Absent is false. */
    awaitingTakeover?: boolean;
    onProcess(process: CompanionProcess): void;
    onSystemLine(text: string): void;
    /** A turn of hers is in flight or is not, her last turn included (which `onTurnStarted` and `onTurnEnded` keep from the page). The house holds a dev-server restart while one runs. A stand-in may leave it out. */
    onTurnInFlight?(inFlight: boolean): void;
    /** Words of his reached her — typed, spoken, or a press that carried none: the house holds a dev-server restart for a while after. A stand-in may leave it out. */
    onHisWords?(): void;
  };

/**
 * One alert as the session takes it. `envelope` is the `<alert>` block she is told. `owed`, when the alert is about a prompt that can be
 * answered (an Accept, a chat's tool permission), answers whether it is STILL open: it is asked at the last moment, when the message is
 * given to the CLI, and an alert that is no longer owed is dropped silently (`companion-alert-hold.ts`); an alert with no `owed` (a failure,
 * a landing) cannot be answered and is always said. `told` is called once, when the alert goes into her message, so the panel's row
 * records what she was told and never an alert that was dropped. Consumed by `companion.service.ts` (builds them from the feed's alerts),
 * `companion-alert-hold.ts` and `companion-session.ts` (`pushAlerts`).
 */
export type SessionAlert = { envelope: string; owed?(): boolean; told(): void };

/**
 * The surface of her conversation. The five pushes each assemble and push ONE message, start a turn
 * when she is idle and wake a closed process (`pushOperatorEmpty` is a press that carried no words she could hear:
 * `<operator via="spoken" heard="nothing">`, and `pushOperatorCalled` a press that was only her name:
 * `<operator via="spoken" heard="name">`, each still a turn she answers); `warm` starts the process of a closed one ahead of its first
 * message and pushes nothing (the CLI takes about a second to come up, which a caller that knows a push is
 * coming in seconds spends in parallel); `resendUnanswered` pushes again, each as a fresh message, the words of his that her last
 * process was given and never answered (the entrypoint calls it once the server is the sole one on the port), and answers a promise: a line
 * that carried a picture has it read again from the upload store first, while that happens a new push waits behind the replay and goes after
 * it, and the promise settles once the replay has pushed its messages (with no picture to read it has pushed them all before it answers);
 * `pushOperator`'s `attached` is what a typed line carried: the records of his files (kept with his words) and the picture blocks read from
 * them (held in memory only, beside the message), which a typed line with files and no words is allowed to have; `oweCut` stores the cut the next message opens with (the last sentence he heard to its end, and the one playing at the press);
 * `interrupt` stops her turn (`by` is who stopped it: the operator, by his Stop or the voice's cut, which is the default, or the
 * server, in a shutdown) and holds what is pushed until the stopped turn's result is in, so his next words cannot be folded into
 * the aborted request; `setModel` applies a model change to a
 * running process (a closed one launches on the stored model); `clear` interrupts, closes and forgets
 * the held session (its id and its shape); `close` ends the input and the process. `process` is the condition the panel
 * shows and `turnId` the turn in flight (`null` when idle); `inLastTurn` is true while her last turn runs (the one that closes her
 * conversation: her tools read it to open only `recall` and `remember`, and the session keeps that turn off the page). Consumed by
 * `companion.service.ts` and the voice, and by `companion-account.ts`, which binds her tools' gate to `inLastTurn`.
 */
export type CompanionSession = {
  pushOperator(text: string, via: 'typed' | 'spoken', attached?: { attachments: CompanionAttachment[]; images: ClaudeImageBlock[] }): void;
  pushOperatorEmpty(): void;
  /** A name press with nothing after her name: `<operator via="spoken" heard="name">`, a turn she answers as someone called by name does. Kept with his unanswered words as `heard: 'name'`, so a replay sends it again as a call. Consumed by `companion-press.ts`. */
  pushOperatorCalled(): void;
  /** One message of the alerts the feed gathered, read at the last moment: an alert answered by then is dropped (`SessionAlert.owed`), and while a turn of hers is in flight the alerts that can be answered wait for it to end (the others go at once). `[]` pushes nothing. */
  pushAlerts(alerts: SessionAlert[]): void;
  pushFocusNews(envelope: string): void;
  warm(): void;
  resendUnanswered(): Promise<void>;
  /** The server is stopping: resolves when the turn in flight has ended, at `boundMs`, or at once when there is none (or it is her last turn). Closes nothing; `interrupt` and `close` follow. */
  finishTurn(boundMs: number): Promise<void>;
  oweCut(heard: string | null, interrupted: string | null): void;
  interrupt(by?: StopSource): Promise<void>;
  setModel(model: CompanionModel): Promise<void>;
  clear(): Promise<void>;
  close(reason: string): Promise<void>;
  readonly process: CompanionProcess;
  readonly turnId: string | null;
  /** True while her last turn runs. Her tools read it (`CompanionToolDeps.inLastTurn`) and the session keeps that turn off the page: no frame, no log row, no speech. */
  readonly inLastTurn: boolean;
};
