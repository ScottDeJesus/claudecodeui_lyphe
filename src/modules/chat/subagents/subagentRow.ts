import type { PinnedSubagentRow } from '@/modules/chat/hooks/usePinnedSubagentRows';

/**
 * How a pinned row is addressed when it is opened, read the same way by both surfaces that open
 * one: the gutter's Subagents widget (`SubagentWidgetBody.tsx`) and the strip above the chat box
 * (`transcript/PinnedSubagents.tsx`).
 */

/** The id a row is addressed by: an agent's spawning tool call, or a soul's launch id. */
export function rowId(row: PinnedSubagentRow): string {
  return row.kind === 'agent' ? row.id : row.launch.launch_id;
}

/** Whether a row is still working — the same reading its own drawing takes. */
export function rowRunning(row: PinnedSubagentRow): boolean {
  return row.kind === 'agent' ? row.summary.status === 'running' : row.launch.state === 'running';
}

/** The soul slug as a name: `hephaestus` → `Hephaestus`. The shims are lowercase; a pin is not. */
export function soulName(agent: string): string {
  if (!agent) return 'Soul';
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** What a row is called where a name is needed in words: the transcript's header, and the label
 * its row announces as the thing a press will open. */
export function rowLabel(row: PinnedSubagentRow): string {
  return row.kind === 'agent' ? row.summary.label || row.summary.description || '' : soulName(row.launch.agent);
}
