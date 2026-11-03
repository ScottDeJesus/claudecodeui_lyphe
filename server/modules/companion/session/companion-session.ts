import { randomUUID } from 'node:crypto';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionAttachment, CompanionProcess } from '@/shared/companion-types.js';
import { claudeImageBlocks, type ClaudeImageBlock } from '@/shared/image-attachments.js';

import type { UnansweredMessage } from '../companion-unanswered.js';

import { createAlertHold, type LateBody } from './companion-alert-hold.js';
import { createReplayHold, messageContent } from './companion-content.js';
import { createClosing } from './companion-closing.js';
import { attachmentsEnvelope, calledEnvelope, emptyPressEnvelope, operatorEnvelope } from './companion-envelopes.js';
import { failureSentence, readLoopEvent, type CompanionLoopEvent } from './companion-events.js';
import { resumableSessionId, unexpectedTools } from './companion-launch.js';
import { createHandoverGate } from './companion-handover-gate.js';
import { makeHandover } from './companion-handover.js';
import { createLedger, type Sent, type StopSource } from './companion-ledger.js';
import { createMessageAssembler } from './companion-message.js';
import { answeredWithin, CLI_GRACE_MS, launchCompanionCli, type CompanionCli } from './companion-process.js';
import { fillSystemPrompt } from './companion-prompt.js';
import { createRefusal } from './companion-refusal.js';
import type { CompanionSession, CompanionSessionDeps } from './companion-session-types.js';
import { sessionShapeOf } from './companion-shape.js';
import { readSoul } from './companion-soul.js';
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
 * stored at `init`, with the shape of her tools and prompt the launch had (`companion-shape.ts`), and every later launch passes the id as
 * `resume` — when the stored shape is the launch's own. The CLI records a conversation's tools and prompt once and keeps them on every
 * resume, so a conversation begun with other ones would go on with them: a held id with another shape, or with none (it began before
 * shapes were kept), is not resumed. It is forgotten, one system line says so, the state is owed to her, and she launches fresh (her
 * memory is the docstore's). When the thread of that conversation is on disk, a HANDOVER of it is written first (`companion-refusal.ts`,
 * `companion-handover.ts`: the summarizer, up to a bound) and her first message after the fresh start carries it once as `<handover>`;
 * the wake waits for it, every push behind it parked in order (`companion-handover-gate.ts`). A resume the CLI refuses clears the
 * stored id, writes one system line and launches once more without it, carrying the messages that were
 * waiting. Every other failure sets the process `failed` with a sentence and a system line — her own
 * failures are shown, never spoken (ruling 17) — and the next push launches again. Nothing polls.
 *
 * HIS WORDS SURVIVE THE PROCESS. A message of his is stored with its raw text the moment it is pushed and stays stored
 * until a turn answers it, a failure drops it, Clear, or he cuts the answer it was in on purpose. A process that ends
 * first (a server handover is the usual way) leaves it for the next one: a new session finds it at birth and, when told
 * (`resendUnanswered`), pushes it again — new uuid, assembled afresh, in order — so her first turn answers it. It is told
 * only once the server is the sole one on the port (the entrypoint's takeover duties): a predecessor that is still serving
 * may be answering the same words, and two processes must not both say them to her. What a closing process hands on is a guess until its CLI
 * has said its last word: a turn that finished as the stop landed is reported while it winds down, and its words leave the list (`hearLateResult`).
 *
 * HIS PICTURES SURVIVE IT TOO, AS RECORDS. The stored entry keeps the attachment records and never a byte; the image blocks ride in memory
 * beside the message (`Sent.images`) and a message said again within a process keeps them. A replay after a restart reads them again from the
 * upload store before it pushes anything, and while it reads, a push that arrives is parked and goes after it (`companion-content.ts`), so his
 * words keep their order; with no picture to read the replay is as synchronous as ever.
 *
 * HER OWN COMPACTION is `companion-closing.ts`: at a turn's end her CLI is asked how full she is; near full she gets one last turn (quiet to the page,
 * not stopped by his Stop or a cut, only `recall` and `remember` open) to write herself a note, her conversation ends and the next begins from it. His
 * words, the alerts and the focus news wait meanwhile (`closing.holding`). A turn the CLI refuses as past its limit is handed over the same way, never failed.
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

