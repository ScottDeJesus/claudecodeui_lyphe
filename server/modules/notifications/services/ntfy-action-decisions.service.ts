/**
 * What each ntfy tap-to-answer button means: which buttons a permission
 * request gets, and which permission decision a tapped button becomes.
 *
 * Kept apart from the token service on purpose. This file changes for product
 * reasons (a new tool, a new kind of answer); the token service changes for
 * security reasons, and the crypto must never learn what a tool or an option
 * is. This file imports the token service; the token service never imports it.
 */

import { mintActionToken, registerPendingAction } from '@/modules/notifications/services/ntfy-action-token.service.js';
import type { NtfyActionDecision, PendingAction } from '@/modules/notifications/services/ntfy-action-token.service.js';
import type { NtfyAction } from '@/modules/notifications/services/ntfy-publish.service.js';

/** A question or a plan may wait for hours; an ordinary tool approval is stale within minutes. */
const LONG_LIVED_TTL_MS = 4 * 60 * 60_000;
const SHORT_LIVED_TTL_MS = 5 * 60_000;
const LONG_LIVED_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
/** ntfy shows at most three buttons; a question with more options is answered in the app. */
const MAX_OPTION_BUTTONS = 3;

type SingleChoiceQuestion = { question: string; optionLabels: string[] };
type ButtonChoice = { label: string; decision: NtfyActionDecision };

/**
 * The one question of an AskUserQuestion input, when a row of buttons can
 * answer it: exactly one question, single-select, with string text and a
 * non-empty string label on every option. Anything else is answered in the app.
 */
function readSingleChoiceQuestion(input: unknown): SingleChoiceQuestion | null {
  const questions = (input as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return null;

  const entry: unknown = questions[0];
  if (!entry || typeof entry !== 'object') return null;
  const { question, options, multiSelect } = entry as Record<string, unknown>;
  if (typeof question !== 'string' || multiSelect || !Array.isArray(options)) return null;

  const optionLabels = options.map((option: unknown) => (option as { label?: unknown } | null)?.label);
  if (!optionLabels.every((label): label is string => typeof label === 'string' && label.length > 0)) return null;
  return { question, optionLabels };
}

function optionDecision(index: number): NtfyActionDecision {
  return `opt:${index}`;
}

/**
 * The buttons a request gets, in the order ntfy shows them — the one source
 * of every button label, read again by `describeDecision` for the tap's answer.
 * Empty when the request can only be answered in the app.
 */
function buttonChoicesFor(toolName: string, toolInput: unknown): ButtonChoice[] {
  if (toolName === 'AskUserQuestion') {
    const question = readSingleChoiceQuestion(toolInput);
    if (!question || question.optionLabels.length > MAX_OPTION_BUTTONS) return [];
    return question.optionLabels.map((label, index) => ({ label, decision: optionDecision(index) }));
  }
  if (toolName === 'ExitPlanMode') {
    return [{ label: 'Approve', decision: 'allow' }, { label: 'Revise', decision: 'revise' }];
  }
  return [{ label: 'Approve', decision: 'allow' }, { label: 'Deny', decision: 'deny' }];
}

/**
 * The buttons for one `permission.required` push, each carrying its own signed
 * single-use token. Consumed by the ntfy channel. Registers the request with
 * the token service first — only when it gets at least one button — because a
 * token expires with its request.
 */
export function buildNtfyActions(input: {
  requestId: string;
  userId: string | number;
  sessionId: string | null;
  toolName: string;
  toolInput: unknown;
  appUrl: string;
}): NtfyAction[] {
  const choices = buttonChoicesFor(input.toolName, input.toolInput);
  if (choices.length === 0) return [];

  const userId = String(input.userId);
  registerPendingAction({
    requestId: input.requestId,
    userId,
    sessionId: input.sessionId,
    toolName: input.toolName,
    input: input.toolInput,
    ttlMs: LONG_LIVED_TOOLS.has(input.toolName) ? LONG_LIVED_TTL_MS : SHORT_LIVED_TTL_MS,
  });

  return choices.map((choice): NtfyAction => ({
    action: 'http',
    label: choice.label,
    url: `${input.appUrl}/api/ntfy/act?t=${mintActionToken(input.requestId, userId, choice.decision)}`,
    method: 'POST',
    clear: true,
  }));
}

/**
 * The permission decision a tapped button hands the runtime — the same shapes
 * the in-app panels send — or null when an option index no longer names an
 * option. Consumed by the act route.
 */
export function toPermissionDecision(
  action: PendingAction,
  decision: NtfyActionDecision,
): { allow: boolean; updatedInput?: Record<string, unknown>; message?: string } | null {
  if (decision === 'allow') return { allow: true };
  if (decision === 'deny') return { allow: false, message: 'User denied tool use' };
  if (decision === 'revise') return { allow: false, message: 'User asked to revise the plan' };

  const question = readSingleChoiceQuestion(action.input);
  const label = question?.optionLabels[Number(decision.slice('opt:'.length))];
  if (!question || label === undefined) return null;
  // The answers shape of the in-app question panel: question text → the chosen label.
  return {
    allow: true,
    updatedInput: { ...(action.input as Record<string, unknown>), answers: { [question.question]: label } },
  };
}

// Consumed by the act route: the label of the tapped button, for its `Answered: <label>` reply.
export function describeDecision(action: PendingAction, decision: NtfyActionDecision): string {
  return buttonChoicesFor(action.toolName, action.input).find((choice) => choice.decision === decision)?.label
    ?? decision;
}
