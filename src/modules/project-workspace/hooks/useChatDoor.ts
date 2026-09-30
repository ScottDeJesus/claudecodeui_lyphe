import { useCallback, useMemo } from 'react';

import { useChatHost } from '@/modules/chat-host';
import type { ChatDoor } from '@/shared/types';

/**
 * Used by project-workspace's WorkspaceFrame to build the chat's one door, which its hotkey (and, as the
 * door grows its readers, the switcher's FAB, radial and palette) press: `floating` says which way a press
 * goes, `toggle` is that press, and `collapse` is the way home that does not ask.
 *
 * `toggle` is `floating ? collapse() : open()`, and `open` runs FIRST and SYNCHRONOUSLY inside the caller's
 * press — a picture-in-picture window can only be requested from a user gesture, so nothing may be awaited
 * or deferred ahead of it. This hook lives here, not in chat-host or the switcher, because it is the one
 * place that joins the two: chat-host knows where the chat is and the switcher knows what is on screen, and
 * neither imports the other.
 *
 * The door's identities are stable for as long as `floating` holds, so a listener that keeps the function
 * it was handed is never a render behind.
 */
export function useChatDoor(): ChatDoor {
  const { placement, open, collapse } = useChatHost();
  const floating = placement !== 'home';

  const toggle = useCallback(() => {
    if (floating) collapse();
    else open();
  }, [floating, open, collapse]);

  return useMemo(() => ({ floating, toggle, collapse }), [floating, toggle, collapse]);
}
