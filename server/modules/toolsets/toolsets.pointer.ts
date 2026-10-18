import type { ToolsetDefinition } from '@/shared/toolset-types.js';

/**
 * The sentence a chat's system prompt carries about the sets the box defines, or null when it
 * defines none — so with the registry empty no prompt changes, and registering a set later is a pure
 * edit of the file.
 *
 * It names every defined set (name and description) and the three verbs of the `toolset` command.
 * The words after the list are load-bearing: a switched-on set's tools arrive as DEFERRED tools in
 * the same turn, which the model has to load through ToolSearch before it can call them. A set with
 * no description is its name alone.
 *
 * Built here, and appended to the launch's system prompt by the Claude runtime
 * (`ChatToolsetLaunch.promptLine`); `surface-signal.ts` is not touched. Consumed by `toolsets.service.ts`.
 */
export function toolsetPointer(sets: ToolsetDefinition[]): string | null {
  if (sets.length === 0) return null;

  const listed = sets
    .map((set) => (set.description === null ? set.name : `${set.name} (${set.description})`))
    .join('; ');

  return (
    `Tool sets: this box defines MCP tool sets that stay off until a conversation switches them on — ${listed}. ` +
    'Run `toolset on <name>` in Bash to switch one on for this conversation only: its tools arrive within the ' +
    "same turn as deferred tools, so load them with ToolSearch, and they stay on for this conversation's later " +
    'messages. `toolset off <name>` switches it off, and `toolset list` shows which are on.'
  );
}
