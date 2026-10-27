/**
 * What an in-process MCP tool hands back to the model: one block of text, and `isError` when the call was
 * refused or failed, so the model reads the sentence and corrects itself instead of the turn dying.
 * Shaped as the SDK's `CallToolResult` takes it.
 */
export type ToolTextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * One text result. A refusal is `textResult(sentence, true)` and the sentence says what to do next, because
 * the model that reads it has no other way to learn what went wrong. Consumed by the companion's tool files
 * (`server/modules/companion/tools/`), every one of which answers in text only.
 */
export function textResult(text: string, isError = false): ToolTextResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Runs one tool's work and answers its result; when the work THREW (a database that is busy, a disk that is full)
 * the failure is logged with the tool's name and answered as `isError` text that names what could not be done and
 * what to do next, so the turn goes on and she can tell him, never a stack trace into her context. `doing` is the
 * verb phrase the sentence completes ("keep the draft" → "update_draft could not keep the draft just now (…)").
 * A refusal the tool means to make is `textResult(sentence, true)` returned from `run`, not a throw. Consumed by the
 * companion's tool files (`server/modules/companion/tools/`: `session-tools.ts` for its reads, `draft-tools.ts`
 * and `act-tools.ts` for its writes), so every tool fails the same way.
 */
export async function guardedToolResult(
  toolName: string,
  doing: string,
  run: () => Promise<ToolTextResult> | ToolTextResult
): Promise<ToolTextResult> {
  try {
    return await run();
  } catch (error) {
    console.error(`[Companion] ${toolName} could not ${doing}`, error);
    const reason = error instanceof Error ? error.message : String(error);
    return textResult(`${toolName} could not ${doing} just now (${reason}). Try once more; if it fails again, tell him.`, true);
  }
}
