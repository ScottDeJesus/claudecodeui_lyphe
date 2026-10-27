import { randomUUID } from 'node:crypto';

import type { SDKMessage, SDKUserMessage, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionModel, CompanionProcess } from '@/shared/companion-types.js';

import { operatorEnvelope } from './companion-envelopes.js';
import { failureSentence, readLoopEvent, type CompanionLoopEvent } from './companion-events.js';
import { resumableSessionId, unexpectedTools } from './companion-launch.js';
import { createMessageAssembler, type MessageReaders } from './companion-message.js';
import { launchCompanionCli, type CompanionCli } from './companion-process.js';
import { createTurnTracker, type TurnSink } from './companion-turns.js';

/**
 * One account's live conversation with her: a single streaming-input `query()` held open (the CLI
 * process is `companion-process.ts`, launched like the Cerberus diagnosis agent by `companion-launch.ts`),
 * persisted and resumed. What a CLI message means is `companion-events.ts`, which result ends which turn
 * is `companion-turns.ts`, how a message is put together is `companion-message.ts`.
 *
 * ASLEEP until a push wakes it (`waking`, then `awake` at the launch's first `init`); her CLI session id is
 * stored at `init` and every later launch passes it as `resume`. A resume the CLI refuses clears the
 * stored id, writes one system line and launches once more without it, carrying the messages that were
 * waiting. Every other failure sets the process `failed` with a sentence and a system line — her own
 * failures are shown, never spoken (ruling 17) — and the next push launches again. Nothing polls.
 *
 * Consumers: `companion.service.ts` (one session per account, behind the routes and the feeds) and the voice.
 */

/**
 * Everything one account's session needs from the house, so the session reads nothing itself: the
 * account (`userId` names her working directory), her `tools` (the definitions her MCP server carries;
 * none is valid), the held CLI session id with its writer, the readers every message is assembled from
 * (`MessageReaders`) and the callbacks that tell the house what she did (`TurnSink`, `onProcess` for the
 * process's condition, `onSystemLine` for a line the panel shows in its own tone). A callback that
 * throws is logged and the conversation goes on. Consumed by `companion.service.ts`, which fills it.
 */
export type CompanionSessionDeps = MessageReaders &
  TurnSink & {
    userId: number;
    tools: Array<SdkMcpToolDefinition<any>>;
    readProviderSessionId(): string | null;
    writeProviderSessionId(id: string | null): void;
    onProcess(process: CompanionProcess): void;
    onSystemLine(text: string): void;
  };

/**
 * The surface of her conversation. The three pushes each assemble and push ONE message, start a turn
 * when she is idle and wake a closed process; `oweCut` stores the cut the next message opens with;
 * `interrupt` stops her turn (her Stop, or the voice's cut); `setModel` applies a model change to a
 * running process (a closed one launches on the stored model); `clear` interrupts, closes and forgets
 * the held session id; `close` ends the input and the process. `process` is the condition the panel
 * shows and `turnId` the turn in flight (`null` when idle). Consumed by `companion.service.ts` and the voice.
 */
export type CompanionSession = {
  pushOperator(text: string, via: 'typed' | 'spoken'): void;
  pushAlerts(blocks: string[]): void;
  pushFocusNews(envelope: string): void;
  oweCut(heardSentence: string | null): void;
  interrupt(): Promise<void>;
  setModel(model: CompanionModel): Promise<void>;
  clear(): Promise<void>;
  close(reason: string): Promise<void>;
  readonly process: CompanionProcess;
  readonly turnId: string | null;
};

/** One launch and what the conversation has learned of it: whether its first `init` has been seen (the process is up) and whether the CLI refused its `resume`. */
type Launch = { cli: CompanionCli; initSeen: boolean; resumeRefused: boolean };

/** A callback that throws is logged with its account and swallowed: a store error must not end her conversation. */
function guarded<Args extends unknown[]>(label: string, userId: number, callback: (...args: Args) => void): (...args: Args) => void {
  return (...args) => {
    try {
      callback(...args);
    } catch (error) {
      console.error(`[Companion] account ${userId}: the ${label} callback threw`, error);
    }
  };
}

