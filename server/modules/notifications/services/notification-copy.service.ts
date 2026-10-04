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
const ACCOUNT_LIMIT_CODES = new Set([
  'limit.reached',
  'limit.reset',
  'limit.warning',
  'limit.overage',
  'limit.out_of_credits',
  // The dispatcher's one push for every plan a usage limit paused: it speaks for the account, not for the first plan.
  'dispatcher.limit_paused',
]);

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
 * A usage-limit pause's lift time, for a sentence: the time alone when it is today, else the DATE
 * beside it (`Oct 3, 8:12 PM`). Never a weekday alone — a lift a full week out would read as
 * today's weekday.
 */
function limitLiftText(resetsAt: unknown): string {
  const epoch = readNumber(resetsAt);
  if (epoch === null || epoch <= 0) return 'soon';
  const date = new Date(epoch < 1e12 ? epoch * 1000 : epoch);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
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
    // A plan's prompt, raised by the app itself on the plan's card (`dispatcher-asks.service.ts`):
    // the headline names the plan, since no model is the one asking.
    const plan = readText(meta.plan);
    if (plan) {
      const headline = meta.askKind === 'accept' ? `Accept ${plan}?` : `${plan} has questions`;
      return { headline, body: questionBody(toolInput) };
    }
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
 * `3/7 tasks` — the dispatcher's own progress, counted over ALL of a plan's phases rather than
 * its shipped ones: its card's meter is `done` out of `phases`, so a push that counted anything else
 * would disagree with the screen it sends the operator to.
 */
function dispatcherPhaseText(meta: Record<string, unknown>): string {
  const phases = readNumber(meta.phases) ?? 0;
  return `${readNumber(meta.done) ?? 0}/${phases} task${phases === 1 ? '' : 's'}`;
}

/**
 * What a push from a feature of an epic adds to its body: the epic's name, and that the next ones stay
 * on the card until the epic has been quiet for an hour (`WAVE_S` in `dispatcher-endings.service.ts`,
 * the window the lane keeps a wave open for). `null` for a feature in no epic, whose every push is its own.
 */
function epicWaveText(meta: Record<string, unknown>, noun: 'retries' | 'stops'): string | null {
  const epic = readText(meta.epic);
  return epic === null ? null : `Epic ${epic}: further ${noun} stay on its card until it has been quiet for an hour`;
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
  /**
   * THE DISPATCHER'S ENDINGS (`dispatcher-endings.service.ts`), read off the same `events` table
   * the plan's own card draws: a feature wraps up, a feature stops wanting a hand, a task the walk
   * had left standing is taken up again, and an epic is finished. What is done out of how many, what
   * it cost, and the one next move.
   *
   * A feature in no epic says each of these as it happens. A feature of an epic says only the first
   * of a wave of retries or of stops, and its copy names the epic and says the rest stay on the
   * card (`epicWaveText`); its own finish is never said, because the epic's is.
   *
   * `dispatcher.paused` is the lane's stop-and-look: the dispatcher pauses a walk for its own
   * reasons (a spent ladder, a budget, the pause verb) and the phone is where the operator finds
   * out, since the Roadmap tab's In flight face is only read when he opens it. The remedy is named because it is the
   * least obvious part: the plan is not retried by anything, it is resumed. A pause the dispatcher
   * itself held carries its cause in `meta.detail` (an API error line, the storm guard's), and the
   * body says it.
   */
  ['dispatcher.finished', ({ meta }) => {
    return {
      headline: 'Feature finished',
      body: [
        dispatcherPhaseText(meta),
        spendText(meta),
      ].filter((part): part is string => part !== null).join(' · '),
    };
  }],
  // The title reads `Epic finished · <epic name>`: the ending's `sessionName` is the epic. Its spend is
  // the epic's own sum over all of its features, in the same words a feature's push uses.
  ['dispatcher.epic_finished', ({ meta }) => {
    const features = readNumber(meta.features) ?? 0;
    const tasks = readNumber(meta.tasks);
    return {
      headline: 'Epic finished',
      body: [
        `${features} feature${features === 1 ? '' : 's'}`,
        tasks === null ? null : `${tasks} task${tasks === 1 ? '' : 's'}`,
        spendText(meta),
      ].filter((part): part is string => part !== null).join(' · '),
    };
  }],
  ['dispatcher.paused', ({ meta }) => ({
    headline: 'Feature paused',
    body: [dispatcherPhaseText(meta), readText(meta.detail), 'Resume from the Roadmap tab', epicWaveText(meta, 'stops')]
      .filter((part): part is string => part !== null)
      .join(' · '),
  })],
  // ONE push for a usage limit however many plans it paused (`dispatcher-endings.service.ts`): the
  // limit is the account's, the time is when the dispatcher's own armed Resume fires, and an early
  // Resume after an account switch is the operator's.
  ['dispatcher.limit_paused', ({ meta }) => ({
    headline: 'Claude usage limit',
    // A limit that named no reset time carries the dispatcher's own GUESS: it says so, and does not
    // promise the hour as though the API had given it.
    body: `${meta.limitGuess === true
      ? `Features paused — no reset time named, retrying at ${limitLiftText(meta.resetsAt)}`
      : `Features paused until ${limitLiftText(meta.resetsAt)}`} · Resume from the Roadmap tab`,
  })],
  ['dispatcher.relaunched', ({ meta }) => {
    const phase = readText(meta.phase);
    const detail = readText(meta.detail);
    return {
      headline: 'Task relaunched',
      body: [
        phase ? `Task ${phase} was taken up again` : 'A task was taken up again',
        detail,
        epicWaveText(meta, 'retries'),
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
