import { useContext } from 'react';

import { createStableContext } from '@/shared/context/stableContext';

const ChatCorePlaceContext = createStableContext<HTMLElement | null>(import.meta.hot, 'ChatCorePlaceContext', null);

/**
 * WHERE THE CHAT'S CORE STANDS WHEN IT IS NOT BESIDE THE LINE. At a desk the page that mounts the chat (project-workspace's `ChatDesk`)
 * keeps a column beside the talk for the core, as the station keeps one for the companion, and hands the box in that column here. The
 * chat's core (`ChatCore`) draws itself into that box; everything it does stays the composer's, so nothing of its state moves with it.
 *
 * Null where the page has no such column (a narrow screen, the floating chat, a chat mounted alone): the core then stands in the line's
 * own row, as before.
 */
export const ChatCorePlaceProvider = ChatCorePlaceContext.Provider;

/**
 * The box the page keeps for the chat's core, or null where the core stands beside its line. Read by the chat module's `ChatCore` (which
 * draws into it) and `ChatInterface` (which then gives the talk and the line the strip the core no longer needs).
 */
export function useChatCorePlace(): HTMLElement | null {
  return useContext(ChatCorePlaceContext);
}
