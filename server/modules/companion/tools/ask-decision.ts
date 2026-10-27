import { buildClaudeToolPermissionEntry } from '@/modules/providers/index.js';
import { isRecord } from '@/shared/document-fields.js';
import { describeToolInput, oneLine } from '@/shared/tool-call-hint.js';
import type { ProviderPermissionDecision } from '@/shared/types.js';

/**
 * What an answer of hers means to the ask it answers: the decision the runtime's own resolver is handed, for the
 * three kinds of ask a chat can be waiting on. Nothing here touches the server — the functions read an ask and a
 * sentence and say what to hand the resolver, or why they cannot — so `answer_session` (`act-tools.ts`) is left
 * only the doing.
 *
 * The decisions are the page's own, byte for byte, so an answer from her and one from his hand settle an ask alike:
 *   - a PERMISSION (any tool): `allow` is `{ allow: true }`, `deny` is `{ allow: false, message: 'User denied tool
 *     use' }` and `always` is `{ allow: true, rememberEntry }` with the entry the grammar accepts for the ask
 *     (`PermissionRequestsBanner.tsx`);
 *   - an `AskUserQuestion` of ONE question: `{ allow: true, updatedInput: { ...input, answers: { [question]: answer } } }`,
 *     the answer an option's label when her words match one (case-insensitively) and her words as a free answer
 *     when they match none (`AskUserQuestionPanel.tsx`, `handleSubmit`). `allow`, `deny` and `always` are the words of a
 *     permission, not answers to a question, so unless an option is called that they are refused rather than sent to
 *     the chat as his answer (an answer cannot be taken back). A question with several parts cannot be answered by
 *     one sentence and is not guessed at;
 *   - `ExitPlanMode`: `allow` approves with `{ allow: true }` and `deny` sends the plan back with `{ allow: false,
 *     message: 'User asked to revise the plan' }` (`PlanDisplay.tsx`, `handleBuild` and `handleRevise`).
 *
 * Consumer: `tools/act-tools.ts`, the `answer_session` handler.
 */

/** One ask a chat is waiting on, as `getPendingApprovalsForSession` lists it: the request to answer, the tool it is for and the input it was raised with. Consumed by `act-tools.ts`. */
export type PendingAsk = { requestId: string; toolName: string; input: unknown };

/** The oldest ask of a chat's list and how many others wait behind it. Consumed by `act-tools.ts`. */
export type OldestAsk = { ask: PendingAsk; more: number };

/** When an entry of the pending list was raised, in epoch ms; `Infinity` for one that says not, so it sorts after those that do. */
function raisedAt(entry: Record<string, unknown>): number {
  const { receivedAt } = entry;
  const time = receivedAt instanceof Date ? receivedAt.getTime() : typeof receivedAt === 'string' ? Date.parse(receivedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * The oldest ask of `pending` (the list `getPendingApprovalsForSession` answers) — the one she answers — and how
 * many more wait, or `null` when none does. An entry with no request id cannot be answered and is not counted.
 * Ties keep the list's own order, which is the order the runtime raised them in.
 * Consumed by `act-tools.ts`.
 */
export function oldestPendingAsk(pending: unknown[]): OldestAsk | null {
  const asks = pending.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.requestId !== 'string' || entry.requestId === '') return [];
    const toolName = typeof entry.toolName === 'string' && entry.toolName !== '' ? entry.toolName : 'UnknownTool';
    return [{ ask: { requestId: entry.requestId, toolName, input: entry.input } satisfies PendingAsk, raisedAt: raisedAt(entry) }];
  });
  if (asks.length === 0) return null;
  // Stable: `sort` keeps the list's order between equal times.
  const [oldest] = [...asks].sort((a, b) => a.raisedAt - b.raisedAt);
  return { ask: oldest.ask, more: asks.length - 1 };
}

/**
 * What an answer comes to: the decision to hand the resolver, the entry to remember beside it (`null` unless the
 * answer was `always`), and the sentence to give her; or the sentence that refuses it and says what to answer instead.
 * Consumed by `act-tools.ts`.
 */
export type AskAnswer =
  | { ok: true; decision: ProviderPermissionDecision; remember: string | null; told: string }
  | { ok: false; sentence: string };

const refused = (sentence: string): AskAnswer => ({ ok: false, sentence });

/** The three words of a permission ask. Said to a question they are not an answer, and are refused unless an option is called that. */
const PERMISSION_WORDS: ReadonlySet<string> = new Set(['allow', 'deny', 'always']);

type Question = { question: string; options: string[] };

