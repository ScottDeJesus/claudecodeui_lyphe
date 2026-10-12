/**
 * The Claude runtime's seams to a custom compaction it never imports.
 *
 * The runtime learns everything about the compaction through its context
 * (`context.compaction`, `ProviderRuntimeContext`) and imports nothing from the compaction module,
 * which builds on these seams from the other side. Every body lives here so that
 * claude-runtime.provider.js — far over the module ceiling — takes call-in lines only:
 *
 * - the one constant of what the CLI is told while a chat's compaction is taken over, and the three
 *   functions that put it on a launch, read it back into a launch profile and apply it live;
 * - the question "is this chat taken over?" asked of the hooks, which fails closed;
 * - the transcript append a seed travels as (a message the CLI keeps without a turn of its own), the
 *   ledger that tells an append's `result` from a turn's, and the context count the CLI gives for it;
 * - the end-of-turn report: the turn's last main-thread budget, the window of the model that ran it,
 *   the send options without what one turn carries, and the process's activity;
 * - the process's activity, as the handle and `claudeRuntime.activity` answer it.
 *
 * Every hook call is wrapped: a hook that throws (or rejects) is logged and the turn goes on, because
 * a compaction must never be able to break the reply it follows.
 *
 * consumer: claude-runtime.provider.js, chat-process.ts (the profile's reading of the constant)
 */

import { randomUUID } from 'node:crypto';

import type {
  AnyRecord,
  ChatProcessActivity,
  ChatTurnReport,
  ProviderRuntimeContext
} from '@/shared/types.js';

import { CLAUDE_ULTRACODE_EFFORT } from './claude-model-options.js';

/**
 * What the CLI is told, at launch and through a live `applyFlagSettings`, while a chat's compaction
 * is taken over by the house. ONE constant, and nothing else belongs in it (the operator, 2026-10-08:
 * "Let's do compaction at 50% context on turn end only never in the middle of work. Then let's
 * replace idle compaction with our own model, keep the autocompact there just in case").
 *
 * `idleCompaction: false` turns off the CLI's own idle compaction, which the house replaces with its
 * own idle trigger on the summarizer model. `autoCompactEnabled` is deliberately NOT here: the CLI's
 * threshold compaction, its compaction at overflow and its precompute all hang on it, and they are
 * the net under the house's own. Measured on 2.1.293 with no model call: `getSettings()` reads back
 * `effective.idleCompaction=false` at launch and after a live apply, and
 * `getContextUsage().isAutoCompactEnabled` stays true throughout.
 */
export const CLI_COMPACTION_SETTINGS = { idleCompaction: false } as const;

/**
 * What a live `applyFlagSettings` is handed to give a chat back to the CLI's own idle compaction when
 * its process was LAUNCHED taken over: each key at the CLI's DEFAULT (`idleCompaction` is read as
 * `settings("idleCompaction", true)`, so `true` is exactly what an unset key means).
 *
 * Not `null` for that process. Measured on 2.1.293 with no model call: a launch holds
 * `idleCompaction=false` in the flag layer's base, and a live `null` clears only what a live apply
 * added, so `effective.idleCompaction` keeps reading `false` — a chat whose switch was turned off
 * would keep its idle compaction disabled for the rest of that process's life. `true` overrides the
 * launch value. (It also overrides an `idleCompaction` the operator set in a settings file; a launch
 * argument cannot be taken back live, and the only other way is a respawn, which ends background work.)
 */
const CLI_COMPACTION_DEFAULTS = { idleCompaction: true } as const;

const COMPACTION_SETTING_KEYS = Object.keys(CLI_COMPACTION_SETTINGS) as Array<keyof typeof CLI_COMPACTION_SETTINGS>;

/**
 * Merges `CLI_COMPACTION_SETTINGS` into the launch's `settings`, beside ultracode's, when the chat is
 * taken over. A chat that is not taken over is left exactly as it was: the launch the CLI receives is
 * byte-identical to a build without this seam.
 */
