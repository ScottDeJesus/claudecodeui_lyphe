import { useContext } from 'react';

import { createStableContext } from '@/shared/context/stableContext';

const NO_SUBAGENT_MODELS: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The models of the agents each conversation has running, by session id. In a file of its own, apart from the provider that fills
 * it (`SessionProtectionProvider`), so that the provider's file gains no further export beside its component.
 */
export const SubagentModelsContext = createStableContext<ReadonlyMap<string, readonly string[]>>(import.meta.hot, 'SubagentModelsContext', NO_SUBAGENT_MODELS);

/**
 * For each conversation with a subagent still running, the model of every agent it has out, from the running-sessions poll's
 * 5-second refresh: one entry for each agent, `''` for one whose model is not recorded yet. A conversation
 * `useSubagentRunningSessionIdSet` names may be missing here (a server older than the field): its agents are then of no known
 * model, never absent.
 *
 * Read by the sidebar module's sessions board and halo, which draw one dot for each agent in its model's colour.
 */
export function useSubagentModelsBySession(): ReadonlyMap<string, readonly string[]> {
  return useContext(SubagentModelsContext);
}
