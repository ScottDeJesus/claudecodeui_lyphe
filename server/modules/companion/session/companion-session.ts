import { randomUUID } from 'node:crypto';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionProcess } from '@/shared/companion-types.js';

import type { UnansweredMessage } from '../companion-unanswered.js';

import { emptyPressEnvelope, operatorEnvelope } from './companion-envelopes.js';
import { failureSentence, readLoopEvent, type CompanionLoopEvent } from './companion-events.js';
import { resumableSessionId, unexpectedTools } from './companion-launch.js';
import { createLedger, type Sent, type StopSource } from './companion-ledger.js';
import { createMessageAssembler } from './companion-message.js';
import { answeredWithin, CLI_GRACE_MS, launchCompanionCli, type CompanionCli } from './companion-process.js';
import type { CompanionSession, CompanionSessionDeps } from './companion-session-types.js';
import { createTurnTracker } from './companion-turns.js';
import { guarded } from './guarded-callback.js';

/**
 * One account's live conversation with her: a single streaming-input `query()` held open (the CLI
 * process is `companion-process.ts`, launched like the Cerberus diagnosis agent by `companion-launch.ts`),
 * persisted and resumed. What a CLI message means is `companion-events.ts`, which result ends which turn
 * is `companion-turns.ts`, how a message is put together is `companion-message.ts`, which messages are still owed an
 * answer is `companion-ledger.ts`.
 *
 * ASLEEP until a push wakes it (`waking`, then `awake` at the launch's first `init`); her CLI session id is
 * stored at `init` and every later launch passes it as `resume`. A resume the CLI refuses clears the
 * stored id, writes one system line and launches once more without it, carrying the messages that were
 * waiting. Every other failure sets the process `failed` with a sentence and a system line — her own
 * failures are shown, never spoken (ruling 17) — and the next push launches again. Nothing polls.
 *
 * HIS WORDS SURVIVE THE PROCESS. A message of his is stored with its raw text the moment it is pushed and stays stored
 * until a turn answers it, a failure drops it, Clear, or he cuts the answer it was in on purpose. A process that ends
 * first (a server handover is the usual way) leaves it for the next one: a new session finds it at birth and, when told
 * (`resendUnanswered`), pushes it again — new uuid, assembled afresh, in order — so her first turn answers it. It is told
 * only once the server is the sole one on the port (the entrypoint's takeover duties): a predecessor that is still serving
 * may be answering the same words, and two processes must not both say them to her.
 *
 * A STOP IS ANSWERED BEFORE ANYTHING ELSE IS SAID. From the moment `interrupt` starts until the stopped turn's
 * `result` is in, a push is held, not given to the CLI: a message that reaches the CLI while it unwinds an interrupt can be
 * folded into the request being aborted, and then nothing ever answers it. The held words are given, in order, once the result
 * is in. That result lists the messages the aborted request held: his own cut or Stop drops them (he did not want that answer),
 * a server stop or a message pushed after the stop pushes them again. A message the CLI had before the stop that the result does
 * not list was never in the aborted request; the CLI runs it as a turn of its own, and the session lets it.
 *
 * Consumers: `companion-account.ts` (one session per account, behind the routes and the feeds) and the voice.
 */

/** One launch and what the conversation has learned of it: whether its first `init` has been seen (the process is up), whether the CLI refused its `resume`, and whether it holds a message yet (a `warm` launch does not). */
type Launch = { cli: CompanionCli; initSeen: boolean; resumeRefused: boolean; messaged: boolean };

/** A stop whose turn has not yet reported its result: the launch concerned, a promise that settles when the wait is over and the way to settle it. */
type Stop = { launch: Launch; over: Promise<void>; end(): void };

/** His words as an envelope: the empty press is its own tag. */
const wordsEnvelope = (words: { body: string; via: 'typed' | 'spoken' }): string =>
  words.body === '' && words.via === 'spoken' ? emptyPressEnvelope() : operatorEnvelope(words.body, words.via);

