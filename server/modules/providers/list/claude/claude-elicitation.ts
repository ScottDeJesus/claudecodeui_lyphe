import type { ElicitationResult } from '@anthropic-ai/claude-agent-sdk';

import type { AnyRecord } from '@/shared/types.js';

/**
 * An MCP server's request for input ("elicitation") travels as a permission request under this name. It is not
 * a tool the model can call: the name routes the request to the client's elicitation panel and keys it in the
 * pending-approval list, so a page refresh replays it like any other prompt.
 *
 * Consumers: claude-runtime.provider.js (`sdkOptions.onElicitation`) and, through the providers barrel, the companion
 * module's ask lanes — `tools/ask-decision.ts` (`answerFor`), `tools/chat-activity.ts` (`askLine`) and
 * `station/need-readers.ts` — which must not take the request for a tool permission. The client spells the same name in
 * `PermissionRequestsBanner.tsx`, which routes it to the panel.
 */
export const MCP_ELICITATION_TOOL_NAME = 'McpElicitation';

/** A form field's value as MCP allows it: flat primitives, or a list of strings for a multi-select. */
type ElicitationFieldValue = string | number | boolean | string[];

/**
 * Turns the client's answer to an `McpElicitation` request into the MCP result. The panel accepts with
 * `updatedInput.content` and declines with a denial. No answer at all (an abort, a closed run) is `cancel`,
 * never an invented accept.
 *
 * `decision` is what `waitForToolApproval` resolved with: `null` on a timeout, `{ cancelled: true }` when the
 * ask went away unanswered, otherwise the client's `{ allow, updatedInput }`.
 *
 * Consumer: claude-runtime.provider.js, in the `onElicitation` callback.
 */
export function toElicitationResult(decision: AnyRecord | null, mode: 'form' | 'url' | undefined): ElicitationResult {
  if (!decision || decision.cancelled) {
    return { action: 'cancel' };
  }
  if (!decision.allow) {
    return { action: 'decline' };
  }
  // A URL request is accepted without content: accepting is consent to open the page, and the server
  // learns the outcome from the page itself.
  if (mode === 'url') {
    return { action: 'accept' };
  }
  const content = (decision.updatedInput as AnyRecord | undefined)?.content;
  const fields: Record<string, ElicitationFieldValue> = {};
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    for (const [key, value] of Object.entries(content as AnyRecord)) {
      // Form fields are flat primitives, or string lists for multi-select.
      const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
      const isStringList = Array.isArray(value) && value.every((item) => typeof item === 'string');
      if (isPrimitive || isStringList) {
        fields[key] = value as ElicitationFieldValue;
      }
    }
  }
  return { action: 'accept', content: fields };
}