export function applyCompactionSettings(sdkOptions: { settings?: unknown }, takenOver: boolean): void {
  if (!takenOver) return;
  const existing = sdkOptions.settings;
  if (typeof existing === 'string') {
    // A settings FILE path cannot be merged into; the option mapper never produces one.
    console.warn('[Claude SDK] Launch settings are a file path, so the compaction settings were not applied');
    return;
  }
  sdkOptions.settings = { ...(existing && typeof existing === 'object' ? existing : {}), ...CLI_COMPACTION_SETTINGS };
}

/**
 * Whether a launch's `settings` carry the compaction constant — how a launch profile knows its
 * process was launched taken over. A missing or non-object `settings` reads as not taken over.
 */
export function compactionTakenOverOf(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const record = settings as Record<string, unknown>;
  return COMPACTION_SETTING_KEYS.every((key) => record[key] === CLI_COMPACTION_SETTINGS[key]);
}

/**
 * The keys to hand a running query's `applyFlagSettings`: the constant when the chat is taken over;
 * when it is not, the CLI's defaults for a process LAUNCHED taken over (`CLI_COMPACTION_DEFAULTS`),
 * and `null` — which removes the live value and lets the operator's own setting show again — for a
 * process that was only flipped on live. `launchedTakenOver` is fixed at the process's launch; a
 * profile whose launch is unknown (a re-adopted host with no record) is treated as launched on.
 */
export function compactionFlagSettings(
  takenOver: boolean,
  launchedTakenOver: boolean
): Record<string, boolean | null> {
  if (takenOver) return { ...CLI_COMPACTION_SETTINGS };
  if (launchedTakenOver) return { ...CLI_COMPACTION_DEFAULTS };
  return Object.fromEntries(COMPACTION_SETTING_KEYS.map((key) => [key, null]));
}

type CompactionContext = Pick<ProviderRuntimeContext, 'compaction'>;

const loggedFailure = (what: string) => (error: unknown): void => {
  console.warn(`[Claude SDK] The compaction hook ${what} failed; the turn goes on:`, error instanceof Error ? error.message : error);
};

// The send awaits the answer, so a hook that never settles must not hold the reply: past this it
// answers "not taken over" (the CLI compacts as it always did) and the next message asks again.
const TAKES_OVER_DEADLINE_MS = 10_000;

/**
 * Asks whether this message's chat is taken over by the house's compaction. A run with no app session
 * id (the git and agent modules' one-shots) is never taken over and never asks; a hook that throws,
 * or does not answer within `TAKES_OVER_DEADLINE_MS`, answers "not taken over".
 */
export async function askCompactionTakesOver(context: CompactionContext, options: AnyRecord): Promise<boolean> {
  const appSessionId = typeof options.sessionId === 'string' && options.sessionId ? options.sessionId : null;
  if (appSessionId === null) return false;
  const node = typeof options.node === 'string' && options.node ? options.node : null;
  let deadline: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      context.compaction.takesOver({ appSessionId, node }),
      new Promise<'late'>((resolve) => {
        deadline = setTimeout(() => resolve('late'), TAKES_OVER_DEADLINE_MS);
        deadline.unref();
      })
    ]);
    if (answer === 'late') {
      console.warn(`[Claude SDK] The compaction hook takesOver did not answer within ${TAKES_OVER_DEADLINE_MS} ms; the chat is not taken over this time`);
      return false;
    }
    return answer === true;
  } catch (error) {
    loggedFailure('takesOver')(error);
    return false;
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * The SDK user message a send's `options.transcriptAppend` becomes: an array of strings, each one text
 * block, appended to the conversation WITHOUT a turn of its own (`shouldQuery: false` — the SDK keeps
 * it in the transcript and merges it into the next user message that does query). Empty strings are
 * dropped (the API refuses an empty text block); null when `blocks` is not an array or none is left.
 * The `uuid` is what the CLI keeps on the transcript row and echoes on the append's own `result`
 * (`user_message_uuids`), which is how `createAppendLedger` knows that result.
 */
export function transcriptAppendMessage(blocks: unknown): {
  type: 'user';
  message: { role: 'user'; content: Array<{ type: 'text'; text: string }> };
  parent_tool_use_id: null;
  shouldQuery: false;
  uuid: string;
  timestamp: string;
} | null {
  if (!Array.isArray(blocks)) return null;
  const content = blocks
    .filter((block): block is string => typeof block === 'string' && block.length > 0)
    .map((text) => ({ type: 'text' as const, text }));
  if (content.length === 0) return null;
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    shouldQuery: false,
    uuid: randomUUID(),
    timestamp: new Date().toISOString()
  };
}