/** Consumed by `companion-account.ts`: one call per account, made lazily on the account's first use. */
export function createCompanionSession(deps: CompanionSessionDeps): CompanionSession {
  const { userId } = deps;
  const launchCli = deps.launch ?? launchCompanionCli;
  const onProcess = guarded('process', userId, deps.onProcess);
  const onSystemLine = guarded('system line', userId, deps.onSystemLine);
  const writeProviderSessionId = guarded('session id writer', userId, deps.writeProviderSessionId);
  const turns = createTurnTracker(
    {
      onSentence: guarded('sentence', userId, deps.onSentence),
      onTurnStarted: guarded('turn start', userId, deps.onTurnStarted),
      onTurnEnded: guarded('turn end', userId, deps.onTurnEnded),
      onActivity: guarded('activity', userId, deps.onActivity),
    },
    // The account's sound-tag list, read each time a turn begins: that turn's sentences are parsed by it.
    deps.readSoundTags,
  );
  const assembler = createMessageAssembler(deps);
  const ledger = createLedger(userId, readInherited(), deps.writeUnanswered);

  let live: Launch | null = null;
  let condition: CompanionProcess = { state: 'asleep', error: null };
  // Set from the moment a stop starts until its turn's result is in: a push is held while it stands.
  let stopping: Stop | null = null;

  /** What a previous process left unanswered; a row that cannot be read is none, so the conversation still starts. */
  function readInherited(): UnansweredMessage[] {
    try {
      return deps.readUnanswered();
    } catch (error) {
      console.error(`[Companion] account ${userId}: the messages her last process never answered could not be read`, error);
      return [];
    }
  }

  function setCondition(next: CompanionProcess): void {
    if (condition.state === next.state && condition.error === next.error) return;
    condition = next;
    onProcess(next);
  }

  /** The wait for a stopped turn's result is over: whoever awaits it (`interrupt`) is woken, and a push is given to the CLI again. */
  function closeStop(): void {
    const ended = stopping;
    stopping = null;
    ended?.end();
  }

  /** Ends this launch for good: the CLI is killed, whatever it was doing, and `live` is no longer it. */
  function retire(launch: Launch): void {
    if (live === launch) live = null;
    if (stopping?.launch === launch) closeStop();
    launch.cli.kill();
  }

  /** A failure of her own: shown on the panel as one sentence, never spoken. The next push launches again. */
  function fail(launch: Launch, sentence: string): void {
    console.error(`[Companion] account ${userId}: ${sentence}`);
    retire(launch);
    // A message that makes her fail must not be sent again to fail again.
    ledger.fail();
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

  /** The same message under a new uuid, for the CLI that is to be told it again. His words are assembled afresh (the roster and the view in the old message are a snapshot); a message that cannot be goes as it was. */
  function restate(sent: Sent): Sent {
    const uuid = randomUUID();
    let content = sent.message.message.content;
    if (sent.words !== null) {
      try {
        content = assembler.assemble(wordsEnvelope(sent.words), false);
      } catch (error) {
        console.error(`[Companion] account ${userId}: a message of his could not be assembled again; it is sent as it was`, error);
      }
    }
    return { ...sent, uuid, message: { ...sent.message, uuid, message: { ...sent.message.message, content } }, stoppedBy: null };
  }

  /** Gives one recorded message to the live launch: the turn starts if she is idle, or the message joins the one in flight. */
  function dispatch(sent: Sent): void {
    turns.admit(sent.uuid);
    if (live === null) return;
    live.cli.push(sent.message);
    live.messaged = true;
  }

  /** The wait is over: `first` (messages to say again) is given to the CLI, then the words held behind the stop, in the order they were pushed. */
  function finishStop(first: Sent[]): void {
    closeStop();
    for (const sent of first) ledger.give(sent);
    for (const sent of [...first, ...ledger.release()]) dispatch(sent);
  }

  function onResult(launch: Launch, event: Extract<CompanionLoopEvent, { kind: 'result' }>): void {
    if (event.resumeRefused) {
      // The iterator throws right after this result; the launch is replaced once it does.
      launch.resumeRefused = true;
      return;
    }
    const stopStands = stopping?.launch === launch;
    // A result that lists nothing is the turn in flight's (`companion-turns.ts`). When it succeeds it consumed what that turn took; left
    // listed nowhere, those messages would stay stored and be answered again at every boot.
    const answered = event.answered.length === 0 && event.failure === null && !stopStands ? turns.inFlightUuids() : event.answered;
    const listed = ledger.take(answered);
    // A result that lists a message of a stopped turn is the request that was aborted; so is the first result that lists nothing while a
    // stop stands (it is the stopped turn's, which has no turn in flight to be read as). The CLI reports it as a failure, which it is not
    // (the interrupt asked for it), so it never fails her — and the words held behind the stop, which never reached the CLI, are not lost
    // with it; a CLI that is really failing fails the next turn, which lists its message. What the result lists is his cut (dropped) or the
    // server's (said again), and a message pushed after the stop that the CLI folded into the abort was never answered (said again).
    const aborted = listed.some((sent) => sent.stoppedBy !== null) || (stopStands && answered.length === 0);
    // A failed result ends the turn failed, and the process with it: the next push relaunches on a fresh account env.
    if (turns.result(answered, aborted ? null : event.failure) === 'live' && !aborted && event.failure !== null) {
      fail(launch, event.failure);
      return;
    }
    // A message the same stop marked and this result did not list was never part of the aborted request: the CLI runs it as a turn of its own.
    const stranded = ledger.strandedBy(listed);
    if (stranded.length > 0) {
      ledger.unmarkStopped(stranded);
      turns.adopt(stranded);
    }
    finishStop(aborted ? listed.filter((sent) => sent.stoppedBy !== 'operator').map(restate) : []);
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

  /** The messages `carried` are the first of a new launch: each joins the turn in flight or starts one. */
  function startWith(carried: Sent[], resume: string | null): void {
    for (const sent of carried) turns.admit(sent.uuid);
    live = open(carried.map((sent) => sent.message), resume);
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
      startWith(ledger.carry(), null);
      return;
    }
    fail(launch, reason === null ? 'Her process ended without being asked to.' : failureSentence('Her process stopped', reason));
  }

  /** Starts a launch with `initial` already queued; she is `waking` until its first `init`. */
  function open(initial: Array<Sent['message']>, resume: string | null): Launch {
    const launch: Launch = {
      cli: launchCli({
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
      messaged: initial.length > 0,
    };
    setCondition({ state: 'waking', error: null });
    return launch;
  }

  /**
   * Takes the launch out of the conversation at once and leaves her asleep: from here a push is a wake, and
   * the launch is the caller's to wind down. Synchronous on purpose — winding down can take the whole grace,
   * and a message that lands in it must start a new process, not join the one that is going.
   * What was never answered stays his: the next process is sent it (`ledger.handOff`).
   */
  function detach(reason: string): Launch | null {
    const ending = live;
    if (ending === null) return null;
    console.log(`[Companion] account ${userId}: closing her process (${reason})`);
    live = null;
    closeStop();
    ledger.handOff();
    turns.release('stopped', null);
    setCondition({ state: 'asleep', error: null });
    return ending;
  }

  /** Ends the input and the process, waits for it to wind down, and leaves her asleep. */
  async function closeProcess(reason: string): Promise<void> {
    await detach(reason)?.cli.close();
  }

  /** The CLI conversation a new launch continues: the held id when it is a UUID, else none (she starts fresh, and it is said). */
  function resumeForLaunch(): string | null {
    const held = deps.readProviderSessionId();
    const resume = resumableSessionId(held);
    if (held !== null && resume === null) console.warn(`[Companion] account ${userId}: the held session id is not a UUID; she starts fresh`);
    return resume;
  }

  /** Says to her again what her last process was given and never answered, each as a fresh message that replaces its entry: a restart storm leaves one entry and gets one answer. */
  function resendUnanswered(): void {
    const entries = [...ledger.inherited()];
    if (entries.length === 0) return;
    console.log(`[Companion] account ${userId}: re-sending ${entries.length} message(s) her last process never answered`);
    for (const entry of entries) {
      try {
        push(wordsEnvelope(entry), { body: entry.body, via: entry.via, at: entry.at, cut: entry.cut }, entry);
      } catch (error) {
        // Left in the list, it is tried again at the next boot.
        console.error(`[Companion] account ${userId}: a message her last process never answered could not be sent again`, error);
      }
    }
  }

  /**
   * Assembles one message around `body` and pushes it: the turn starts if she is idle, the process wakes if it is closed, and
   * while a stop is being answered it is held. `words` is his raw text when the message is his (kept until it is answered);
   * `replacing` is the stored entry a re-sent message stands for.
   */
  function push(body: string, words: Sent['words'], replacing?: UnansweredMessage): void {
    // A process started ahead of its first message (`warm`) is woken for that message's sake: it carries the roster and the view like any wake.
    const woke = live === null || !live.messaged;
    // Read and assembled before anything is started, so a reader that throws leaves no half-woken process or turn behind.
    const resume = live === null ? resumeForLaunch() : null;
    // A message said again opens with the cut it first opened with, unless a newer cut is owed; the cut that rides is kept with his words.
    if (words?.cut !== undefined && assembler.owedCut() === null) assembler.oweCut(words.cut.heard, words.cut.interrupted);
    const cut = words === null ? null : assembler.owedCut();
    const content = assembler.assemble(body, woke);
    // The uuid is how the CLI's `result` tells us which of our messages it answered (`companion-turns.ts`).
    const uuid = randomUUID();
    const sent: Sent = {
      uuid,
      message: { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid },
      words: words !== null && cut !== null ? { ...words, cut } : words,
      stoppedBy: null,
    };
    if (stopping !== null) {
      console.log(`[Companion] account ${userId}: a message arrived while her turn was being stopped; it is held until the stopped turn has reported`);
      ledger.hold(sent, replacing);
      return;
    }
    ledger.give(sent, replacing);
    turns.admit(uuid);
    if (live === null) {
      live = open([sent.message], resume);
    } else {
      live.cli.push(sent.message);
      live.messaged = true;
    }
  }

  /** His words, kept until answered (`at` is when he said them). `''` spoken is a press that carried no words. */
  function pushHis(body: string, via: 'typed' | 'spoken'): void {
    push(wordsEnvelope({ body, via }), { body, via, at: new Date().toISOString() });
  }

  /** Starts her process if it is closed, with nothing in it: the idle closer is armed with the launch, so a message that never comes costs a process until the window ends. */
  function warm(): void {
    if (live === null) live = open([], resumeForLaunch());
  }

  /** A stop starts: a push is held until the stopped turn's result is in. */
  function beginStop(launch: Launch): Stop {
    closeStop();
    let end = (): void => undefined;
    const over = new Promise<void>((resolve) => {
      end = resolve;
    });
    stopping = { launch, over, end };
    return stopping;
  }

  async function interrupt(by: StopSource = 'operator'): Promise<void> {
    const target = live;
    if (!turns.stop() || target === null) return;
    // What the CLI has been given is the turn being stopped: his cut or Stop takes it off the kept list now, the server's leaves it for the next process.
    ledger.markStopped(by);
    // Still being built: there is no turn in the CLI to interrupt, so the launch is what stops.
    if (!target.cli.up) {
      await closeProcess('stopped before her process was up');
      return;
    }
    const stop = beginStop(target);
    const answer = await target.cli.interrupt();
    if (live !== target) return;
    if (answer === 'unanswered') {
      // A CLI that ignores an interrupt would ignore the next message too: it is replaced, not waited on. What was held for it goes
      // to the replacement, which resumes the same conversation.
      console.warn(`[Companion] account ${userId}: her process did not answer the interrupt; it is replaced`);
      retire(target);
      turns.release('stopped', null);
      const carried = ledger.carry();
      if (carried.length === 0) setCondition({ state: 'asleep', error: null });
      else startWith(carried, resumeForLaunch());
      return;
    }
    // Messages still queued behind the stopped turn run as a turn of their own, and are not part of what was stopped.
    turns.adopt(answer.stillQueued);
    ledger.unmarkStopped(answer.stillQueued);
    if (stopping !== stop) return;
    // The aborted request reports itself with a result; a CLI that never does must not hold his next words for ever.
    if (ledger.stoppedCount() > 0) await answeredWithin(stop.over, CLI_GRACE_MS);
    if (live === target && stopping === stop) finishStop([]);
  }

  return {
    pushOperator(text, via) {
      pushHis(text, via);
    },
    pushOperatorEmpty() {
      pushHis('', 'spoken');
    },
    pushAlerts(blocks) {
      if (blocks.length > 0) push(blocks.join('\n'), null);
    },
    pushFocusNews(envelope) {
      push(envelope, null);
    },
    warm,
    resendUnanswered,
    oweCut(heard, interrupted) {
      assembler.oweCut(heard, interrupted);
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
      ledger.forgetAll();
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
