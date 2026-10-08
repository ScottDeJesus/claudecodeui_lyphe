import { sessionsDb } from '@/modules/database/index.js';
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

/**
 * THE TRIGGERS: the runtime's `turnEnded` and `activityChanged` hooks, and the idle deadline. The
 * operator's ruling, 2026-10-08: "compaction at 50% context on turn end only never in the middle of
 * work. Then let's replace idle compaction with our own model, keep the autocompact there just in
 * case." Nothing here compacts mid-turn, nothing polls, and with the switch off nothing here does
 * anything at all.
 *
 * - TURN END: a turn that leaves the chat at or past `AUTO_COMPACT_FRACTION` of its window starts a
 *   detached `/compact` run at once, or — when background work is live — is kept as the chat's pending
 *   compaction and started by the `activityChanged` that says the process went quiet.
 * - IDLE: every turn end (re)arms ONE unref'd timeout per chat; it fires once, `IDLE_COMPACT_AFTER_MS`
 *   later (the CLI's own moment: 0.9 of the one-hour prompt cache), and is replaced by the next turn's end.
 *
 * Consumer: compaction-runtime.ts, which registers `turnEnded` and `activityChanged` with the runtime.
 */

const AUTO_COMPACT_FRACTION = 0.5;
const IDLE_COMPACT_AFTER_MS = 3_240_000;
const IDLE_COMPACT_MIN_TOKENS = 200_000;

/** A positive finite number from the environment, read at the call (the probes' seam), or null. */
function numberFromEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const autoFraction = (): number => numberFromEnv('CUSTOM_COMPACTION_AUTO_FRACTION') ?? AUTO_COMPACT_FRACTION;
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
  inner: { activity(provider: LLMProvider, appSessionId: string): ChatProcessActivity };
  /** The decorator itself: the detached run goes THROUGH it, so its `/compact` interception sees the run. */
  runtime: () => ProviderRuntimeGateway;
};

export function createAutoTrigger(
  deps: TriggerDependencies,
): Pick<ChatCompactionHooks, 'turnEnded' | 'activityChanged'> & { stop(): void } {
  // Set once, at shutdown: from then on nothing here starts a run, and no deadline is armed.
  let stopped = false;
  const pending = new Map<string, ChatTurnReport>();
  const idleDeadlines = new Map<string, { timer: NodeJS.Timeout; report: ChatTurnReport }>();

  const clearIdle = (sessionId: string): void => {
    const held = idleDeadlines.get(sessionId);
    if (held) clearTimeout(held.timer);
    idleDeadlines.delete(sessionId);
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

  /** Why a report is not due, or null when it is. Order follows the rules: window, takeover, flight, refusal. */
  const notDueBecause = (report: ChatTurnReport): string | null => {
    if (report.aborted) return 'not due: the turn was stopped';
    const { contextTokens, contextWindow } = report;
    if (contextTokens === null || contextWindow === null) return 'not due: the context is not known';
    const fraction = autoFraction();
    if (contextTokens < fraction * contextWindow) {
      return `not due: ${((contextTokens / contextWindow) * 100).toFixed(1)}% of the window, due at ${(fraction * 100).toFixed(1)}%`;
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
      compactionMode().then(() => turnEnded(report), (error: unknown) => {
        console.error(`[compaction] session=${sessionId} could not read the mode:`, error instanceof Error ? error.message : error);
      });
      return;
    }
    // The switch is off or the summarizer cannot be served: this module does nothing at all.
    if (!taken) return;

    if (report.seed) {
      logDecision(sessionId, 'turn-end', report, report.activity, 'a seed turn arms nothing');
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

  /** (Re)arms the chat's one idle deadline. A server restart drops it; the chat's next turn end arms it again. */
  function armIdleDeadline(report: ChatTurnReport): void {
    const sessionId = report.appSessionId;
    if (stopped) return;
    const timer = setTimeout(() => {
      idleDeadlines.delete(sessionId);
      fireIdleDeadline(report).catch((error: unknown) => {
        console.error(`[compaction] session=${sessionId} the idle deadline failed:`, error instanceof Error ? error.message : error);
      });
    }, idleAfterMs());
    timer.unref();
    idleDeadlines.set(sessionId, { timer, report });
  }

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
    const reason = chatRunRegistry.isProcessing(sessionId)
      ? 'a run is in progress'
      : activity.busy
        ? 'the process is busy'
        : flightOf(sessionId)
          ? 'a compaction is already in flight'
          : isRefusedAutomatic(sessionId) ? 'the chat is under an automatic refusal' : null;
    if (reason !== null) {
      logDecision(sessionId, 'idle', report, activity, `left alone: ${reason}`);
      return;
    }
    logDecision(sessionId, 'idle', report, activity, 'idle, starting the compaction');
    startRun(report, 'idle');
  }

  /** Shutdown: clears every deadline and pending wake and starts nothing more. A process that is leaving must not begin a verb its successor cannot see. */
  const stop = (): void => {
    stopped = true;
    for (const { timer } of idleDeadlines.values()) clearTimeout(timer);
    idleDeadlines.clear();
    pending.clear();
  };

  return { turnEnded, activityChanged, stop };
}