/**
 * The appends one process has pushed, kept by uuid. The CLI answers an append with a `result` of its
 * own (zero turns, all-zero usage) whose `user_message_uuids` hold only the append's uuid: that result
 * is no turn's end, and `namesOnlyAppends` is how the loop tells it from one.
 */
export function createAppendLedger(): {
  note(messages: ReadonlyArray<{ shouldQuery?: boolean; uuid?: string }>): void;
  namesOnlyAppends(result: { user_message_uuids?: unknown }): boolean;
} {
  const appended = new Set<string>();
  return {
    /** Remembers every message of a push that is an append (`shouldQuery === false`). */
    note(messages) {
      for (const message of messages) {
        if (message.shouldQuery === false && typeof message.uuid === 'string') appended.add(message.uuid);
      }
    },
    /** True when the result's `user_message_uuids` is a non-empty array naming nothing but noted appends. */
    namesOnlyAppends(result) {
      const named = result.user_message_uuids;
      return Array.isArray(named) && named.length > 0 && named.every((uuid) => typeof uuid === 'string' && appended.has(uuid));
    }
  };
}

/**
 * The context, in tokens, the CLI itself counts for a session (`totalTokens` of `getContextUsage` — a
 * count by the token-count API, no model call). `ask` is the whole request, already bounded by the caller's grace race, and is started
 * here so that a throw on the way out is caught with a failed answer. Null — with one warning — when
 * the ask failed, was late or answered no count (an empty session never counts 0): a missing number costs the composer one reading,
 * never the turn it follows.
 */
export async function askContextTokens(ask: () => Promise<unknown>, sessionKey: string): Promise<number | null> {
  try {
    const answer = await ask();
    const total = answer && typeof answer === 'object' ? (answer as { totalTokens?: unknown }).totalTokens : undefined;
    if (typeof total === 'number' && Number.isFinite(total) && total > 0) return total;
    console.warn(`[Claude SDK] getContextUsage for session ${sessionKey} answered no token count; no token_budget was sent`);
  } catch (error) {
    console.warn(`[Claude SDK] getContextUsage for session ${sessionKey} failed (${error instanceof Error ? error.message : error}); no token_budget was sent`);
  }
  return null;
}

// What one turn carries and no later turn may inherit. `keepalive` joins the spec's list for a reason
// of its own: it is the re-adoption descriptor of a re-adopted run, and a compaction that sent it
// again would try to attach to a host that is gone instead of starting a session.
const PER_TURN_SEND_OPTIONS = [
  'attachments',
  'images',
  'files',
  'transcriptAppend',
  'resumeFromScratch',
  'resumeAnchorId',
  'compactionSeed',
  'compactionTrigger',
  'keepalive'
] as const;

/** The launch profile's fields a compaction's own send needs (chat-process.ts `LaunchProfile`). */
type ProfileForSend = {
  unknown: boolean;
  model: string;
  effort: string | null;
  ultracode: boolean;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools: string[];
};

/**
 * A turn's send options without anything only that turn carries — a compaction's own send reuses the
 * rest. A re-adopted run starts with `{ cwd, keepalive }` and nothing else (re-adoption builds no
 * model options), so until a message joins that process the model, effort, permission mode and tools
 * are read from the launch profile the host recorded; a profile that was never recorded
 * (`unknown`) knows none of them, and the options stay bare.
 */
