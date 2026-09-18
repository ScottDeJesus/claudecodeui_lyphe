/**
 * The Claude SDK stream's own bad news, read as notification signals.
 *
 * The runtime hands every message it receives to `detectRuntimeSignals`; what comes back through
 * `context.emit` is a notification event's `kind`, `code`, `meta`, `severity` and `dedupeKey`,
 * nothing else. This module never imports the orchestrator: the callback is the only way out.
 *
 * Two memories, different in lifetime. Per run (`SignalState`): the last `api_retry`, and
 * whether this run has already said "sign in again". Per account (`claude-limit-memory`): one
 * record per rate-limit window, because limits are account-wide — a second session must not
 * re-announce what the first one did — kept on disk, because the server process that said it is
 * replaced on every save, and a window's reset timer has to outlive the run that armed it.
 */
import { accountLimitMemory, saveLimitMemory, windowMemory, type LimitMemory } from '@/modules/providers/list/claude/claude-limit-memory.js';


/** What the runtime turns into a notification event; the caller adds provider and session. */
export type RuntimeSignal = {
  kind: 'error' | 'limit';
  code: string;
  meta: Record<string, unknown>;
  severity: 'warning' | 'error';
  dedupeKey: string;
};

/** One run's memory. Created per spawned process, discarded with it. */
export type SignalState = {
  lastApiRetry: { attempt: number; maxRetries: number; errorStatus: number | null; error: string } | null;
  loginNotified: boolean;
};

/** Where a signal goes, and the app session it belongs to. */
type SignalContext = { sessionId: string | null; emit: (signal: RuntimeSignal) => void };