/** What a launch begins with: the CLI conversation it continues (`null` for a fresh one), the `tools` it is handed, the `systemPrompt` it is sent and the `shape` of those tools and that prompt, which is stored with the session id its `init` reports. The shape is taken from the very tools and the very prompt the launch gets. */
type LaunchPlan = { resume: string | null; tools: CompanionSessionDeps['tools']; systemPrompt: string; shape: string };

/** One launch and what the conversation has learned of it: the shape it was launched with, whether its first `init` has been seen (the process is up), whether the CLI refused its `resume`, whether it holds a message yet (a `warm` launch does not), whether the CLI has taken a message of it without refusing it as too long (`answered`), the `handover` its first message carried, read as the row was emptied (`null`: none) whether it is `windingDown`: detached by `closeProcess`, its CLI not yet gone, so the one thing it may still tell us is that its turn finished (`hearLateResult`), and the uuids it `handedOff` when it was detached. */
type Launch = { cli: CompanionCli; shape: string; initSeen: boolean; resumeRefused: boolean; messaged: boolean; answered: boolean; handover: string | null; windingDown: boolean; handedOff?: readonly string[] };

/** A stop whose turn has not yet reported its result: the launch concerned, a promise that settles when the wait is over and the way to settle it. */
type Stop = { launch: Launch; over: Promise<void>; end(): void };

/**
 * His words as an envelope: the empty press is its own tag, and so is a call by name (`heard: 'name'`), which a replay must not read as the empty
 * one. A typed line is always an `<operator via="typed">`, empty or not (its `via` decides, never the empty press's tag), and the files it carries
 * follow it as `<attachments>`.
 */
const wordsEnvelope = (words: Pick<UnansweredMessage, 'body' | 'via' | 'heard' | 'attachments'>): string => {
  if (words.body === '' && words.via === 'spoken') return words.heard === 'name' ? calledEnvelope() : emptyPressEnvelope();
  const line = operatorEnvelope(words.body, words.via);
  return words.attachments === undefined || words.attachments.length === 0 ? line : `${line}\n${attachmentsEnvelope(words.attachments)}`;
};

