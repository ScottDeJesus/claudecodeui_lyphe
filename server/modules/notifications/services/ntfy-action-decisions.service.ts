/**
 * What each ntfy tap-to-answer button means: which buttons a permission
 * request gets, and which permission decision a tapped button becomes.
 *
 * Kept apart from the token service on purpose. This file changes for product
 * reasons (a new tool, a new kind of answer); the token service changes for
 * security reasons, and the crypto must never learn what a tool or an option
 * is. This file imports the token service; the token service never imports it.
 */

import { QUESTION_WINDOW_MS } from '@/modules/notifications/services/ntfy-pushed-prompts.service.js';
import { mintActionToken, registerPendingAction } from '@/modules/notifications/services/ntfy-action-token.service.js';
import type { NtfyActionDecision, PendingAction } from '@/modules/notifications/services/ntfy-action-token.service.js';
import type { NtfyAction } from '@/modules/notifications/services/ntfy-publish.service.js';

/**
 * A question or a plan may wait for hours; an ordinary tool approval is stale within minutes.
 * The long window is the question's own, shared with the memory of its push: a button that
 * outlives that memory would answer a prompt the phone was told about as a new one.
 */
const LONG_LIVED_TTL_MS = QUESTION_WINDOW_MS;
const SHORT_LIVED_TTL_MS = 5 * 60_000;
const LONG_LIVED_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
/** ntfy shows at most three buttons; a question with more options is answered in the app. */
const MAX_OPTION_BUTTONS = 3;

type SingleChoiceQuestion = { question: string; optionLabels: string[]; needsNote: boolean[] };
/** A button that answers (`decision`), or one that opens the app because its answer takes words (`opensApp`). */
type ButtonChoice = { label: string; decision: NtfyActionDecision } | { label: string; opensApp: true };

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
  // An option that takes the operator's note (`needsNote` — a plan prompt's Rework) cannot be answered
  // by a tap: its button opens the app, where the panel takes the note.
  const needsNote = options.map((option: unknown) => (option as { needsNote?: unknown } | null)?.needsNote === true);
  return { question, optionLabels, needsNote };
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
    return question.optionLabels.map((label, index): ButtonChoice => (question.needsNote[index]
      ? { label, opensApp: true }
      : { label, decision: optionDecision(index) }));
  }
  if (toolName === 'ExitPlanMode') {
    return [{ label: 'Approve', decision: 'allow' }, { label: 'Revise', decision: 'revise' }];
  }
  return [{ label: 'Approve', decision: 'allow' }, { label: 'Deny', decision: 'deny' }];
}

/**
 * The buttons for one `permission.required` push, each answering one carrying its own signed
 * single-use token — and an option that takes the operator's note opening the session instead,
 * since a tap cannot carry words. Consumed by the ntfy channel. Registers the prompt with
 * the token service first — only when it gets at least one button — because a
 * token expires with its prompt.
 *
 * Keyed by the prompt and not by the ask that carried it: the channel builds
 * these again on every re-issue, including the ones whose push it skips, so a
 * successor re-registers the prompt a predecessor's push is still pointing at.
 */
export function buildNtfyActions(input: {
  promptKey: string;
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
    promptKey: input.promptKey,
    userId,
    sessionId: input.sessionId,
    toolName: input.toolName,
    input: input.toolInput,
    ttlMs: LONG_LIVED_TOOLS.has(input.toolName) ? LONG_LIVED_TTL_MS : SHORT_LIVED_TTL_MS,
  });

  return choices.map((choice): NtfyAction => ('opensApp' in choice
    ? {
      action: 'view',
      label: choice.label,
      url: input.sessionId ? `${input.appUrl}/session/${input.sessionId}` : `${input.appUrl}/`,
      clear: true,
    }
    : {
      action: 'http',
      label: choice.label,
      url: `${input.appUrl}/api/ntfy/act?t=${mintActionToken(input.promptKey, userId, choice.decision)}`,
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
  return buttonChoicesFor(action.toolName, action.input)
    .find((choice) => 'decision' in choice && choice.decision === decision)?.label ?? decision;
}