/** The questions an `AskUserQuestion` input carries, each with its option labels. A malformed entry is left out. */
function questionsOf(input: unknown): Question[] {
  if (!isRecord(input) || !Array.isArray(input.questions)) return [];
  return input.questions.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.question !== 'string') return [];
    const options = Array.isArray(entry.options)
      ? entry.options.flatMap((option: unknown) => (isRecord(option) && typeof option.label === 'string' ? [option.label] : []))
      : [];
    return [{ question: entry.question, options }];
  });
}

/** An `AskUserQuestion` of one question: the option whose label is her words, else her words. */
function answerQuestion(ask: PendingAsk, words: string, chatName: string): AskAnswer {
  const questions = questionsOf(ask.input);
  if (questions.length !== 1 || !isRecord(ask.input)) {
    const parts = questions.length === 0 ? 'no question she can read' : `${questions.length} questions`;
    return refused(`${chatName}'s ask has ${parts}, and one answer cannot cover it. Tell him to answer it in the chat; do not guess.`);
  }
  const [{ question, options }] = questions;
  const matched = options.find((label) => label.trim().toLowerCase() === words.toLowerCase());
  if (matched === undefined && PERMISSION_WORDS.has(words.toLowerCase())) {
    const offered = options.length > 0 ? ` Its options are: ${options.map(oneLine).join(' | ')}.` : '';
    return refused(`${chatName} is asking a question ("${oneLine(question)}"), not for permission, so "${words}" is not an answer to it.${offered} Answer with one option's label or with his own words.`);
  }
  const given = matched ?? words;
  return {
    ok: true,
    // The page's own shape: the input as it came, with the answer keyed by the question's text.
    decision: { allow: true, updatedInput: { ...ask.input, answers: { [question]: given } } },
    remember: null,
    told: `Answered ${chatName}'s question "${oneLine(question)}" with "${oneLine(given)}"${matched === undefined ? ', which is not one of its options' : ''}.`,
  };
}

/** An `ExitPlanMode` ask: `allow` approves the plan, `deny` sends it back for revision. */
function answerPlan(words: string, chatName: string): AskAnswer {
  const verdict = words.toLowerCase();
  if (verdict === 'allow') return { ok: true, decision: { allow: true }, remember: null, told: `Approved the plan in ${chatName}; it goes ahead.` };
  if (verdict === 'deny') {
    return { ok: true, decision: { allow: false, message: 'User asked to revise the plan' }, remember: null, told: `Sent the plan back to ${chatName} for revision.` };
  }
  return refused(`${chatName}'s plan waits on approval. Answer allow to approve it, or deny to send it back for revision.`);
}

/** A tool permission: `allow`, `deny`, or `always` with the entry that remembers it. */
function answerPermission(ask: PendingAsk, words: string, chatName: string): AskAnswer {
  // What the ask would run, in full: this is the line she decides on, and a command's tail is where `rsync --delete` sits.
  const what = describeToolInput(ask.toolName, ask.input);
  const verdict = words.toLowerCase();
  if (verdict === 'allow') return { ok: true, decision: { allow: true }, remember: null, told: `Allowed ${what} in ${chatName}.` };
  if (verdict === 'deny') {
    return { ok: true, decision: { allow: false, message: 'User denied tool use' }, remember: null, told: `Denied ${what} in ${chatName}.` };
  }
  if (verdict === 'always') {
    const entry = buildClaudeToolPermissionEntry(ask.toolName, ask.input);
    if (entry === null) return refused(`${chatName}'s permission names no tool, so there is nothing to remember. Answer allow or deny.`);
    return {
      ok: true,
      decision: { allow: true, rememberEntry: entry },
      remember: entry,
      told: `Allowed ${what} in ${chatName} and remembered ${entry} as a standing rule for his account; a page that was already open keeps its old list until it reloads.`,
    };
  }
  const entry = buildClaudeToolPermissionEntry(ask.toolName, ask.input);
  const standing = entry === null ? '' : ` — it stores ${entry} for every later chat of his, so only when he asked to remember it`;
  return refused(`${chatName} is asking permission for ${what}. Answer allow, deny, or always (allow and keep the rule${standing}).`);
}

/**
 * What `words` means to `ask`, for the chat called `chatName`. `AskUserQuestion` and `ExitPlanMode` (the page names
 * the second `exit_plan_mode` as well) are the two asks with a shape of their own; every other tool is a permission.
 * Consumed by `act-tools.ts`.
 */
export function answerFor(ask: PendingAsk, words: string, chatName: string): AskAnswer {
  if (ask.toolName === 'AskUserQuestion') return answerQuestion(ask, words, chatName);
  if (ask.toolName === 'ExitPlanMode' || ask.toolName === 'exit_plan_mode') return answerPlan(words, chatName);
  return answerPermission(ask, words, chatName);
}