/** Consumed by `companion-account.ts`: one call per account, made lazily on the account's first use. */
export function createCompanionSession(deps: CompanionSessionDeps): CompanionSession {
  const { userId } = deps;
  const launchCli = deps.launch ?? launchCompanionCli;
  const onProcess = guarded('process', userId, deps.onProcess);
  const onSystemLine = guarded('system line', userId, deps.onSystemLine);
  const writeProviderSession = guarded('session writer', userId, deps.writeProviderSession);
  const dropHandover = guarded('handover drop', userId, deps.dropHandover);
  const restoreHandover = guarded('handover restore', userId, deps.writeHandover);
  // Her last turn is quiet to the page: no sentence, no turn frame, no speech-cache move. Her activity still passes, so she reads thinking.
  const unlessLastTurn =
    <Args extends unknown[]>(callback: (...args: Args) => void) =>
    (...args: Args): void => {
      if (!closing.inLastTurn) callback(...args);
    };
  const turns = createTurnTracker(
    {
      onSentence: unlessLastTurn(guarded('sentence', userId, deps.onSentence)),
      onTurnStarted: unlessLastTurn(guarded('turn start', userId, deps.onTurnStarted)),
      onTurnEnded: (...ended) => {
        unlessLastTurn(guarded('turn end', userId, deps.onTurnEnded))(...ended);
        // A microtask away, so the alerts kept for this turn are given after the tracker has finished with it (giving starts a turn), whatever ended it.
        queueMicrotask(guarded('held alerts', userId, () => alertHold.turnEnded()));
      },
      onActivity: guarded('activity', userId, deps.onActivity),
    },
    // The account's sound-tag list, read each time a turn begins: that turn's sentences are parsed by it.
    deps.readSoundTags,
  );
  const assembler = createMessageAssembler(deps);
  const ledger = createLedger(userId, { read: deps.readUnanswered, write: deps.writeUnanswered });
  // Alerts are read at the last moment and never said once answered (`companion-alert-hold.ts`); one that can be answered waits here while a turn is in flight.
  const alertHold = createAlertHold({ userId, busy: () => turns.turnId !== null, parks: () => closing.holding(), give: (body) => push(body, null, []) });

  let live: Launch | null = null;
  let condition: CompanionProcess = { state: 'asleep', error: null };
  // Set from the moment a stop starts until its turn's result is in: a push is held while it stands.
  let stopping: Stop | null = null;
  // Set while the boot replay reads the pictures of the messages it says again: a new push is parked behind it (`push`), so his words keep their order.
  let replay: ReturnType<typeof createReplayHold> | null = null;


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
    // A fault of her last turn ends that turn (the closing hands her over), it is not a failure of hers.
    if (closing.inLastTurn) return closing.lastTurnEnded({ answered: false, why: 'failed' });
    console.error(`[Companion] account ${userId}: ${sentence}`);
    retire(launch);
    // A message that makes her fail must not be sent again to fail again; one that carried the handover takes it with it, so the row keeps it for the next.
    ledger.fail();
    assembler.releaseHandover();
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
    const held = deps.readProviderSession();
    if (held?.id !== event.sessionId || held.shape !== launch.shape) writeProviderSession({ id: event.sessionId, shape: launch.shape });
    if (launch.initSeen) return;
    launch.initSeen = true;
    handoverReceived();
    setCondition({ state: 'awake', error: null });
    console.log(
      `[Companion] account ${userId}: ${launch.cli.resume ? 'resumed' : 'started'} session ${event.sessionId} on ${event.model}; the CLI listed ${event.tools.length} tools, all hers${event.tools.length > 0 ? ` (${event.tools.join(', ')})` : ''}`
    );
    closing.arm(launch);
  }

  /**
   * A launch that is up has been handed the message that carried the handover (`init` is the CLI taking its first one; a message given to a
   * launch already up counts the same): the row is emptied, so no later message carries it. Until then the row keeps it, and a launch that
   * fails or is detached first (`releaseHandover`) leaves it for the next message, as `<state>` is.
   */
  function handoverReceived(): void {
    if (!assembler.handoverInFlight()) return;
    if (live !== null) live.handover = rowHandover();
    assembler.releaseHandover();
    dropHandover();
  }

  /** The handover on her row, or `null` when there is none or the read threw (the callbacks of the deps never end her conversation). */
  function rowHandover(): string | null {
    try {
      return deps.readHandover();
    } catch (error) {
      console.error(`[Companion] account ${userId}: the handover read callback threw`, error);
      return null;
    }
  }

  /** The same message under a new uuid, for the CLI that is to be told it again. His words are assembled afresh (the roster and the view in the old message are a snapshot) and his pictures ride again (`sent.images`); a message that cannot be goes as it was. */
  function restate(sent: Sent): Sent {
    const uuid = randomUUID();
    let content = sent.message.message.content;
    if (sent.words !== null) {
      try {
        content = messageContent(assembler.assemble(wordsEnvelope(sent.words), false), sent.images);
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
    if (live.initSeen) handoverReceived();
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
    // Her last turn's result is the closing's alone, whatever its outcome: it never fails her and is never a turn of the page's. A success that lists nothing is the
    // turn in flight's, as below, so it is asked as that turn's messages: the notice is the only message of her last turn.
    const lastTurnUuids = event.answered.length === 0 && event.failure === null ? turns.inFlightUuids() : event.answered;
    if (closing.isLastTurnResult(lastTurnUuids)) {
      ledger.take(lastTurnUuids);
      turns.result(lastTurnUuids, null);
      closing.lastTurnEnded(event.failure === null ? { answered: true, text: event.text } : { answered: false, why: 'failed' });
      return;
    }
    // The CLI refused a message as past its limit: her conversation is handed over, never failed (every later message would be refused too). A fresh
    // conversation that has taken nothing yet holds only the refused message, so the message is the too-long thing, not the conversation: a handover
    // would reach the next launch with the same words and be refused again, one summarizer call per round.
    if (event.contextFull) return handOverRefused(launch, event, launch.cli.resume === null && !launch.answered);
    launch.answered = true;
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
    const ended = turns.result(answered, aborted ? null : event.failure);
    if (ended === 'live' && !aborted && event.failure !== null) {
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
    // A turn ended with her process still up: the reading that may begin her closing.
    if (ended === 'live' && live === launch) closing.afterTurn(launch);
  }

  /**
   * A turn answered "Prompt is too long": everything the launch was handed and never answered is taken out, his words of it are kept on disk (without the `<cut>`
   * they carried: the fresh her never said that sentence) and parked FIRST, so the fresh launch's first message is his refused words with the handover.
   * `tooLongAlone`: the launch held nothing but what it was handed, so the message the CLI refused is too long by itself: its words are not kept or parked (no launch
   * could take them, every one that carried them would be refused again) and `closing.full` ends it without a handover. A refusal that lists messages refused only
   * those, so the others the launch held are kept and parked as usual; one that lists none is the whole request's, and every message the launch held is dropped. The
   * handover its first message carried was emptied from the row at `init`; it is put back for the next message, which is owed it.
   */
  function handOverRefused(launch: Launch, event: Extract<CompanionLoopEvent, { kind: 'result' }>, tooLongAlone: boolean): void {
    const refused = ledger.take(ledger.carry().map((sent) => sent.uuid));
    turns.result(event.answered.length > 0 ? event.answered : turns.inFlightUuids(), null);
    closing.full(launch, tooLongAlone);
    if (tooLongAlone) putHandoverBack(launch);
    const tooLong = (sent: Sent): boolean => tooLongAlone && (event.answered.length === 0 || event.answered.includes(sent.uuid));
    for (const sent of refused) {
      if (sent.words === null || tooLong(sent)) continue;
      const words = { ...sent.words };
      delete words.cut;
      const kept = ledger.keep(words);
      closing.park(() => deliver(wordsEnvelope(words), words, sent.images, kept));
    }
  }

  /** The handover a refused fresh launch carried goes back on her row unless the row holds another by now: the first message of the next launch carries it. */
  function putHandoverBack(launch: Launch): void {
    if (launch.handover === null || rowHandover() !== null) return;
    restoreHandover(launch.handover);
    console.log(`[Companion] account ${userId}: the handover her refused first message carried is put back on her row for her next message`);
  }

  function handle(launch: Launch, message: SDKMessage): void {
    const event = readLoopEvent(message);
    if (event === null) return;
    if (event.kind === 'init') onInit(launch, event);
    else if (event.kind === 'text') turns.text(event.delta);
    else if (event.kind === 'block_end') turns.blockEnded();
    else onResult(launch, event);
  }

  /** The messages `carried` are the first of a new launch: each joins the turn in flight or starts one. */
  function startWith(carried: Sent[], plan: LaunchPlan): void {
    for (const sent of carried) turns.admit(sent.uuid);
    live = open(carried.map((sent) => sent.message), plan);
  }

  /** The launch ended on its own: a refused resume is replaced by a fresh launch, anything else is a failure. */
  function conclude(launch: Launch, thrown: unknown): void {
    if (closing.inLastTurn) return closing.lastTurnEnded({ answered: false, why: 'failed' });
    const reason = thrown === null ? null : thrown instanceof Error ? thrown.message : String(thrown);
    const resume = launch.cli.resume;
    if (resume !== null && (launch.resumeRefused || (reason !== null && /No conversation found/i.test(reason)))) {
      console.warn(`[Companion] account ${userId}: the CLI has no conversation ${resume}; she starts fresh`);
      retire(launch);
      writeProviderSession(null);
      onSystemLine('Her conversation could not be resumed; she starts fresh');
      // The focus, the draft and the walk lived in the conversation that is gone; the next message restates them.
      assembler.oweState();
      startWith(ledger.carry(), planWith(null));
      return;
    }
    fail(launch, reason === null ? 'Her process ended without being asked to.' : failureSentence('Her process stopped', reason));
  }

  /** Starts a launch with `initial` already queued; she is `waking` until its first `init`. */
  function open(initial: Array<Sent['message']>, plan: LaunchPlan): Launch {
    const launch: Launch = {
      shape: plan.shape,
      cli: launchCli({
        userId,
        initial,
        resume: plan.resume,
        readSettings: deps.readSettings,
        tools: plan.tools,
        systemPrompt: plan.systemPrompt,
        // A turn in flight is the only busy there is: she has no background task and no watcher.
        isBusy: () => turns.turnId !== null,
        // A launch that has been detached (closed, cleared, replaced) is drained unheard: its late words are nobody's turn. The one thing heard from a closing one is its result.
        onMessage: (message) => {
          if (live === launch) handle(launch, message);
          else if (launch.windingDown) hearLateResult(launch, message);
        },
        onEnded: (thrown) => {
          if (live === launch) conclude(launch, thrown);
        },
        onIdleClose: () => void closeProcess('idle'),
      }),
      initSeen: false,
      resumeRefused: false,
      messaged: initial.length > 0,
      answered: false,
      handover: null,
      windingDown: false,
    };
    setCondition({ state: 'waking', error: null });
    return launch;
  }

  /**
   * A closing launch may report, as its CLI winds down, a turn that finished as the stop landed; the stop had handed its messages on already (`ledger.handOff`),
   * and left alone they would be said again and answered twice. A result that SUCCEEDED answered what it lists: those entries leave the list the next process is
   * given; a success that lists none answered what this launch handed on, as the live path reads it as the turn in flight's. An aborted request's result is a failure and answers nothing, so its messages stay owed. Only results are read.
   */
  function hearLateResult(launch: Launch, message: SDKMessage): void {
    const event = readLoopEvent(message);
    if (event?.kind !== 'result' || event.failure !== null || event.resumeRefused) return;
    const answered = ledger.answerLate(event.answered.length > 0 ? event.answered : (launch.handedOff ?? []));
    if (answered > 0) console.log(`[Companion] account ${userId}: her turn finished as her process closed; the ${answered} message(s) of his it answered will not be said again`);
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
    ending.handedOff = ledger.handOff();
    // What was in the launch is assembled afresh for the next one, so a handover it carried is still owed.
    assembler.releaseHandover();
    turns.release('stopped', null);
    setCondition({ state: 'asleep', error: null });
    return ending;
  }

  /** Ends the input and the process, waits for it to wind down, and leaves her asleep. */
  async function closeProcess(reason: string): Promise<void> {
    // A replay still reading his pictures is stopped with the process, as a handover being written is (below).
    abandonReplay();
    // A handover still being written is stopped with the process: his parked words are in the ledger for the next one.
    if (gate.abandon() && live === null) setCondition({ state: 'asleep', error: null });
    const ending = detach(reason);
    // Right after the detach, so the end of a last turn stays off the page; the conversation stays held and his kept words stay in the ledger.
    closing.abandon();
    if (ending === null) return;
    // Until its CLI is gone the closing launch may still report that its turn finished (`hearLateResult`).
    ending.windingDown = true;
    try {
      await ending.cli.close();
    } finally {
      ending.windingDown = false;
    }
  }

  /**
   * A launch made now that continues `resume`: her tools as they stand, her system prompt composed now (her soul pages read afresh, the operator's
   * name filled in) and the shape of both. The launch is sent this very prompt, so what is hashed is what is sent; an edit to a soul page is a new shape here.
   */
  function planWith(resume: string | null): LaunchPlan {
    const tools = deps.tools;
    const systemPrompt = fillSystemPrompt(deps.readSettings().operatorName, readSoul(userId));
    return { resume, tools, systemPrompt, shape: sessionShapeOf(tools, systemPrompt) };
  }

  /**
   * What a new launch begins with. The held conversation is continued only when the shape stored with it is this launch's own AND its id is
   * a UUID: the CLI records a conversation's tools and prompt once and keeps them on every resume, so a conversation begun with other ones
   * would go on with them (a parameter added to a tool, a sentence changed in her prompt: dark to her). A held conversation whose shape is
   * not the launch's (changed, or never kept) is forgotten at once and said once on her panel, whatever its id looks like: a damaged id with
   * a stale shape is one refusal, one sentence. Her memory is the docstore's and is not touched. A wake that finds such a conversation with a
   * thread on disk never reaches here before the refusal is carried out WITH its handover (`gate.holding()` in `push`, `warm` and the
   * replacement after an unanswered Stop); what reaches here is the bare refusal, for a conversation with no thread to hand over.
   *
   * EVERY FRESH START OWES THE STATE, not only a refusal: the focus, the draft and the walk lived in a conversation she no longer has. The
   * debt is also paid here when nothing is held, because a refusal forgets the old id before the fresh launch's `init` and a restart in
   * between finds no id; with nothing held the owed state is empty and sends nothing. Called before the next message is assembled, so that
   * message restates it.
   */
  function planLaunch(): LaunchPlan {
    const fresh = planWith(null);
    const held = deps.readProviderSession();
    if (held !== null && held.shape !== fresh.shape) {
      // Reached with no thread to hand over (a wake with one is refused with its handover first, and the id is already forgotten).
      refusal.bare(held);
    } else if (held !== null) {
      const resume = resumableSessionId(held.id);
      if (resume !== null) return { ...fresh, resume };
      console.warn(`[Companion] account ${userId}: the held session id is not a UUID; she starts fresh`);
    }
    assembler.oweState();
    return fresh;
  }

  const refusal = createRefusal(userId, deps, {
    currentShape: () => planWith(null).shape,
    forget: () => writeProviderSession(null),
    say: onSystemLine,
  });

  /** Her own compaction (`companion-closing.ts`), made from what the session holds. */
  const closing = createClosing(userId, {
    live: () => live,
    // A stop being answered is a turn still in the CLI: a notice given now could be folded into the request being aborted.
    turnInFlight: () => turns.turnId !== null || stopping !== null,
    sayNotice: (text) => {
      const uuid = randomUUID();
      const message: Sent['message'] = { type: 'user', message: { role: 'user', content: messageContent(text, []) }, parent_tool_use_id: null, uuid };
      const sent: Sent = { uuid, message, words: null, images: [], stoppedBy: null };
      ledger.give(sent);
      dispatch(sent);
      return uuid;
    },
    endConversation: (launch) => {
      if (live === launch) detach('her conversation ended');
      writeProviderSession(null);
      assembler.forget();
      // Not awaited: a message that lands while it winds down starts the fresh launch, as `detach` intends.
      void launch.cli.close().catch((error: unknown) => console.error(`[Companion] account ${userId}: her old process did not close cleanly`, error));
    },
    writeHandover: deps.writeHandover,
    makeHandover: async (sessionId, signal) => {
      const { operatorName, name } = deps.readSettings();
      const outcome = await makeHandover({ userId, sessionId, operatorName, name, last: refusal.lastWords(), signal });
      return outcome.kind === 'written' ? outcome.text : null;
    },
    conversationId: () => deps.readProviderSession()?.id ?? null,
    say: onSystemLine,
    readSettings: deps.readSettings,
  });

  /** A wake waits behind the handover being written: `condition` says she is waking; when nothing is left parked and no launch came of it she is asleep again. */
  const gate = createHandoverGate(userId, {
    refused: refusal.withThread,
    settle: refusal.withHandover,
    onStart: () => setCondition({ state: 'waking', error: null }),
    onEnd: () => {
      if (live === null) setCondition({ state: 'asleep', error: null });
    },
  });

  /**
   * One inherited entry said again, as a fresh message that replaces it. `attachments` are its files as they will be told to her (`readPictures` sets an
   * unreadable picture `unopened`, so the envelope never announces a picture the message does not carry). A failure is logged and leaves the entry in the list, to be tried at the next boot.
   */
  function resend(entry: UnansweredMessage, images: ClaudeImageBlock[], attachments: UnansweredMessage['attachments'] = entry.attachments): void {
    try {
      const words = { body: entry.body, via: entry.via, at: entry.at, heard: entry.heard, cut: entry.cut, attachments };
      deliver(wordsEnvelope(words), words, images, entry);
    } catch (error) {
      console.error(`[Companion] account ${userId}: a message her last process never answered could not be sent again`, error);
    }
  }

  /**
   * The pictures of one entry's files, each read on its own by the chat's own reader from the upload store, so the one it cannot read (skipped, with the reader's
   * warning) is known: the message goes without it, and its record is set `unopened` in the files told to her. Her `restate`s and the next boot read those records, so they never announce it either.
   */
  async function readPictures(entry: UnansweredMessage): Promise<{ images: ClaudeImageBlock[]; attachments: UnansweredMessage['attachments'] }> {
    const files = entry.attachments ?? [];
    let read: ClaudeImageBlock[][];
    try {
      read = await Promise.all(files.map((file) => (file.opens === 'shown' ? claudeImageBlocks([file]) : [])));
    } catch (error) {
      console.error(`[Companion] account ${userId}: the pictures of a message her last process never answered could not be read; it is sent without them`, error);
      read = files.map(() => []);
    }
    const attachments = files.map((file, index): CompanionAttachment => (file.opens === 'shown' && read[index].length === 0 ? { ...file, opens: 'unopened' } : file));
    return { images: read.flat(), attachments: entry.attachments === undefined ? undefined : attachments };
  }

  /**
   * Close and Clear end a replay that is still reading: it says nothing afterwards, and what was parked behind it does not run, as `gate.abandon` leaves a handover's parked
   * words. His words stay in the ledger for the next process (a close) or are gone (Clear), and the hold is never released: nothing waits on it any more.
   */
  function abandonReplay(): void {
    replay = null;
  }

  /**
   * Says to her again what her last process was given and never answered, each as a fresh message that replaces its entry: a restart storm leaves one entry and gets one answer.
   * Synchronous when no entry carries a picture. Otherwise the pictures are read first, and a new push is parked behind the replay meanwhile (`replay`): the hold ends when the reads settle,
   * after the replay's own messages are pushed, in order, past it. One replay at a time: a call made while another reads has nothing to add (the entries are the one's).
   */
  async function resendUnanswered(): Promise<void> {
    // The ledger was made when the account was first touched, which on a handover boot is before the predecessor stopped answering: it looks at the row again.
    ledger.reconcile();
    const entries = [...ledger.inherited()];
    if (entries.length === 0 || replay !== null) return;
    console.log(`[Companion] account ${userId}: re-sending ${entries.length} message(s) her last process never answered`);
    if (!entries.some((entry) => entry.attachments?.some((attachment) => attachment.opens === 'shown'))) {
      for (const entry of entries) resend(entry, []);
      return;
    }
    const hold = createReplayHold();
    replay = hold;
    try {
      const pictures = await Promise.all(entries.map(readPictures));
      // Abandoned meanwhile (a close, Clear): whoever abandoned it owns what follows.
      if (replay !== hold) return;
      // A push that replaced an entry may have taken one out while the reads ran: what is no longer owed is not said.
      const owed = new Set(ledger.inherited());
      entries.forEach((entry, index) => {
        if (owed.has(entry)) resend(entry, pictures[index].images, pictures[index].attachments);
      });
    } finally {
      if (replay === hold) {
        replay = null;
        hold.release();
      }
    }
  }

  /** His new words that must wait for something (a handover, the replay's reads) are on disk meanwhile, kept as an inherited entry the push that says them later replaces. */
  const keptWhileWaiting = (words: Sent['words'], replacing?: UnansweredMessage): UnansweredMessage | undefined =>
    words !== null && replacing === undefined ? ledger.keep(words) : replacing;

  /** A push from outside the replay: parked behind it while it reads his pictures (the replay's own messages go past it, through `deliver`), else delivered at once. */
  function push(body: string | LateBody, words: Sent['words'], images: ClaudeImageBlock[], replacing?: UnansweredMessage): void {
    if (replay?.holding()) {
      const kept = keptWhileWaiting(words, replacing);
      replay.park(guarded('push held behind the replay', userId, () => deliver(body, words, images, kept)));
      return;
    }
    deliver(body, words, images, replacing);
  }

  /**
   * Assembles one message around `body` and delivers it: the turn starts if she is idle, the process wakes if it is closed, and
   * while a stop is being answered it is held. A `body` that is a function (the alerts') is read here, after every wait above has ended and
   * just before the message is built, so what waited is judged when it is finally said; `null` drops the message whole, waking nothing.
   * `words` is his raw text when the message is his (kept until it is answered);
   * `images` are the pictures that ride after the text (read before, kept in memory with the message); `replacing` is the stored entry a re-sent message stands for.
   */
  function deliver(body: string | LateBody, words: Sent['words'], images: ClaudeImageBlock[], replacing?: UnansweredMessage): void {
    // Her last turn, or her wall's handover, is under way: this waits for the fresh her, his words on disk meanwhile, and the first of them plans the fresh launch.
    if (closing.holding()) {
      const kept = keptWhileWaiting(words, replacing);
      closing.park(() => deliver(body, words, images, kept));
      return;
    }
    // A wake onto a conversation she is about to drop waits for its handover. His words are on disk meanwhile (kept as an inherited entry the replayed push replaces).
    if (live === null && gate.holding()) {
      const kept = keptWhileWaiting(words, replacing);
      gate.park(() => deliver(body, words, images, kept));
      return;
    }
    // A stop is being answered and what is pushed would be held, already built: an alert is not built until the stop is over, so its last look is the one that counts.
    if (typeof body !== 'string' && stopping !== null) {
      void stopping.over.then(guarded('alerts held behind a stop', userId, () => deliver(body, words, images, replacing)));
      return;
    }
    const text = typeof body === 'string' ? body : body();
    if (text === null) return;
    // A process started ahead of its first message (`warm`) is woken for that message's sake: it carries the roster and the view like any wake.
    const woke = live === null || !live.messaged;
    // Read and assembled before anything is started, so a reader that throws leaves no half-woken process or turn behind.
    const plan = live === null ? planLaunch() : null;
    // A message said again opens with the cut it first opened with, unless a newer cut is owed; the cut that rides is kept with his words.
    if (words?.cut !== undefined && assembler.owedCut() === null) assembler.oweCut(words.cut.heard, words.cut.interrupted);
    const cut = words === null ? null : assembler.owedCut();
    const content = messageContent(assembler.assemble(text, woke), images);
    // The uuid is how the CLI's `result` tells us which of our messages it answered (`companion-turns.ts`).
    const uuid = randomUUID();
    const sent: Sent = {
      uuid,
      message: { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid },
      words: words !== null && cut !== null ? { ...words, cut } : words,
      images,
      stoppedBy: null,
    };
    if (stopping !== null) {
      console.log(`[Companion] account ${userId}: a message arrived while her turn was being stopped; it is held until the stopped turn has reported`);
      ledger.hold(sent, replacing);
      return;
    }
    ledger.give(sent, replacing);
    turns.admit(uuid);
    if (plan !== null) {
      live = open([sent.message], plan);
    } else if (live !== null) {
      live.cli.push(sent.message);
      live.messaged = true;
      if (live.initSeen) handoverReceived();
    }
  }

  /**
   * His words, kept until answered (`at` is when he said them). `''` spoken is a press that carried no words; with `heard: 'name'` it is a press that was only her name.
   * A typed line's `attached` files ride in his words as records (the ledger writes those to disk) and their pictures as image blocks beside them (memory only).
   */
  function pushHis(body: string, via: 'typed' | 'spoken', heard?: 'name', attached?: Parameters<CompanionSession['pushOperator']>[2]): void {
    const attachments = attached?.attachments ?? [];
    const words = { body, via, at: new Date().toISOString(), ...(heard === undefined ? {} : { heard }), ...(attachments.length === 0 ? {} : { attachments }) };
    push(wordsEnvelope(words), words, attached?.images ?? []);
  }

  /** Starts her process if it is closed, with nothing in it: the idle closer is armed with the launch, so a message that never comes costs a process until the window ends. */
  function warm(): void {
    if (live !== null || closing.holding()) return;
    if (gate.holding()) gate.park(warm);
    else live = open([], planLaunch());
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
    // His Stop, his cut and a server stop leave her last turn running: it is not his turn, and it ends by its own bound.
    if (closing.inLastTurn) return;
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
      else if (gate.holding()) gate.park(() => startWith(carried, planLaunch()));
      else startWith(carried, planLaunch());
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
    pushOperator(text, via, attached) {
      pushHis(text, via, undefined, attached);
    },
    pushOperatorEmpty() {
      pushHis('', 'spoken');
    },
    pushOperatorCalled() {
      pushHis('', 'spoken', 'name');
    },
    pushAlerts(alerts) {
      if (alerts.length > 0) alertHold.say(alerts);
    },
    pushFocusNews(envelope) {
      push(envelope, null, []);
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
      // Alerts kept for her turn are dropped first: the detach below ends that turn, and what it left must not wake the fresh her.
      alertHold.abandon();
      writeProviderSession(null);
      dropHandover();
      abandonReplay();
      gate.abandon();
      assembler.forget();
      const ending = detach('cleared');
      closing.abandon();
      ledger.forgetAll();
      // A turn in flight is stopped now, not at the end of the grace.
      if (ending?.cli.up) await ending.cli.interrupt();
      await ending?.cli.close();
      // A failed process has no launch to detach and is asleep once cleared; a push that already woke a new one is not overwritten.
      if (live === null) setCondition({ state: 'asleep', error: null });
    },
    // The public close is the server stopping: alerts kept for her turn are dropped before the turn ends, so none wakes a new process meanwhile. The session's own closes (idle, a stop before she was up) go through `closeProcess` and keep them.
    close(reason) {
      alertHold.abandon();
      return closeProcess(reason);
    },
    get process() {
      return condition;
    },
    // Null during her last turn: the panel's Stop is keyed to this turn, and a page that loads then must not show one or follow it.
    get turnId() {
      return closing.inLastTurn ? null : turns.turnId;
    },
    get inLastTurn() {
      return closing.inLastTurn;
    },
  };
}
