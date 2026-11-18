import { isRecord, isText } from '@/shared/document-fields.js';

import type { CompanionStore } from '../companion-store.js';

/**
 * The record of a turn's work: every call of a tool the companion makes is written to the store as it begins and again as it ends
 * (`companion_work`), so the log can show a turn's work the way a chat shows a session's. The one place a call is recorded is the
 * wrapper every tool's handler already goes through (`buildCompanionTools`), so no tool file knows of it.
 *
 * THE COMPANION'S OWN MEMORY IS NEVER STORED HERE. A call of `recall`, `remember` or `forget` is recorded as made (the tool, when,
 * whether it failed) with neither what it was given nor what it answered: CloudCLI keeps none of that memory, and a copy in this
 * table would be one.
 *
 * RECORDING NEVER COSTS A CALL. A write that fails (a busy database) is logged and the tool runs and answers as if nothing was
 * being recorded; a tool that throws is ended as failed and the throw goes on to its caller unchanged.
 *
 * Consumer: `tool-deps.ts`, which binds it to an account's store and its turn as `CompanionToolDeps.recordWork`.
 */

/** The tools of the companion's own memory: recorded as made, with nothing of what they were given or answered. */
const MEMORY_TOOLS: ReadonlySet<string> = new Set(['recall', 'remember', 'forget']);

/** The most of an answer the store keeps, in characters: enough to read what a tool said, and a bound on a transcript read whole. */
const RESULT_KEEP = 12_000;

/** The longest `about` line, in characters. */
const ABOUT_KEEP = 120;

/**
 * The arguments that say what a call concerned, in the order they are tried: the thing named first (a chat, a card, a page, a run),
 * then the words that narrow a read (a scope, a phrase), then the text a write carried.
 */
const ABOUT_KEYS = ['session', 'sessionId', 'card', 'page', 'run', 'board', 'project', 'target', 'name', 'title', 'followup', 'phrase', 'action', 'scope', 'brief', 'text', 'answer'];

/** What a call concerned, in a few words taken from what the tool was given: the first of `ABOUT_KEYS` that holds text, on one line and cut. `null` for none. */
export function aboutOf(input: Record<string, unknown>): string | null {
  for (const key of ABOUT_KEYS) {
    const value = input[key];
    if (!isText(value)) continue;
    const line = value.replace(/\s+/g, ' ').trim();
    if (line.length > 0) return line.length > ABOUT_KEEP ? `${line.slice(0, ABOUT_KEEP - 1)}…` : line;
  }
  return null;
}

/** The text of a tool's answer: its text blocks joined, and whether the tool said it failed. Anything that is not the SDK's result shape reads as no text. */
function answerOf(result: unknown): { text: string; failed: boolean } {
  if (!isRecord(result)) return { text: '', failed: false };
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks.flatMap((block) => (isRecord(block) && block.type === 'text' && isText(block.text) ? [block.text] : [])).join('\n');
  return { text, failed: result.isError === true };
}

/**
 * Runs one call of `tool` with the record round it: the row opens before `run` and ends with its answer. `turnId` is the turn the
 * call is made in. Answers exactly what `run` answers, and throws exactly what it throws.
 */
export async function recordWork<T>(store: CompanionStore, turnId: string | null, tool: string, args: unknown, run: () => Promise<T>): Promise<T> {
  const input = isRecord(args) ? args : {};
  const kept = !MEMORY_TOOLS.has(tool);
  let id: number | null = null;
  try {
    id = store.beginWork({ turnId, tool, about: kept ? aboutOf(input) : null, kept, input: kept ? input : {} }).id;
  } catch (error) {
    console.error(`[Companion] the call of ${tool} could not be recorded; it runs unrecorded`, error);
  }
  const end = (failed: boolean, text: string): void => {
    if (id === null) return;
    try {
      store.endWork(id, { failed, result: text.slice(0, RESULT_KEEP), cut: text.length > RESULT_KEEP });
    } catch (error) {
      console.error(`[Companion] the end of the call of ${tool} could not be recorded`, error);
    }
  };
  try {
    const result = await run();
    const answer = answerOf(result);
    end(answer.failed, answer.text);
    return result;
  } catch (error) {
    end(true, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