/** Consumed by `companion.service.ts`: one call per account, made lazily on the account's first use. */
export function createCompanionSession(deps: CompanionSessionDeps): CompanionSession {
  const { userId } = deps;
  const onProcess = guarded('process', userId, deps.onProcess);
  const onSystemLine = guarded('system line', userId, deps.onSystemLine);
  const writeProviderSessionId = guarded('session id writer', userId, deps.writeProviderSessionId);
  const turns = createTurnTracker({
    onSentence: guarded('sentence', userId, deps.onSentence),
    onTurnStarted: guarded('turn start', userId, deps.onTurnStarted),
    onTurnEnded: guarded('turn end', userId, deps.onTurnEnded),
    onActivity: guarded('activity', userId, deps.onActivity),
  });
  const assembler = createMessageAssembler(deps);

  let live: Launch | null = null;
  let condition: CompanionProcess = { state: 'asleep', error: null };
  // Every message pushed and not yet consumed by a result, so a launch that is refused can carry them to the next.
  const unanswered = new Map<string, SDKUserMessage>();

  function setCondition(next: CompanionProcess): void {
    if (condition.state === next.state && condition.error === next.error) return;
    condition = next;
    onProcess(next);
  }

  /** Ends this launch for good: the CLI is killed, whatever it was doing, and `live` is no longer it. */
  function retire(launch: Launch): void {
    if (live === launch) live = null;
    launch.cli.kill();
  }

  /** A failure of her own: shown on the panel as one sentence, never spoken. The next push launches again. */
  function fail(launch: Launch, sentence: string): void {
    console.error(`[Companion] account ${userId}: ${sentence}`);
    retire(launch);
    unanswered.clear();
    turns.release('failed', sentence);
    setCondition({ state: 'failed', error: sentence });
    onSystemLine(sentence);
  }

  function onInit(launch: Launch, event: Extract<CompanionLoopEvent, { kind: 'init' }>): void {
    const strangers = unexpectedTools(event.tools, deps.tools);
    if (strangers.length > 0) {
      // Before the model sees a turn: the session is not the one that was asked for.
      fail(launch, `Her session held tools it should not have (${strangers.join(', ')}), so it was not run.`);
      return;
    }
    if (deps.readProviderSessionId() !== event.sessionId) writeProviderSessionId(event.sessionId);
    if (launch.initSeen) return;
    launch.initSeen = true;
    setCondition({ state: 'awake', error: null });
    console.log(
      `[Companion] account ${userId}: ${launch.cli.resume ? 'resumed' : 'started'} session ${event.sessionId} on ${event.model}; the CLI listed ${event.tools.length} tools, all hers${event.tools.length > 0 ? ` (${event.tools.join(', ')})` : ''}`
    );
  }

  function onResult(launch: Launch, event: Extract<CompanionLoopEvent, { kind: 'result' }>): void {
    for (const uuid of event.answered) unanswered.delete(uuid);
    if (event.resumeRefused) {
      // The iterator throws right after this result; the launch is replaced once it does.
      launch.resumeRefused = true;
      return;
    }
    // A failed result ends the turn failed, and the process with it: the next push relaunches on a fresh account env.
    if (turns.result(event.answered, event.failure) === 'live' && event.failure !== null) fail(launch, event.failure);
  }

  function handle(launch: Launch, message: SDKMessage): void {
    const event = readLoopEvent(message);
    if (event === null) return;
    if (event.kind === 'init') onInit(launch, event);
    else if (event.kind === 'text') turns.text(event.delta);
    else if (event.kind === 'block_end') turns.blockEnded();
    else if (event.kind === 'compacted') assembler.oweState();
    else onResult(launch, event);
  }

  /** The launch ended on its own: a refused resume is replaced by a fresh launch, anything else is a failure. */
  function conclude(launch: Launch, thrown: unknown): void {
    const reason = thrown === null ? null : thrown instanceof Error ? thrown.message : String(thrown);
    const resume = launch.cli.resume;
    if (resume !== null && (launch.resumeRefused || (reason !== null && /No conversation found/i.test(reason)))) {
      console.warn(`[Companion] account ${userId}: the CLI has no conversation ${resume}; she starts fresh`);
      retire(launch);
      writeProviderSessionId(null);
      onSystemLine('Her memory could not be resumed; she starts fresh');
      // Her memory of the focus, the draft and the walk went with the conversation; the next message restates them.
      assembler.oweState();
      live = open([...unanswered.values()], null);
      return;
    }
    fail(launch, reason === null ? 'Her process ended without being asked to.' : failureSentence('Her process stopped', reason));
  }

  /** Starts a launch with `initial` already queued; she is `waking` until its first `init`. */
  function open(initial: SDKUserMessage[], resume: string | null): Launch {
    const launch: Launch = {
      cli: launchCompanionCli({
        userId,
        initial,
        resume,
        readSettings: deps.readSettings,
        tools: deps.tools,
        // A turn in flight is the only busy there is: she has no background task and no watcher.
        isBusy: () => turns.turnId !== null,
        // A launch that has been detached (closed, cleared, replaced) is drained unheard: its late words are nobody's turn.
        onMessage: (message) => {
          if (live === launch) handle(launch, message);
        },
        onEnded: (thrown) => {
          if (live === launch) conclude(launch, thrown);
        },
        onIdleClose: () => void closeProcess('idle'),
      }),
      initSeen: false,
      resumeRefused: false,
    };
    setCondition({ state: 'waking', error: null });
    return launch;
  }

  /**
   * Takes the launch out of the conversation at once and leaves her asleep: from here a push is a wake, and
   * the launch is the caller's to wind down. Synchronous on purpose — winding down can take the whole grace,
   * and a message that lands in it must start a new process, not join the one that is going.
   */
  function detach(reason: string): Launch | null {
    const ending = live;
    if (ending === null) return null;
    console.log(`[Companion] account ${userId}: closing her process (${reason})`);
    live = null;
    unanswered.clear();
    turns.release('stopped', null);
    setCondition({ state: 'asleep', error: null });
    return ending;
  }

  /** Ends the input and the process, waits for it to wind down, and leaves her asleep. */
  async function closeProcess(reason: string): Promise<void> {
    await detach(reason)?.cli.close();
  }

  /** Assembles one message around `body` and pushes it: the turn starts if she is idle, the process wakes if it is closed. */
  function push(body: string): void {
    const woke = live === null;
    // Read and assembled before anything is started, so a reader that throws leaves no half-woken process or turn behind.
    const held = woke ? deps.readProviderSessionId() : null;
    const resume = resumableSessionId(held);
    if (held !== null && resume === null) console.warn(`[Companion] account ${userId}: the held session id is not a UUID; she starts fresh`);
    const content = assembler.assemble(body, woke);
    // The uuid is how the CLI's `result` tells us which of our messages it answered (`companion-turns.ts`).
    const uuid = randomUUID();
    const message: SDKUserMessage = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid };
    unanswered.set(uuid, message);
    turns.admit(uuid);
    if (live === null) live = open([message], resume);
    else live.cli.push(message);
  }

  async function interrupt(): Promise<void> {
    const target = live;
    if (!turns.stop() || target === null) return;
    // Still being built: there is no turn in the CLI to interrupt, so the launch is what stops.
    if (!target.cli.up) {
      await closeProcess('stopped before her process was up');
      return;
    }
    const answer = await target.cli.interrupt();
    if (live !== target) return;
    if (answer === 'unanswered') {
      // A CLI that ignores an interrupt would ignore the next message too: it is replaced, not waited on.
      await closeProcess('her process did not answer the interrupt');
      return;
    }
    // Messages still queued behind the stopped turn run as a turn of their own.
    turns.adopt(answer.stillQueued);
  }

  return {
    pushOperator(text, via) {
      push(operatorEnvelope(text, via));
    },
    pushAlerts(blocks) {
      if (blocks.length > 0) push(blocks.join('\n'));
    },
    pushFocusNews(envelope) {
      push(envelope);
    },
    oweCut(heardSentence) {
      assembler.oweCut(heardSentence);
    },
    interrupt,
    async setModel(model) {
      // A closed process launches on the stored model, so there is nothing to apply.
      await live?.cli.setModel(model);
    },
    async clear() {
      // She forgets before anything is awaited and the old launch is detached at once: a push that lands
      // while it winds down is a wake into a fresh conversation, never a resume of the one being cleared.
      writeProviderSessionId(null);
      assembler.forget();
      const ending = detach('cleared');
      // A turn in flight is stopped now, not at the end of the grace.
      if (ending?.cli.up) await ending.cli.interrupt();
      await ending?.cli.close();
      // A failed process has no launch to detach and is asleep once cleared; a push that already woke a new one is not overwritten.
      if (live === null) setCondition({ state: 'asleep', error: null });
    },
    close: closeProcess,
    get process() {
      return condition;
    },
    get turnId() {
      return turns.turnId;
    },
  };
}