function sendOptionsOfTurn(options: AnyRecord, profile: ProfileForSend | null): AnyRecord {
  const kept: AnyRecord = { ...options };
  for (const key of PER_TURN_SEND_OPTIONS) delete kept[key];
  if (options.keepalive && profile && !profile.unknown) {
    kept.model ??= profile.model || undefined;
    kept.effort ??= (profile.ultracode ? CLAUDE_ULTRACODE_EFFORT : profile.effort) ?? undefined;
    kept.permissionMode ??= profile.permissionMode;
    kept.toolsSettings ??= {
      allowedTools: [...profile.allowedTools],
      disallowedTools: [...profile.disallowedTools],
      skipPermissions: false
    };
  }
  return kept;
}

/** Whether a turn is a compaction's own seed append (its options carry `compactionSeed: true`). */
export function isSeedAppend(options: AnyRecord | null | undefined): boolean {
  return options?.compactionSeed === true;
}

/** The last main-thread assistant request of a turn: its whole context, and the model it ran on. */
type MainThreadBudget = { used: number; model: string | null };

/**
 * The main-thread budget one assistant message reports, or null when it reports none worth keeping.
 * `tokenBudget` is what `extractTokenBudget` already read off the message (null for subagent traffic
 * and for a message with no usage). A synthetic assistant message — the CLI's own stand-in for an API
 * error — carries all-zero usage and would overwrite the last real request, so it is not a budget.
 */
export function mainThreadBudgetOf(
  message: { type?: string; message?: { model?: unknown } } | null | undefined,
  tokenBudget: { used: number } | null | undefined
): MainThreadBudget | null {
  if (message?.type !== 'assistant' || !tokenBudget) return null;
  const model = typeof message.message?.model === 'string' ? message.message.model : null;
  if (model === '<synthetic>' || !(tokenBudget.used > 0)) return null;
  return { used: tokenBudget.used, model };
}

/**
 * The context window of the model a request ran on, read off a result's `modelUsage`. An entry
 * matches when its key IS the model, starts with it and `[` (the CLI keys a long-context variant as
 * `claude-opus-4-8[1m]`), or its `canonicalModel` is it; the largest window wins when several match.
 * Null when no entry matches or the model is unknown.
 */
function contextWindowFor(modelUsage: unknown, model: string | null): number | null {
  if (!model || !modelUsage || typeof modelUsage !== 'object') return null;
  let largest: number | null = null;
  for (const [key, entry] of Object.entries(modelUsage as Record<string, unknown>)) {
    const usage = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!usage) continue;
    const matches = key === model || key.startsWith(`${model}[`) || usage.canonicalModel === model;
    const window = usage.contextWindow;
    if (matches && typeof window === 'number' && Number.isFinite(window) && window > 0) {
      largest = largest === null ? window : Math.max(largest, window);
    }
  }
  return largest;
}

/**
 * Reports the turn that just ended to the compaction. Called at the END of the result branch, after
 * the turn's own `complete` has gone out, so a hook can never delay or break the reply. A run with no
 * app session id has no chat to compact and reports nothing.
 */
export function reportTurnEnded(
  context: CompactionContext,
  turn: {
    appSessionId: string | null;
    userId: string | number | null;
    result: { modelUsage?: unknown };
    budget: MainThreadBudget | null;
    sendOptions: AnyRecord;
    profile: ProfileForSend | null;
    answered: boolean;
    aborted: boolean;
    activity: ChatProcessActivity;
  }
): void {
  const { appSessionId } = turn;
  if (!appSessionId) return;
  // Built inside the wrapped call too: a report that cannot be built is a logged line, never a throw
  // into the loop that is still serving the process.
  callHook('turnEnded', () => {
    const report: ChatTurnReport = {
      appSessionId,
      userId: turn.userId,
      contextTokens: turn.budget?.used ?? null,
      contextWindow: contextWindowFor(turn.result.modelUsage, turn.budget?.model ?? null),
      sendOptions: sendOptionsOfTurn(turn.sendOptions, turn.profile),
      answered: turn.answered,
      aborted: turn.aborted,
      seed: isSeedAppend(turn.sendOptions),
      activity: turn.activity
    };
    return context.compaction.turnEnded(report);
  });
}

