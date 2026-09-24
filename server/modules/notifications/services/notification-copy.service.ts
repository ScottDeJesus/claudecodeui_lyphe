import { humanizeTokens } from '@/shared/utils.js';

/**
 * The wording of every notification CloudCLI sends.
 *
 * One function turns a notification event into the headline and body that
 * every channel shows — web push, the desktop client and the ntfy phone push
 * all read the same two strings — so a code's copy changes here and nowhere
 * else. Nothing in this file touches the database: the orchestrator resolves
 * the session name and hands it in.
 */

/** The slice of an orchestrator event this service reads. */
type NotificationEventLike = {
  provider?: string | null;
  code?: string | null;
  meta?: Record<string, unknown> | null;
  /**
   * The display name the orchestrator resolved (meta first, then the sessions
   * table). When absent, `meta.sessionName` is used as given.
   */
  sessionName?: string | null;
};

type NotificationText = { title: string; body: string };

type CodeCopy = (context: { meta: Record<string, unknown>; providerLabel: string }) => {
  headline: string;
  body: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  system: 'System',
};

/**
 * The SDK's `rateLimitType` values, as a person says them. The Fable weekly window arrives as
 * `seven_day_overage_included` — the CLI's own label table names it "Fable limit".
 */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly Opus',
  seven_day_sonnet: 'Weekly Sonnet',
  seven_day_overage_included: 'Fable',
  overage: 'Overage',
};

/** Codes about the account's usage windows: their title names the window, never a session. */
const ACCOUNT_LIMIT_CODES = new Set(['limit.reached', 'limit.reset', 'limit.warning', 'limit.overage', 'limit.out_of_credits']);

/** Tools whose approval body is the path they touch. */
const FILE_PATH_TOOLS = new Set(['Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit']);

const PLAN_EXCERPT_CHARS = 600;
const TOOL_INPUT_JSON_CHARS = 300;

/**
 * Every body's ceiling. Web push refuses a payload over ~4 KB and the
 * orchestrator settles those refusals silently, so a long Bash command or a
 * many-option question must never be the reason a push does not arrive.
 */
const MAX_BODY_CHARS = 1000;