/** Past a day out, the reset is left to the next `allowed` event rather than a held timer. */
const RESET_TIMER_CAP_MS = 24 * 60 * 60 * 1000;
const HIGH_WARNING_PCT = 95;
/** Two readings this close together are the same window; a `resetsAt` that drifts a second is not news. */
const SAME_WINDOW_SLACK_MS = 60_000;
/** How long a warning stands when the stream names no window: past it, the next reading may warn again. */
const UNNAMED_WINDOW_TTL_MS = 60 * 60 * 1000;
const LOW_WARNING_PCT = 80;
/** Limits that stop work outright; every other limit signal is an advisory. */
const HARD_LIMIT_CODES = new Set(['limit.reached', 'limit.out_of_credits']);
/** Assistant errors that mean the credentials, not the request, are the problem. */
const LOGIN_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed']);
/** The CLI's own instrumentation line inside a failed result's `errors`. */
const INTERNAL_DIAGNOSTIC_PREFIX = '[ede_diagnostic]';
/** The two ceilings a run can end on, and the figure each one reports. */
const RUN_LIMITS: Record<string, (message: Record<string, unknown>) => Record<string, unknown>> = {
  error_max_turns: (message) => ({ limit: 'turns', numTurns: readNumber(message.num_turns) }),
  error_max_budget_usd: (message) => ({ limit: 'budget', totalCostUsd: readNumber(message.total_cost_usd) }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `resetsAt` arrives as epoch seconds; a value already in milliseconds is taken as it is. */
function toEpochMs(resetsAt: number | null): number | null {
  return resetsAt === null ? null : (resetsAt < 1e12 ? resetsAt * 1000 : resetsAt);
}

/**
 * What the window actually reads, and the step that reading falls in. The push carries the
 * reading — a weekly window warns from a quarter full, and "at 25%" is the true thing to say.
 * The step is what silences every further reading until the window returns to `allowed`.
 */
function warningReading(info: Record<string, unknown>): { pct: number; bucket: number } {
  const utilization = readNumber(info.utilization);
  const threshold = readNumber(info.surpassedThreshold);
  let raw = LOW_WARNING_PCT;
  if (utilization !== null) {
    raw = utilization * 100;
  } else if (threshold !== null) {
    // The SDK sends a fraction; a build that already scaled it is left alone.
    raw = threshold <= 1 ? threshold * 100 : threshold;
  }
  const pct = Math.round(raw);
  return { pct, bucket: pct >= HIGH_WARNING_PCT ? HIGH_WARNING_PCT : LOW_WARNING_PCT };
}

/** Severity answers one question: does this stop the work? */
function emitLimit(context: SignalContext, code: string, rateLimitType: string, meta: Record<string, unknown>, keyPart: string): void {
  context.emit({
    kind: 'limit', code, meta: { rateLimitType, ...meta },
    severity: HARD_LIMIT_CODES.has(code) ? 'error' : 'warning',
    dedupeKey: `claude:${code}:${rateLimitType}:${keyPart}`,
  });
}

/** Every `error` signal here is severity `error` too: something the run could not do. */
function emitError(context: SignalContext, code: string, meta: Record<string, unknown>, keyPart = ''): void {
  const dedupeKey = `claude:${code}:${context.sessionId ?? 'none'}${keyPart ? `:${keyPart}` : ''}`;
  context.emit({ kind: 'error', code, meta, severity: 'error', dedupeKey });
}

function clearResetTimer(memory: LimitMemory): void {
  if (memory.resetTimer) clearTimeout(memory.resetTimer);
  memory.resetTimer = null;
}

/**
 * One timer per window, announcing the reset the moment the SDK said it would come. It fires
 * through the `emit` of whichever run armed it — hours after that run ended, which is why the
 * runtime hands us a user id captured at spawn rather than a live socket.
 */
function armResetTimer(memory: LimitMemory, rateLimitType: string, resetsAt: number | null, context: SignalContext): void {
  clearResetTimer(memory);
  const resetsAtMs = toEpochMs(resetsAt);
  if (resetsAtMs === null) return;
  const delay = resetsAtMs - Date.now();
  // A reset in the past is nothing to wait for, and one a week out is left to the next
  // `allowed` event: a day-long timer is already generous for a process that may be recycled.
  if (delay <= 0 || delay > RESET_TIMER_CAP_MS) return;

  const timer = setTimeout(() => {
    memory.resetTimer = null;
    // A live `allowed` event beat the clock and already said it.
    if (memory.announcedResetsAt === null) return;
    memory.announcedResetsAt = null;
    memory.warnedBuckets.clear();
    memory.warnedWindowResetsAt = null;
    // The name goes with the window, and so must its age: a fresh `warnedAt` beside a missing name
    // reads as "the window I already warned about", which would refuse the NEXT window's name and
    // let it warn a second time an hour in.
    memory.warnedAt = 0;
    saveLimitMemory();
    emitLimit(context, 'limit.reset', rateLimitType, { resetsAt }, String(resetsAt ?? 'unknown'));
  }, delay);
  timer.unref();
  memory.resetTimer = timer;
}

function handleRateLimitEvent(message: Record<string, unknown>, context: SignalContext): void {
  // The SDK nests the reading under `rate_limit_info`; a bare info object is read as it is.
  const info = isRecord(message.rate_limit_info) ? message.rate_limit_info : message;
  const rateLimitType = readText(info.rateLimitType) ?? 'unknown';
  const status = readText(info.status);
  const resetsAt = readNumber(info.resetsAt);
  const memory = windowMemory(rateLimitType);
  const account = accountLimitMemory();

  // A limit belongs to the ACCOUNT, so what has already been said about a window is remembered for
  // the window itself — not for the run that happened to read it. Clearing the steps on any
  // `allowed` reading made every other live session re-announce the same threshold, which is one
  // buzz per session for one fact about one account.
  //
  // Only a different window forgets them, and "different" has slack: a `resetsAt` a second off the
  // one already seen is the same window described twice, and treating it as new would put the
  // per-session noise back in a worse form. A stream that names NO window cannot be identified at
  // all, so its warnings simply expire — otherwise one warning would silence that window type for
  // the life of the process.
  // An event that names no window says nothing about whether the window changed, so it neither
  // clears the steps nor forgets the name another event gave them — one session's nameless reading
  // would otherwise let the next reading warn again, which is the buzzing this exists to stop. Then
  // only the age of the warning can end it.
  const windowAt = toEpochMs(resetsAt);
  const knownAt = toEpochMs(memory.warnedWindowResetsAt);
  const sameWindow = windowAt !== null && knownAt !== null
    ? Math.abs(windowAt - knownAt) <= SAME_WINDOW_SLACK_MS
    : Date.now() - memory.warnedAt < UNNAMED_WINDOW_TTL_MS;
  if (!sameWindow) {
    memory.warnedBuckets.clear();
  }
  // A name is only ever taken from an event that carries one.
  if (windowAt !== null && !sameWindow) {
    memory.warnedWindowResetsAt = resetsAt;
  }

  if (status === 'rejected') {
    // One announcement per rejection: a window that moves its reset time is a new one.
    if (memory.announcedResetsAt !== (resetsAt ?? 0)) {
      memory.announcedResetsAt = resetsAt ?? 0;
      emitLimit(context, 'limit.reached', rateLimitType, { resetsAt }, String(resetsAt ?? 'unknown'));
      armResetTimer(memory, rateLimitType, resetsAt, context);
    } else if (!memory.resetTimer) {
      // Announced by a process that has since been replaced: the rejection stands, its timer did not.
      armResetTimer(memory, rateLimitType, resetsAt, context);
    }
  } else if (status === 'allowed') {
    // Only a window that was actually rejected has a reset worth announcing.
    if (memory.announcedResetsAt !== null) {
      const announced = memory.announcedResetsAt;
      clearResetTimer(memory);
      memory.announcedResetsAt = null;
      emitLimit(context, 'limit.reset', rateLimitType, { resetsAt }, String(announced || 'unknown'));
    }
  }

  if (status === 'allowed_warning') {
    const { pct, bucket } = warningReading(info);
    if (!memory.warnedBuckets.has(bucket)) {
      memory.warnedBuckets.add(bucket);
      memory.warnedAt = Date.now();
      emitLimit(context, 'limit.warning', rateLimitType, { resetsAt, pct }, String(bucket));
    }
  }

  // Both overage fields are optional: only the field SAYING it stopped clears the memory of
  // having announced it. An event that simply omits it is silence, not news.
  if (info.isUsingOverage === true && !memory.overageAnnounced) {
    memory.overageAnnounced = true;
    emitLimit(context, 'limit.overage', rateLimitType, { resetsAt }, 'using');
  } else if (info.isUsingOverage === false) {
    memory.overageAnnounced = false;
  }

  const overageReason = readText(info.overageDisabledReason);
  const overageStatus = readText(info.overageStatus);
  if (overageReason === 'out_of_credits') {
    if (!account.creditsExhaustedAnnounced) {
      account.creditsExhaustedAnnounced = true;
      emitLimit(context, 'limit.out_of_credits', rateLimitType, { resetsAt }, 'disabled');
    }
  } else if (info.isUsingOverage === true || (overageStatus !== null && overageStatus !== 'rejected')) {
    // Overage is available again — in use, or reported as anything but refused — so the next emptying
    // is news. Two things that are NOT that: another disabled reason (`org_level_disabled` rides on
    // every event this account sends, full wallet or empty), and an event that simply does not
    // mention overage (the `seven_day_overage_included` reading in the same run says nothing about
    // the wallet). Both re-armed the flag and announced one emptying twice.
    account.creditsExhaustedAnnounced = false;
  }
  saveLimitMemory();
}

/** Said once per run: a second push cannot make signing in any more necessary. */
function emitLoginExpired(detail: string, state: SignalState, context: SignalContext): void {
  if (state.loginNotified) return;
  state.loginNotified = true;
  emitError(context, 'login.expired', { detail });
}

/**
 * The assistant's own verdict on a failed request. It arrives once, after the SDK has run out
 * of retries — which is why the retry messages themselves are only recorded: the push says
 * "overloaded after 3 retries" rather than one push per attempt.
 */
function handleAssistantError(error: string, state: SignalState, context: SignalContext): void {
  // The retries that led here belong to THIS error, whichever branch takes it: leaving the
  // record behind would bill the next failure for attempts it never made.
  const retry = state.lastApiRetry;
  state.lastApiRetry = null;

  if (LOGIN_ERRORS.has(error)) {
    emitLoginExpired(error, state, context);
    return;
  }
  if (error === 'billing_error') {
    // The same flag the `overageDisabledReason` road sets: one emptied wallet, one push, whichever
    // road reports it and however many sessions hit it.
    const account = accountLimitMemory();
    if (!account.creditsExhaustedAnnounced) {
      account.creditsExhaustedAnnounced = true;
      saveLimitMemory();
      emitLimit(context, 'limit.out_of_credits', 'overage', { resetsAt: null }, 'billing');
    }
    return;
  }
  // A reply cut short by the output ceiling is the model's business, not the user's.
  if (error === 'max_output_tokens') return;

  emitError(context, 'api.error', {
    reason: error,
    attempts: retry?.attempt ?? 0,
    errorStatus: retry?.errorStatus ?? null,
  }, error);
}

/** A run that ended on a configured ceiling, or on an error its result message carries. */
function handleErrorResult(message: Record<string, unknown>, context: SignalContext): void {
  const subtype = readText(message.subtype) ?? 'error';
  const limitMeta = RUN_LIMITS[subtype]?.(message);
  if (limitMeta) {
    emitError(context, 'run.limit', limitMeta, String(limitMeta.limit));
    return;
  }

  // The CLI prepends its own `[ede_diagnostic] result_type=… stop_reason=…` line to `errors`;
  // it is instrumentation, not a cause, and the push says what went wrong or nothing at all.
  const errors = Array.isArray(message.errors)
    ? message.errors.map((entry) => String(entry)).filter((entry) => !entry.startsWith(INTERNAL_DIAGNOSTIC_PREFIX))
    : [];
  const error = errors.join('; ') || subtype;
  emitError(context, 'run.failed', { error }, error);
}

// Consumed by the Claude runtime: one per spawned process, handed to every detect call.
export function createSignalState(): SignalState {
  return { lastApiRetry: null, loginNotified: false };
}

// Consumed by the Claude runtime's message loop: called with every SDK message it receives.
export function detectRuntimeSignals(message: unknown, state: SignalState, context: SignalContext): void {
  if (!isRecord(message)) return;

  if (message.type === 'rate_limit_event') {
    handleRateLimitEvent(message, context);
    return;
  }

  if (message.type === 'system' && message.subtype === 'api_retry') {
    // Recorded, never announced: the assistant error that follows is the one worth a push.
    state.lastApiRetry = {
      attempt: readNumber(message.attempt) ?? 0,
      maxRetries: readNumber(message.max_retries) ?? 0,
      errorStatus: readNumber(message.error_status),
      error: readText(message.error) ?? 'unknown',
    };
    return;
  }

  if (message.type === 'assistant') {
    const error = readText(message.error);
    if (error) handleAssistantError(error, state, context);
    return;
  }

  if (message.type === 'auth_status') {
    const detail = readText(message.error);
    if (detail || message.isAuthenticating === true) {
      emitLoginExpired(detail ?? 'sign-in required', state, context);
    }
    return;
  }

  if (message.type === 'result' && readText(message.subtype) !== 'success') {
    handleErrorResult(message, context);
  }
}