/** Tells the compaction a chat's process changed what it is doing — or ended, with `live: false`. */
export function reportActivityChanged(
  context: CompactionContext,
  appSessionId: string | null | undefined,
  activity: ChatProcessActivity
): void {
  if (!appSessionId) return;
  callHook('activityChanged', () => context.compaction.activityChanged(appSessionId, activity));
}

// The system events after which the set of running background work has moved.
const BACKGROUND_ACTIVITY_SUBTYPES = new Set(['task_started', 'task_notification', 'background_tasks_changed']);

/** Whether an SDK message is one after which a chat's background work has moved. */
export function movesBackgroundActivity(message: { type?: string; subtype?: string }): boolean {
  return message.type === 'system' && typeof message.subtype === 'string' && BACKGROUND_ACTIVITY_SUBTYPES.has(message.subtype);
}

// How long a finished background task's follow-up turn is waited for. The CLI starts it ~100 ms after
// the `task_notification` (measured); a notification that wakes nothing (a task the user stopped, one
// that merged into a running turn) is released by this, one shot armed by the notification itself.
const FOLLOW_UP_GRACE_MS = 2_000;

/**
 * Holds a process "busy" between a non-ambient `task_notification` and the follow-up turn the CLI
 * starts for it: for that moment no turn is pending or in flight and no task is running, yet work is
 * about to resume, and reporting idle there lets a compaction swap the process under it. Released
 * (silently) by the follow-up's `init` or any `result`, and by the grace expiring, which calls
 * `onExpired` so the compaction hears the now-idle activity.
 */
export function createFollowUpLatch(onExpired: () => void): {
  expect(): void;
  release(): void;
  readonly expected: boolean;
} {
  let timer: NodeJS.Timeout | null = null;
  const release = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    expect() {
      release();
      timer = setTimeout(() => {
        timer = null;
        onExpired();
      }, FOLLOW_UP_GRACE_MS);
      timer.unref();
    },
    release,
    get expected() {
      return timer !== null;
    }
  };
}

const NOT_LIVE: ChatProcessActivity = { live: false, busy: false, why: null };

/** What a chat with no process to ask about is doing: nothing, and nothing to wait for. */
function notLiveActivity(): ChatProcessActivity {
  return { ...NOT_LIVE };
}

const countOf = (count: number, one: string, many: string): string => (count === 1 ? `1 ${one}` : `${count} ${many}`);

/**
 * A process's activity, from the facts its loop keeps. Busy for a turn pending or in flight, a
 * follow-up turn about to start (`createFollowUpLatch`), or background work outstanding; `why` names
 * the first that holds, in that order. A closing process is not live: the next message starts
 * another, so there is nothing to wait for.
 */
export function describeProcessActivity(state: {
  closing: boolean;
  turnOpen: boolean;
  followUpDue: boolean;
  backgroundTasks: number;
  deferredCalls: number;
}): ChatProcessActivity {
  if (state.closing) return notLiveActivity();
  if (state.turnOpen) return { live: true, busy: true, why: 'a turn is in flight' };
  if (state.followUpDue) return { live: true, busy: true, why: 'a turn is about to start' };
  if (state.backgroundTasks > 0) {
    return {
      live: true,
      busy: true,
      why: `${countOf(state.backgroundTasks, 'background task is', 'background tasks are')} running`
    };
  }
  if (state.deferredCalls > 0) {
    return {
      live: true,
      busy: true,
      why: `${countOf(state.deferredCalls, 'background call has', 'background calls have')} not reported`
    };
  }
  return { live: true, busy: false, why: null };
}

/** `claudeRuntime.activity`: the live handle's activity, or not-live for a chat with no process. */
export function liveActivityOf(entry: { process?: { activity?: ChatProcessActivity } | null } | null | undefined): ChatProcessActivity {
  return entry?.process?.activity ?? notLiveActivity();
}

/** Runs one hook call, logging a throw (or a rejected promise) instead of letting it reach the turn. */
function callHook(name: string, call: () => unknown): void {
  try {
    const returned = call();
    if (returned && typeof (returned as Promise<unknown>).catch === 'function') {
      (returned as Promise<unknown>).catch(loggedFailure(name));
    }
  } catch (error) {
    loggedFailure(name)(error);
  }
}
