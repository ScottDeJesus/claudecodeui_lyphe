import { sessionCompactionsDb, sessionsDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { summarizerStatus } from '@/modules/settings/index.js';
import type {
  AnyRecord,
  ChatProcessActivity,
  CompactionFacts,
  LLMProvider,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

import { fireCompactHealTrigger, runSummarizeVerb } from './compaction-children.js';
import { factsOf, readVerbSuccess, verbFailureSentence } from './compaction-facts.js';
import type { VerbSuccess } from './compaction-facts.js';
import { compactionRowFrame, completeFrame, errorFrame, markerOf, statusFrame, summaryFrame } from './compaction-frames.js';
import { waitUntilQuiet } from './compaction-guard.js';
import { logDecision } from './compaction-log.js';
import { noteSummarizerStatus, noteVerbNotReady } from './compaction-mode.js';
import {
  beginFlight,
  endFlight,
  lastContextTokens,
  lastTurnContext,
  liftAutomaticRefusal,
  refuseAutomatic,
} from './compaction-registry.js';
import type { CompactionFlight } from './compaction-registry.js';
import { createSeedWriter } from './compaction-seed.js';
import { IDLE_CHECK_MAX_TRIES } from './idle-restore.js';

/**
 * THE COMPACTION: the nine steps of one run, in order. The decorator (`compaction-runtime.ts`) hands a
 * `/compact` run here with the run's own writer; every frame below is written to that writer, so the
 * gateway sequences it, replays it to every tab and shows it on the processing line like any other run.
 *
 *   1 the session row   2 the guard   3 the status line   4 the heal ending   5 the verb
 *   6 the live rows     7 the seed append   8 success or take-back   9 the push for an automatic failure
 *
 * The old transcript is never written; the chat's row moves only inside `swapToCompactedSession`.
 */

/** The slice of the provider runtime service the procedure uses; `compaction-runtime.ts` supplies it. */
type ProcedureRuntime = {
  run(provider: LLMProvider, command: string, options: AnyRecord, writer: ProviderRuntimeWriter): Promise<unknown>;
  abort(provider: LLMProvider, sessionId: string): Promise<boolean>;
  activity(provider: LLMProvider, appSessionId: string): ChatProcessActivity;
  markIdleCheck(provider: LLMProvider, appSessionId: string, tries: number): boolean;
};

export type CompactionInput = {
  sessionId: string;
  options: AnyRecord;
  writer: ProviderRuntimeWriter;
  trigger: CompactionFacts['trigger'];
  /** The operator's own words after `/compact`, or null. */
  instructions: string | null;
};

// What the seed append must not inherit from the send that started the compaction: that message's own
// attachments, and `compactionTrigger`, which made the run a compaction.
const NOT_FOR_THE_SEED = ['attachments', 'images', 'files', 'compactionTrigger'] as const;

/**
 * How one run ended, for `compact`'s caller: only a refused summarizer hands the chat back to the CLI, and `failed`
 * marks an end that tried to compact and could not (a failure or a refusal, which an idle check counts as its attempt).
 */
type Ending = { handOffToCli: false; failed?: true } | { handOffToCli: true; sentence: string };

const ENDED: Ending = { handOffToCli: false };
const FAILED: Ending = { handOffToCli: false, failed: true };

/** Everything one run needs at hand, so the steps are small functions of it. */
type Run = CompactionInput & {
  inner: ProcedureRuntime;
  flight: CompactionFlight;
  /** Writes a frame unless the operator pressed Stop: after a Stop the run says nothing more. */
  emit: (frame: unknown) => void;
};

/**
 * Runs one compaction to its end. Never rejects: a bug in a step is an error frame and a `complete`,
 * so the chat is never left "processing". Resolves after the run's terminal `complete` has gone out
 * (or the gateway's abort has sent it).
 */
export async function compact(inner: ProcedureRuntime, input: CompactionInput): Promise<void> {
  if (input.trigger === 'manual') liftAutomaticRefusal(input.sessionId);
  const flight = beginFlight(input.sessionId, input.trigger);
  const run: Run = { ...input, inner, flight, emit: (frame) => { if (!flight.stopped) input.writer.send(frame); } };

  let ending: Ending = ENDED;
  try {
    ending = await runSteps(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[compaction] session=${input.sessionId} trigger=${input.trigger} the compaction itself failed:`, error);
    run.emit(errorFrame(input.sessionId, `Compaction failed: ${message}. The chat stays on its current session.`));
    run.emit(completeFrame(input.sessionId, 1));
    pushAutomaticFailure(run, message);
    ending = FAILED;
  } finally {
    endFlight(input.sessionId, flight);
  }
  // An idle check that tried and failed, or was refused, has spent its attempt for this turn end: the chat's host is told,
  // so no restart repeats it. A run that was stopped (a shutdown, the operator's Stop) tried nothing to the end and is not
  // spent; the host already holds the start it was cut short in, which bounds a retry.
  if (input.trigger === 'idle' && 'failed' in ending && ending.failed && !flight.stopped) {
    inner.markIdleCheck('claude', input.sessionId, IDLE_CHECK_MAX_TRIES);
  }

  if (ending.handOffToCli) {
    // The summarizer cannot be served: the CLI compacts as it does with the switch off, on this same run.
    const words = input.instructions ? ` ${input.instructions}` : '';
    await inner.run('claude', `/compact${words}`, input.options, input.writer);
  }
}

async function runSteps(run: Run): Promise<Ending> {
  const { sessionId, inner, flight, trigger } = run;

  // 1. THE SESSION ROW.
  const row = sessionsDb.getSessionById(sessionId);
  const oldProviderSessionId = row?.provider_session_id ?? null;
  const oldTranscriptPath = row?.jsonl_path ?? null;
  if (!oldProviderSessionId || !oldTranscriptPath) {
    run.emit(errorFrame(sessionId, 'This chat has no transcript to compact yet.'));
    run.emit(completeFrame(sessionId, 1));
    return FAILED;
  }

  // 2. THE GUARD. An automatic compaction never holds a chat the operator is using, so it does not wait.
  const guard = await waitUntilQuiet({
    sessionId,
    flight,
    readActivity: () => inner.activity('claude', sessionId),
    say: (text) => run.emit(statusFrame(sessionId, text)),
    wait: trigger === 'manual',
  });
  if (!guard.quiet) {
    if (guard.busyWhy !== null) {
      logDecision(sessionId, trigger, lastTurnContext(sessionId), inner.activity('claude', sessionId), `left alone: the chat is busy (${guard.busyWhy})`);
    }
    run.emit(completeFrame(sessionId, 0));
    return ENDED;
  }

  // 3. THE STATUS LINE, from a fresh status: the words may have changed since the cache was filled.
  flight.phase = 'summarizing';
  const status = await summarizerStatus();
  noteSummarizerStatus(status);
  if (flight.stopped) return ENDED;
  if (status && !status.ready) return refusedByReadiness(run, status.why);
  run.emit(statusFrame(sessionId, status ? `Compacting with ${status.model} · ${status.effort}…` : 'Compacting…'));

  // 4. THE HEAL ENDING: the trigger the CLI's own PreCompact row would have fired, with the OLD transcript.
  await fireCompactHealTrigger({ oldProviderSessionId, oldTranscriptPath });
  if (flight.stopped) return ENDED;

  // 5. THE VERB.
  let stopVerb: (() => void) | null = null;
  flight.stop = async () => {
    flight.stopped = true;
    stopVerb?.();
    return true;
  };
  const answer = await runSummarizeVerb({
    transcriptPath: oldTranscriptPath,
    providerSessionId: oldProviderSessionId,
    instructions: run.instructions,
    onChild: (stop) => {
      stopVerb = stop;
      if (flight.stopped) stop();
    },
  });
  if (flight.stopped) return ENDED;

  if (answer.exitCode === 3) return refusedByReadiness(run, verbFailureSentence(answer));
  const success = answer.exitCode === 0 ? readVerbSuccess(answer.json) : null;
  if (success === null) {
    const sentence = answer.exitCode === 0 ? 'the summarizer returned an answer that could not be read' : verbFailureSentence(answer);
    // Exit 2 is a refusal of the input (nothing to compact, no such transcript): the triggers leave the
    // chat alone until the operator asks himself. Anything else is a failure worth another try later.
    if (answer.exitCode === 2) refuseAutomatic(sessionId);
    logDecision(
      sessionId, trigger, lastTurnContext(sessionId), inner.activity('claude', sessionId),
      `the summarizer ended without a summary (exit ${answer.exitCode}): ${sentence}`
        + (answer.exitCode === 2 ? ' — the chat is under an automatic refusal until a manual Compact or a flip of the switch' : ''),
    );
    run.emit(errorFrame(sessionId, `Compaction failed: ${sentence}. The chat stays on its current session.`));
    run.emit(completeFrame(sessionId, 1));
    if (answer.exitCode !== 2) pushAutomaticFailure(run, sentence);
    return FAILED;
  }

  return seedTheNewSession(run, { oldProviderSessionId, oldTranscriptPath, success });
}

/** The summarizer cannot be served: record it, and either hand the chat to the CLI (manual) or end (automatic). */
function refusedByReadiness(run: Run, sentence: string): Ending {
  noteVerbNotReady(sentence);
  refuseAutomatic(run.sessionId);
  const manual = run.trigger === 'manual';
  logDecision(
    run.sessionId, run.trigger, lastTurnContext(run.sessionId), run.inner.activity('claude', run.sessionId),
    `${manual ? 'handed to the CLI' : 'left alone'}: the summarizer is not ready (${sentence})`,
  );
  if (!manual) {
    run.emit(completeFrame(run.sessionId, 0));
    return FAILED;
  }
  run.emit(statusFrame(run.sessionId, `Custom compaction is not ready (${sentence}); the CLI compacts this chat instead.`));
  return { handOffToCli: true, sentence };
}

// 6 + 7 + 8. THE LIVE ROWS, THE SEED APPEND, AND ITS SUCCESS OR TAKE-BACK.
async function seedTheNewSession(
  run: Run,
  old: { oldProviderSessionId: string; oldTranscriptPath: string; success: VerbSuccess },
): Promise<Ending> {
  const { sessionId, inner, flight, options, writer, trigger } = run;
  const { oldProviderSessionId, oldTranscriptPath, success } = old;
  const facts = factsOf(success, trigger, lastContextTokens(sessionId));

  // 6. Live rows, written before the seed append so the operator watches the summary arrive.
  run.emit(compactionRowFrame(sessionId, oldProviderSessionId, markerOf(facts, null, new Date().toISOString())));
  run.emit(summaryFrame(sessionId, oldProviderSessionId, success.seed[0]));

  // 7. THE SEED APPEND, on the chat's own model, effort, permission mode and tools: the triggering send's
  // options, minus what belonged to that send. `resumeFromScratch` is what retires the old process and
  // starts the new session with no resume; `transcriptAppend` puts the seed in that session's transcript
  // with no turn of its own, so no model is called and nothing is written back — the CLI merges the seed
  // into the operator's next message.
  flight.phase = 'seeding';
  flight.stop = async () => {
    flight.stopped = true;
    return inner.abort('claude', sessionId);
  };
  if (flight.stopped) return ENDED;
  const seedWriter = createSeedWriter({ target: writer, sessionId, oldProviderSessionId, oldTranscriptPath, facts, seed: success.seed });
  const seedOptions: AnyRecord = { ...options };
  for (const key of NOT_FOR_THE_SEED) delete seedOptions[key];
  Object.assign(seedOptions, {
    sessionId,
    cwd: options.cwd,
    projectPath: options.projectPath,
    node: options.node,
  });
  let runFailure: string | null = null;
  try {
    await inner.run('claude', '', { ...seedOptions, resumeFromScratch: true, transcriptAppend: success.seed, compactionSeed: true }, seedWriter);
  } catch (error) {
    runFailure = error instanceof Error ? error.message : String(error);
  }
  seedWriter.release();

  // 8. Success is the announcement AND the held `complete` of a turn that finished.
  const held = seedWriter.heldComplete;
  const tookHold = seedWriter.swapped && held !== null && held.exitCode === 0 && held.aborted !== true;
  if (tookHold) {
    if (seedWriter.lastBudgetUsed !== null) {
      try {
        sessionCompactionsDb.setCompactionPostTokens(oldProviderSessionId, seedWriter.lastBudgetUsed);
      } catch (error) {
        console.error(`[compaction] session=${sessionId} could not record the context after:`, error instanceof Error ? error.message : error);
      }
    }
    console.log(`[compaction] session=${sessionId} trigger=${trigger} compacted onto ${seedWriter.announcedProviderSessionId} (${facts.preTokens ?? '?'} → ${seedWriter.lastBudgetUsed ?? '?'} tokens)`);
    writer.send(held);
    return ENDED;
  }

  const reason = runFailure
    ?? seedWriter.swapFailure
    ?? (seedWriter.announcedProviderSessionId === null ? 'the new session never started' : 'the new session did not finish taking the seed');
  // The seed append's process is registered under the chat's key: left running, the next message joins it, on the
  // seed session, while the row says the old one. A Stop already retired it.
  if (!flight.stopped) {
    try {
      await inner.abort('claude', sessionId);
    } catch (error) {
      console.error(`[compaction] session=${sessionId} could not retire the seed's process:`, error instanceof Error ? error.message : error);
    }
  }
  takeTheSwapBack(run, { oldProviderSessionId, oldTranscriptPath, newProviderSessionId: seedWriter.announcedProviderSessionId, swapped: seedWriter.swapped });
  run.emit(errorFrame(sessionId, `Compaction failed: ${reason}. The chat stays on its current session.`));
  run.emit(completeFrame(sessionId, 1));
  pushAutomaticFailure(run, reason);
  return FAILED;
}

/** Puts the chat back on its old session when the swap was written; the unswap also records the abandoned seed. */
function takeTheSwapBack(
  run: Run,
  input: { oldProviderSessionId: string; oldTranscriptPath: string; newProviderSessionId: string | null; swapped: boolean },
): void {
  if (!input.swapped || input.newProviderSessionId === null) return;
  try {
    sessionCompactionsDb.unswapCompactedSession({
      sessionId: run.sessionId,
      oldProviderSessionId: input.oldProviderSessionId,
      oldJsonlPath: input.oldTranscriptPath,
      newProviderSessionId: input.newProviderSessionId,
    });
  } catch (error) {
    console.error(`[compaction] session=${run.sessionId} could not take the swap back:`, error instanceof Error ? error.message : error);
  }
}

/** 9. An automatic compaction that failed is reported by push: nobody pressed Compact, so nobody is watching. */
function pushAutomaticFailure(run: Run, reason: string): void {
  // A Stop is the operator's own act: he is not told that what he stopped failed.
  if (run.trigger === 'manual' || run.flight.stopped) return;
  const userId = run.writer.userId ?? null;
  notifyUserIfEnabled({
    userId,
    event: (createNotificationEvent as (input: object) => object)({
      provider: 'claude',
      sessionId: run.sessionId,
      kind: 'error',
      code: 'compaction.failed',
      meta: { trigger: run.trigger, reason },
      severity: 'error',
      dedupeKey: `claude:compaction:failed:${run.sessionId}`,
    }),
  });
}
