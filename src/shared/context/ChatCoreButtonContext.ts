import { useContext } from 'react';

import { createStableContext } from '@/shared/context/stableContext';

/**
 * WHERE THE CHAT'S CORE IS DRAWN A SECOND TIME: the floating chat's button (chat-host's `ChatHostFab`), which wears the core itself and
 * not a picture of it. The host gives the element (`ChatCoreButtonProvider`, round the live chat's portal in `ChatHostSlot`) and the
 * chat's own core draws into it (the chat module's `ChatCoreButton`), from the same reading as the core beside the line. Null while no
 * button stands: the chat is home, or in a window of its own.
 */
const ChatCoreButtonContext = createStableContext<HTMLElement | null>(import.meta.hot, 'ChatCoreButtonContext', null);

/** Used by chat-host's `ChatHostSlot`, round the live chat's portal. */
export const ChatCoreButtonProvider = ChatCoreButtonContext.Provider;

/** The button's element to draw the core into, or null where no button stands. Read by the chat module's `ChatCoreButton`. */
export function useChatCoreButton(): HTMLElement | null {
  return useContext(ChatCoreButtonContext);
}
