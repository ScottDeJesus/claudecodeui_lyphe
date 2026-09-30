import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ChatHostHeader } from '@/modules/chat-host/ChatHostHeader';
import { useChatHost, useChatHostMechanics } from '@/modules/chat-host/context/ChatHostContext';
import { usePictureInPicture } from '@/modules/chat-host/hooks/usePictureInPicture';
import { HostWindowProvider } from '@/shared/context/HostWindowContext';
import type { HostWindowValue } from '@/shared/types';

/**
 * Used by this module's ChatHostFloating while the placement is 'window': the picture-in-picture window's own
 * top, the same `ChatHostHeader` the panel wears, drawn into the window's document.
 *
 * The chat itself is not rendered here. `usePictureInPicture` builds the window's column and carries the chat's
 * node into its chat container, exactly as the panel's body adopts it; what React draws in this component is
 * only the header, through a portal into the header container.
 *
 * THE HEADER IS ITS OWN HOST WINDOW SUBTREE. Its provider names the picture-in-picture window from its first
 * render, where the chat's own provider (`ChatHostSlot`'s) follows the node and names the opener until the node
 * has moved in. The picker's menu and the collapse tooltip therefore portal into the window's body and open where
 * the reader is looking, never in the opener behind it.
 */
export function ChatHostWindow({ pip, header }: { pip: Window; header: ReactNode }) {
  const { collapse } = useChatHost();
  const { subscribeMove } = useChatHostMechanics();
  const headerContainer = usePictureInPicture(pip);

  const hostWindowValue = useMemo<HostWindowValue>(() => ({ hostWindow: pip, subscribeMove }), [pip, subscribeMove]);

  return createPortal(
    <HostWindowProvider value={hostWindowValue}>
      <ChatHostHeader header={header} onCollapse={collapse} />
    </HostWindowProvider>,
    headerContainer,
  );
}
