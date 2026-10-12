import { sessionCompactionsDb, sessionsDb } from '@/modules/database/index.js';
import { broadcastSessionUpserted, chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { ChatCompactionHooks, ChatProcessActivity, ChatTurnReport, LLMProvider } from '@/shared/types.js';

import { logDecision } from './compaction-log.js';
import { compactionMode, takeoverSnapshot, takesOver } from './compaction-mode.js';
import {
  flightOf,
  forgetSession,
  isRefusedAutomatic,
  publishActivity,
  rememberTurnContext,
} from './compaction-registry.js';
import { createRestoreSpacer, planIdleRestore } from './idle-restore.js';

/**
 * THE TRIGGERS: the runtime's `turnEnded` and `activityChanged` hooks, and the idle deadline. The
 * operator's ruling, 2026-10-08: "compaction at 50% context on turn end only never in the middle of
 * work. Then let's replace idle compaction with our own model, keep the autocompact there just in
 * case." Nothing here compacts mid-turn, nothing polls, and with the switch off nothing here does
 * anything at all.
 *
 * - TURN END: a turn that leaves the chat at or past `AUTO_COMPACT_FRACTION` of its window — and, for a
 *   chat compacted before, `MIN_GROWTH_FRACTION` of the window past where its latest compaction left it —
 *   starts a detached `/compact` run at once, or — when background work is live — is kept as the chat's
 *   pending compaction and started by the `activityChanged` that says the process went quiet.
 * - IDLE: every turn end (re)arms ONE unref'd timeout per chat; it fires once, `IDLE_COMPACT_AFTER_MS`
 *   later (the CLI's own moment: 0.9 of the one-hour prompt cache), and is replaced by the next turn's end.
 *   A deadline that finds the process busy or a run in progress is kept and decided again, whole, by the
 *   `activityChanged` that says the process went quiet; the next turn's end drops it with the deadline.
 *   A server restart does not drop it: the boot's re-adoption reports each adopted chat's last turn end
 *   (`turnRestored`), and the deadline is armed again for the remainder of the wait — or, when the wait has
 *   run out, for a short settle after re-adoption, queued behind the other overdue chats (`idle-restore.ts`).
 *   One turn end's idle check starts at most `IDLE_CHECK_MAX_TRIES` compactions, counted in the chat's host
 *   meta before each start, so a restart never repeats it without bound.
 *
 * Consumer: compaction-runtime.ts, which registers `turnEnded`, `turnRestored` and `activityChanged` with the runtime.
 */

const AUTO_COMPACT_FRACTION = 0.5;
// How much the context must grow past the latest compaction's own result before a turn end is due again.
// The operator block only grows, so a seed at or past half the window would leave the first turn after
// every compaction due once more — a loop of compactions each minutes long. Normal seeds never meet the
// bound (a 60K seed on a 1M window compacts at 500K); the idle trigger needs none.
const MIN_GROWTH_FRACTION = 0.2;
const IDLE_COMPACT_AFTER_MS = 3_240_000;
const IDLE_COMPACT_MIN_TOKENS = 200_000;

/** A finite number from the environment, read at the call (the probes' seam), or null. */
function finiteNumberFromEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** A positive finite number from the environment, read at the call (the probes' seam), or null. */
function numberFromEnv(name: string): number | null {
  const value = finiteNumberFromEnv(name);
  return value !== null && value > 0 ? value : null;
}

const autoFraction = (): number => numberFromEnv('CUSTOM_COMPACTION_AUTO_FRACTION') ?? AUTO_COMPACT_FRACTION;
// Any finite number, a negative one included. The context's growth since a compaction is a turn end's count minus the
// compaction's post-append count, two instruments that disagree by a stable ~1.7-2.1K, so a chat that has just been compacted
// and answered once reads NEGATIVE growth: only a bound below zero lets such a turn through, and a probe needs that.
const minGrowthFraction = (): number => finiteNumberFromEnv('CUSTOM_COMPACTION_MIN_GROWTH') ?? MIN_GROWTH_FRACTION;
// The longest delay `setTimeout` takes: past it Node clamps the delay to 1 ms, so an override this large
// would fire the idle compaction at once instead of never.
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const idleAfterMs = (): number => {
  const override = numberFromEnv('CUSTOM_COMPACTION_IDLE_AFTER_MS');
  return override !== null && override <= MAX_TIMER_DELAY_MS ? override : IDLE_COMPACT_AFTER_MS;
};
const idleMinTokens = (): number => numberFromEnv('CUSTOM_COMPACTION_IDLE_MIN_TOKENS') ?? IDLE_COMPACT_MIN_TOKENS;

const nodeOf = (report: ChatTurnReport): string | null =>
  typeof report.sendOptions.node === 'string' && report.sendOptions.node ? report.sendOptions.node : null;

/** The seam to the rest of the module; `compaction-runtime.ts` supplies both. */
type TriggerDependencies = {
  inner: {
    activity(provider: LLMProvider, appSessionId: string): ChatProcessActivity;
    /** Writes the idle check's start into the chat's host meta, so a restart knows how many starts this turn end has had. */
    markIdleCheck(provider: LLMProvider, appSessionId: string, tries: number): boolean;
  };
  /** The decorator itself: the detached run goes THROUGH it, so its `/compact` interception sees the run. */
  runtime: () => ProviderRuntimeGateway;
};

export function createAutoTrigger(
  deps: TriggerDependencies,
): Pick<ChatCompactionHooks, 'turnEnded' | 'turnRestored' | 'activityChanged'> & { stop(): void } {
  // Set once, at shutdown: from then on nothing here starts a run, and no deadline is armed.
  let stopped = false;
  const pending = new Map<string, ChatTurnReport>();
  const idleDeadlines = new Map<string, { timer: NodeJS.Timeout; report: ChatTurnReport }>();
  // A deadline that was left alone for a busy process or a run: the report it fired for, until the process goes quiet.
  const idleRetries = new Map<string, ChatTurnReport>();
  // How many compactions the idle check has started for the chat's current turn end, kept beside the host's meta copy (a
  // restart reads that one back). A turn end clears it, with the deadline: its idle check starts again from none.
  const idleStarts = new Map<string, number>();
  const restoreSpacer = createRestoreSpacer();

  const clearIdle = (sessionId: string): void => {
    const held = idleDeadlines.get(sessionId);
    if (held) clearTimeout(held.timer);
    idleDeadlines.delete(sessionId);
    idleRetries.delete(sessionId);
    idleStarts.delete(sessionId);
  };

  /**
   * Starts the detached `/compact` run. Called SYNCHRONOUSLY from the turn-end hook: the turn's
   * `complete` has gone out, and the registry's queued-message pass waits on a `setImmediate`, so this
   * reservation lands first — a queued message then waits for the compaction and lands in the new session.
   */
  const startRun = (report: ChatTurnReport, trigger: 'auto' | 'idle'): void => {
    const sessionId = report.appSessionId;
    if (stopped) return;
    runDetachedChatTurn(
      {
        sessionId,
        userId: report.userId,
        content: '/compact',
        options: { ...report.sendOptions, compactionTrigger: trigger },
        // A compaction is housekeeping, not an answer: its `complete` must not stamp the chat as freshly
        // completed, which would light the unread dot on a chat the operator had read (an idle compaction
        // fires 54 minutes after the last turn, when nobody is looking). The registry's door for this is
        // `completionAlreadyRecorded`; the listeners still hear the run end.
        beforeRun: (run) => {
          run.completionAlreadyRecorded = true;
        },
      },
      { runtime: deps.runtime() },
    ).then(
      (outcome) => {
        if (!outcome.started) logDecision(sessionId, trigger, report, report.activity, `did not start: ${outcome.error}`);
        // The completion broadcast is skipped with its stamp, and an open tab refetches the history on an
        // upsert: tell it the swap's last fact (the context after) is in.
        else broadcastSessionUpserted(sessionId).catch((error: unknown) => {
          console.error(`[compaction] session=${sessionId} could not announce the finished compaction:`, error instanceof Error ? error.message : error);
        });
      },
      (error: unknown) => {
        console.error(`[compaction] session=${sessionId} trigger=${trigger} could not start:`, error instanceof Error ? error.message : error);
      },
    );
  };

  /** Why a report is not due, or null when it is. Order follows the rules: window, growth, takeover, flight, refusal. */
  const notDueBecause = (report: ChatTurnReport): string | null => {
    if (report.aborted) return 'not due: the turn was stopped';
    const { contextTokens, contextWindow } = report;
    if (contextTokens === null || contextWindow === null) return 'not due: the context is not known';
    const fraction = autoFraction();
    if (contextTokens < fraction * contextWindow) {
      return `not due: ${((contextTokens / contextWindow) * 100).toFixed(1)}% of the window, due at ${(fraction * 100).toFixed(1)}%`;
    }
    // A chat with no record, or one whose record has no `post_tokens` yet, is not held by the guard.
    const postTokens = sessionCompactionsDb.latestCompaction(report.appSessionId)?.postTokens ?? null;
    if (postTokens !== null) {
      const grew = contextTokens - postTokens;
      const needed = minGrowthFraction() * contextWindow;
      if (grew < needed) {
        return `not due: the context grew ${Math.round(grew)} since the last compaction, under ${Math.round(needed)}`;
      }
    }
    if (nodeOf(report) !== null) return 'not taken over: the chat is placed on a node';
    if (flightOf(report.appSessionId)) return 'not due: a compaction is already in flight';
    if (isRefusedAutomatic(report.appSessionId)) return 'not due: the chat is under an automatic refusal';
    return null;
  };

  const turnEnded = (report: ChatTurnReport): void => {
    const sessionId = report.appSessionId;
    rememberTurnContext(report);
    pending.delete(sessionId);
    clearIdle(sessionId);

    if (stopped) return;
    const taken = takeoverSnapshot();
    if (taken === null) {
      // Nothing has asked since this server started (a re-adopted chat's first turn end): ask now, then
      // decide. Slower than the synchronous path — a queued message may take the session first, and the
      // next turn end tries again.
      // The `.catch` covers the decision itself too: it now reads the record, and a throw out of this
      // `.then` would otherwise surface as an unhandled rejection, which ends the process.
      compactionMode().then(() => turnEnded(report)).catch((error: unknown) => {
        console.error(`[compaction] session=${sessionId} could not read the mode or decide on the turn end:`, error instanceof Error ? error.message : error);
      });
      return;
    }
    // The switch is off or the summarizer cannot be served: this module does nothing at all.
    if (!taken) return;

    if (report.seed) {
      logDecision(sessionId, 'turn-end', report, report.activity, 'a seed append arms nothing');
      return;
    }
    armIdleDeadline(report);

    const reason = notDueBecause(report);
    if (reason !== null) {
      logDecision(sessionId, 'turn-end', report, report.activity, reason);
    } else if (report.activity.busy) {
      pending.set(sessionId, report);
      logDecision(sessionId, 'turn-end', report, report.activity, 'due, kept pending until the process goes quiet');
    } else {
      logDecision(sessionId, 'turn-end', report, report.activity, 'due, starting the compaction');
      startRun(report, 'auto');
    }
  };

  const activityChanged = (sessionId: string, activity: ChatProcessActivity): void => {
    publishActivity(sessionId, activity);
    if (!stopped && !activity.busy) retryIdle(sessionId);
    const report = pending.get(sessionId);
    if (stopped || !report || activity.busy) return;
    pending.delete(sessionId);
    if (takeoverSnapshot() === false) return;
    if (chatRunRegistry.isProcessing(sessionId)) {
      logDecision(sessionId, 'activity', report, activity, 'pending compaction dropped: a run is in progress');
      return;
    }
    const reason = flightOf(sessionId)
      ? 'a compaction is already in flight'
      : isRefusedAutomatic(sessionId) ? 'the chat is under an automatic refusal' : null;
    if (reason !== null) {
      logDecision(sessionId, 'activity', report, activity, `pending compaction dropped: ${reason}`);
      return;
    }
    logDecision(sessionId, 'activity', report, activity, 'the process went quiet, starting the pending compaction');
    startRun(report, 'auto');
  };

  /** Runs the idle decision for a report; a throw is logged, never left to surface as an unhandled rejection. */
  const decideIdle = (report: ChatTurnReport): void => {
    fireIdleDeadline(report).catch((error: unknown) => {
      console.error(`[compaction] session=${report.appSessionId} the idle deadline failed:`, error instanceof Error ? error.message : error);
    });
  };

  /** The idle deadline's second chance: the process just went quiet, so a deadline kept for it is decided again. Once per kept deadline. */
  const retryIdle = (sessionId: string): void => {
    const report = idleRetries.get(sessionId);
    if (!report) return;
    idleRetries.delete(sessionId);
    decideIdle(report);
  };

  /** (Re)arms the chat's one idle deadline: a whole wait after a turn end, the remainder of it after a restart. */
  function armIdleDeadline(report: ChatTurnReport, delayMs: number = idleAfterMs()): void {
    const sessionId = report.appSessionId;
    if (stopped) return;
    const timer = setTimeout(() => {
      idleDeadlines.delete(sessionId);
      decideIdle(report);
    }, delayMs);
    timer.unref();
    idleDeadlines.set(sessionId, { timer, report });
  }

  /**
   * The deadline a restart dropped, armed again from the chat's last turn end as its host's journal records it. The
   * fire goes through `fireIdleDeadline`'s own gates, so a restored deadline never starts a compaction in a chat
   * that is mid-turn or busy: it is left for the process's next quiet like any other.
   */
  const turnRestored = (report: ChatTurnReport, endedAt: number, triesSoFar: number): void => {
    const sessionId = report.appSessionId;
    // A chat on a node runs its own copy there. A turn that ended since this boot already armed a newer deadline.
    if (stopped || nodeOf(report) !== null || idleDeadlines.has(sessionId)) return;
    if (takeoverSnapshot() === false) return;
    const plan = planIdleRestore(report, endedAt, {
      now: Date.now(),
      idleAfterMs: idleAfterMs(),
      minTokens: idleMinTokens(),
      idleTries: triesSoFar,
      spacer: restoreSpacer,
    });
    // A chat compacted since that turn no longer stands at the size the turn left, so its context is not kept as the chat's.
    if (plan.current) rememberTurnContext(report);
    logDecision(sessionId, 'idle', report, report.activity, plan.say);
    if (!plan.arm) return;
    idleStarts.set(sessionId, triesSoFar);
    armIdleDeadline(report, plan.delayMs);
  };

  async function fireIdleDeadline(report: ChatTurnReport): Promise<void> {
    const sessionId = report.appSessionId;
    const activityNow = (): ChatProcessActivity => deps.inner.activity('claude', sessionId);
    if (!sessionsDb.getSessionById(sessionId)) {
      forgetSession(sessionId);
      logDecision(sessionId, 'idle', report, activityNow(), 'the chat no longer exists');
      return;
    }
    const minTokens = idleMinTokens();
    if (report.contextTokens === null || report.contextTokens < minTokens) {
      logDecision(sessionId, 'idle', report, activityNow(), `not due: the context is under ${minTokens} tokens`);
      return;
    }
    if (!(await takesOver({ appSessionId: sessionId, node: nodeOf(report) }))) {
      logDecision(sessionId, 'idle', report, activityNow(), 'not taken over');
      return;
    }
    // Everything below is synchronous up to the start, so nothing can slip in between check and run.
    if (stopped) return;
    const activity = activityNow();
    // A run or a busy process ends on its own, so those two are kept for the activity hook's next "quiet"; a flight or a
    // refusal is not waited out (a flight's own end is a turn end, which re-arms the deadline).
    const busyReason = chatRunRegistry.isProcessing(sessionId) ? 'a run is in progress' : activity.busy ? 'the process is busy' : null;
    const reason = busyReason ?? (flightOf(sessionId)
      ? 'a compaction is already in flight'
      : isRefusedAutomatic(sessionId) ? 'the chat is under an automatic refusal' : null);
    if (reason !== null) {
      logDecision(sessionId, 'idle', report, activity, `left alone: ${reason}`);
      if (busyReason !== null) idleRetries.set(sessionId, report);
      return;
    }
    logDecision(sessionId, 'idle', report, activity, 'idle, starting the compaction');
    // Recorded BEFORE the start, in the host's meta: a handover that cuts the compaction short must still find the try counted.
    const starts = (idleStarts.get(sessionId) ?? 0) + 1;
    idleStarts.set(sessionId, starts);
    deps.inner.markIdleCheck('claude', sessionId, starts);
    startRun(report, 'idle');
  }

  /** Shutdown: clears every deadline and pending wake and starts nothing more. A process that is leaving must not begin a verb its successor cannot see. */
  const stop = (): void => {
    stopped = true;
    for (const { timer } of idleDeadlines.values()) clearTimeout(timer);
    idleDeadlines.clear();
    idleRetries.clear();
    idleStarts.clear();
    pending.clear();
  };

  return { turnEnded, turnRestored, activityChanged, stop };
}