const FALLBACK_COPY = { headline: 'CloudCLI', body: 'You have a new notification' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A non-blank string, or a number/boolean rendered as one; null otherwise. */
function readText(value: unknown): string | null {
  if (value == null || typeof value === 'object') return null;
  const text = String(value);
  return text.trim() ? text : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Own-property lookup, so a code like `constructor` never reaches Object.prototype. */
function lookup(table: Record<string, string>, key: unknown): string | null {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null;
}

function providerLabel(provider: unknown): string {
  return lookup(PROVIDER_LABELS, provider) || 'Assistant';
}

function windowLabel(meta: Record<string, unknown>): string {
  return lookup(WINDOW_LABELS, meta.rateLimitType) ?? 'Usage';
}

/** Windows a week long: their reset is days out, so a bare time does not say which day. */
const WEEK_WINDOWS = new Set(['seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included']);

/**
 * `resetsAt` arrives as the SDK's epoch number: seconds below 1e12, milliseconds above. A weekly
 * window — or any reset that is not today — names its day (`Thu 12:00 AM`); the 5-hour window's
 * reset is hours out and reads as the time alone.
 */
function resetsAtText(resetsAt: unknown, rateLimitType: unknown): string {
  const epoch = readNumber(resetsAt);
  if (epoch === null || epoch <= 0) return 'soon';
  const date = new Date(epoch < 1e12 ? epoch * 1000 : epoch);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const today = date.toDateString() === new Date().toDateString();
  const weekly = typeof rateLimitType === 'string' && WEEK_WINDOWS.has(rateLimitType);
  return weekly || !today ? `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${time}` : time;
}

/**
 * What a plan cost, in the one sentence every spending push uses.
 *
 * PAID DOLLARS ONLY, LABELLED BY THE VENDOR THAT BILLED THEM: `$6.29 DeepSeek on this plan`. Claude
 * work is counted in tokens in and out and never in dollars (operator rule, 2026-09-24 — the
 * subscription is not a bill), so a plan that rode it has no `$` figure at all and this says its
 * TOKENS instead: `216M in · 4M out on this plan`. `$0.00` is the one thing it must never say.
 *
 * `null` when neither figure was recorded — a plan with nothing to report says nothing, which is
 * why the callers put this in a list they filter.
 */
function spendText(meta: Record<string, unknown>, suffix = ''): string | null {
  const cost = readNumber(meta.costUsd);
  if (cost !== null && cost > 0) return `$${cost.toFixed(2)} DeepSeek${suffix}`;
  const read = readNumber(meta.tokensIn) ?? 0;
  const written = readNumber(meta.tokensOut) ?? 0;
  if (read + written > 0) return `${humanizeTokens(read)} in · ${humanizeTokens(written)} out${suffix}`;
  const total = readNumber(meta.tokens) ?? 0;
  return total > 0 ? `${humanizeTokens(total)} tokens${suffix}` : null;
}

/** `45s`, `3m 12s`, `1h 5m` — the precision a person reads at a glance. */
function humanDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

function stringifyToolInput(toolInput: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(toolInput).slice(0, TOOL_INPUT_JSON_CHARS);
  } catch {
    return null;
  }
}

/** One question's block: `[header] question (choose any)`, then `1. label` per option. */
function renderQuestion(question: Record<string, unknown>): string | null {
  const text = readText(question.question);
  if (!text) return null;

  const header = readText(question.header);
  const lines = [`${header ? `[${header}] ` : ''}${text}${question.multiSelect === true ? ' (choose any)' : ''}`];
  const options = Array.isArray(question.options) ? question.options : [];
  // Numbered by the option's own index, so the number matches the answer a phone action sends back.
  options.forEach((option, index) => {
    const label = isRecord(option) ? readText(option.label) : null;
    if (label) lines.push(`${index + 1}. ${label}`);
  });
  return lines.join('\n');
}

function questionBody(toolInput: Record<string, unknown> | null): string {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions.filter(isRecord) : [];
  const blocks = questions.map(renderQuestion).filter((block): block is string => block !== null);
  return blocks.length ? blocks.join('\n\n') : 'Claude has a question — open the session to answer.';
}

function toolApprovalBody(toolName: string | null, toolInput: Record<string, unknown> | null): string {
  const fallback = 'A tool is waiting for your approval.';
  if (!toolInput || Object.keys(toolInput).length === 0) return fallback;

  if (toolName === 'Bash') {
    const command = readText(toolInput.command);
    if (command) return command;
  }
  if (toolName && FILE_PATH_TOOLS.has(toolName)) {
    // NotebookEdit names its target `notebook_path`; every other file tool says `file_path`.
    const filePath = readText(toolInput.file_path) ?? readText(toolInput.notebook_path);
    if (filePath) return filePath;
  }
  return stringifyToolInput(toolInput) ?? fallback;
}

function permissionCopy(meta: Record<string, unknown>): { headline: string; body: string } {
  const toolName = readText(meta.toolName);
  const toolInput = isRecord(meta.toolInput) ? meta.toolInput : null;

  if (toolName === 'AskUserQuestion') {
    return { headline: 'Claude has a question', body: questionBody(toolInput) };
  }
  if (toolName === 'ExitPlanMode') {
    const plan = readText(toolInput?.plan);
    return {
      headline: 'Plan ready for approval',
      body: plan ? plan.slice(0, PLAN_EXCERPT_CHARS) : 'Claude has a plan ready to review.',
    };
  }
  return {
    headline: toolName ? `Approve ${toolName}` : 'Approve a tool',
    body: toolApprovalBody(toolName, toolInput),
  };
}

/**
 * A plan-runner ending that wants a hand, by the runner's own outcome word. `complete` here means
 * phases were left: a clean `complete` is `runner.finished`, never this code.
 */
const RUNNER_STOP_HEADLINES: Record<string, string> = {
  complete: 'Plan incomplete',
  'all-blocked': 'Plan blocked',
  budget: 'Plan out of budget',
  'flag-off': 'Plan stopped: flag off',
  // The runner's word for "the plan file could not be read" -- a park `resume` re-enters, and the
  // one park nothing takes up on its own (`runner_watchdog._verdict` answers `done` over it), so the
  // push is the operator's only notice and it has to name the fact rather than say "stopped".
  unreadable: 'Plan unreadable',
};

/** `3 of 4 phases shipped`, or `No phases` for a plan that had none. */
function runnerShippedText(meta: Record<string, unknown>): string {
  const total = readNumber(meta.total) ?? 0;
  if (total === 0) return 'No phases';
  return `${readNumber(meta.shipped) ?? 0} of ${total} phase${total === 1 ? '' : 's'} shipped`;
}

/**
 * `3/7 phases` — the v3 dispatcher's own progress, counted over ALL of a plan's phases rather than
 * its shipped ones: its card's meter is `done` out of `phases`, so a push that counted anything else
 * would disagree with the screen it sends the operator to.
 */
function dispatcherPhaseText(meta: Record<string, unknown>): string {
  const phases = readNumber(meta.phases) ?? 0;
  return `${readNumber(meta.done) ?? 0}/${phases} phase${phases === 1 ? '' : 's'}`;
}

const COPY_BY_CODE = new Map<string, CodeCopy>([
  ['permission.required', ({ meta }) => permissionCopy(meta)],
  ['agent.notification', ({ meta }) => ({
    headline: 'Claude needs you',
    body: readText(meta.message) ?? FALLBACK_COPY.body,
  })],
  ['run.stopped', ({ meta, providerLabel: label }) => {
    const durationMs = readNumber(meta.durationMs);
    return {
      headline: meta.stopReason === 'aborted' ? 'Run aborted' : 'Run finished',
      body: `${label} finished${durationMs && durationMs > 0 ? ` in ${humanDuration(durationMs)}` : ''}`,
    };
  }],
  ['run.background_completed', ({ providerLabel: label }) => ({
    headline: 'Background agent finished',
    body: `${label}: a background task completed`,
  })],
  ['run.failed', ({ meta }) => ({
    headline: 'Session crashed',
    body: readText(meta.error) ?? 'The run encountered an error',
  })],
  ['run.limit', ({ meta }) => {
    if (meta.limit === 'budget') {
      const cost = readNumber(meta.totalCostUsd);
      return {
        headline: 'Max budget reached',
        body: cost === null ? 'The run stopped at its budget limit' : `The run stopped at $${cost.toFixed(2)}`,
      };
    }
    const turns = readNumber(meta.numTurns);
    return {
      headline: 'Max turns reached',
      body: turns === null ? 'The run stopped at its turn limit' : `The run stopped after ${turns} turns`,
    };
  }],
  ['api.error', ({ meta }) => ({
    headline: 'API error',
    body: `${readText(meta.reason) ?? 'unknown'} after ${readNumber(meta.attempts) ?? 0} retries`,
  })],
  ['session.stuck', ({ meta }) => ({
    headline: 'Session silent',
    body: `No output for ${Math.max(1, Math.round((readNumber(meta.silentForMs) ?? 0) / 60_000))} min while a run is in flight`,
  })],
  ['login.expired', ({ meta }) => {
    const detail = readText(meta.detail);
    return { headline: 'Login needed', body: `Claude needs you to sign in again${detail ? `: ${detail}` : ''}` };
  }],
  ['limit.reached', ({ meta }) => ({
    headline: `${windowLabel(meta)} limit reached`,
    body: `Resets ${resetsAtText(meta.resetsAt, meta.rateLimitType)}`,
  })],
  ['limit.reset', ({ meta }) => ({
    headline: `${windowLabel(meta)} limit reset`,
    body: 'You can resume',
  })],
  ['limit.warning', ({ meta }) => {
    const pct = readNumber(meta.pct);
    return {
      headline: `${windowLabel(meta)} limit ${pct === null ? 'nearly used' : `at ${pct}%`}`,
      body: `Resets ${resetsAtText(meta.resetsAt, meta.rateLimitType)}`,
    };
  }],
  ['limit.overage', ({ meta }) => ({
    headline: 'Overage started',
    body: 'You are now using overage',
  })],
  ['limit.out_of_credits', () => ({ headline: 'Out of credits', body: 'Overage is disabled: out of credits' })],
  ['runner.finished', ({ meta }) => {
    const durationMs = readNumber(meta.durationMs);
    return {
      headline: 'Plan finished',
      body: [
        runnerShippedText(meta),
        // "since start" is the WALK: a parked run is stamped by its Start press,
        // while a stopped-then-resumed one keeps its first start.
        durationMs && durationMs > 0 ? `${humanDuration(durationMs)} since start` : null,
        spendText(meta, ' on this plan'),
      ].filter((part): part is string => part !== null).join(' · '),
    };
  }],
  ['runner.blocked', ({ meta }) => {
    const blocked = readNumber(meta.blocked) ?? 0;
    const left = readNumber(meta.left) ?? 0;
    const phase = readText(meta.blockedPhase);
    const cause = readText(meta.blockCause);
    const doors = readText(meta.doorsSpent);
    const counts = [
      runnerShippedText(meta),
      blocked > 0 ? `${blocked} blocked` : null,
      left > 0 ? `${left} left` : null,
    ].filter((part): part is string => part !== null).join(' · ');
    const said = phase && cause ? `${counts}\nPhase ${phase}: ${cause}` : counts;
    return {
      headline: lookup(RUNNER_STOP_HEADLINES, meta.outcome) ?? 'Plan stopped',
      // WHAT THE RUN ALREADY TRIED, when it tried the ladder — the receipt's own `doors_spent`
      // (`closing.doors_spent`): the phase, the cause, and the replan/unblocks it spent on that
      // block. A bare ⛔ reads as "re-author the spec"; a phase whose ladder was spent has a heal
      // item already filed for it, and the operator is owed that difference.
      body: doors ? `${said}\n${doors}` : said,
    };
  }],
  /**
   * An ARC CARD A PRESS REFUSED (`arc-refusals.service.ts`): nothing moves that card until its plan is
   * cured — either no run exists for it, or the run that does is PARKED and no `resume` will take it —
   * and the phone is where the operator
   * finds out, since the deck's own tab is only read when they open it. `reason` is the refusing
   * gate's own sentence, captured off its stderr by the runner, never this app's paraphrase of an
   * exit code; the exit rides after it because a gate whose sentence is opaque ("not a v2 plan: …")
   * is still identified by the door it came through. The remedy is named because it is the thing to
   * do and the least obvious part of a refusal: cure the plan, and the runner starts the card by
   * itself.
   */
  ['runner.arc_stuck', ({ meta }) => {
    const position = readNumber(meta.position);
    const card = readText(meta.cardTitle);
    const reason = readText(meta.reason) ?? 'the start was refused';
    const exit = readNumber(meta.exit);
    return {
      headline: position === null ? 'Arc card cannot start' : `Card ${position} cannot start`,
      body: [
        card,
        exit === null ? reason : `${reason} (exit ${exit})`,
        'Cure the plan — the runner retries the card every two minutes, so nobody has to press anything',
      ].filter((part): part is string => part !== null).join('\n'),
    };
  }],
  /**
   * THE V3 DISPATCHER'S THREE ENDINGS (`dispatcher-endings.service.ts`), read off the same
   * `events` table the plan's own card draws. They are the run lane's `runner.finished` /
   * `runner.blocked` told by the other lane — a plan wraps up, a plan stops wanting a hand, a phase
   * the walk had left standing is taken up again — so the wording stays as close to those as the
   * facts allow: what is done out of how many, what it cost, and the one next move.
   *
   * `dispatcher.paused` is the lane's stop-and-look: the dispatcher pauses a walk for its own
   * reasons (a spent ladder, a budget, the pause verb) and the phone is where the operator finds
   * out, since the Runner tab is only read when he opens it. The remedy is named because it is the
   * least obvious part: the plan is not retried by anything, it is resumed.
   */
  ['dispatcher.finished', ({ meta }) => {
    return {
      headline: 'Plan finished',
      body: [
        dispatcherPhaseText(meta),
        spendText(meta),
      ].filter((part): part is string => part !== null).join(' · '),
    };
  }],
  ['dispatcher.paused', ({ meta }) => ({
    headline: 'Plan paused',
    body: `${dispatcherPhaseText(meta)} · Resume from the Runner tab`,
  })],
  ['dispatcher.relaunched', ({ meta }) => {
    const phase = readText(meta.phase);
    const detail = readText(meta.detail);
    return {
      headline: 'Phase relaunched',
      body: [
        phase ? `Phase ${phase} was taken up again` : 'A phase was taken up again',
        detail,
      ].filter((part): part is string => part !== null).join(' · '),
    };
  }],
  ['push.enabled', () => ({ headline: 'Push notifications enabled', body: 'Push notifications are now enabled!' })],
]);

/**
 * Renders one notification event as the title and body every channel shows.
 *
 * Consumed by the notification orchestrator's `buildNotificationPayload` (web
 * push, desktop and ntfy all send its output) and exported from the module
 * barrel for any caller that must show an event's wording. The title is the
 * code's headline followed by ` · <session name>` when one is known — except
 * an account-limit code, whose headline names the window instead; an
 * unknown code renders the generic CloudCLI copy rather than nothing.
 */
export function buildNotificationText(event: NotificationEventLike): NotificationText {
  const meta = isRecord(event.meta) ? event.meta : {};
  const copy = typeof event.code === 'string' ? COPY_BY_CODE.get(event.code) : undefined;
  const { headline, body } = copy ? copy({ meta, providerLabel: providerLabel(event.provider) }) : FALLBACK_COPY;
  const sessionName = ACCOUNT_LIMIT_CODES.has(event.code ?? '') ? null : event.sessionName ?? readText(meta.sessionName);

  return {
    title: `${headline}${sessionName ? ` · ${sessionName}` : ''}`,
    body: body.slice(0, MAX_BODY_CHARS),
  };
}
