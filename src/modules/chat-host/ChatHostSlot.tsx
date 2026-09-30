import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ChatHostPlaceholder } from '@/modules/chat-host/ChatHostPlaceholder';
import { useChatHost, useChatHostMechanics } from '@/modules/chat-host/context/ChatHostContext';
import { HostWindowProvider } from '@/shared/context/HostWindowContext';
import { cn } from '@/shared/utils';

/**
 * Used by project-workspace's WorkspaceMain, in the chat tab's place: the chat's home, and the portal it leaves through.
 *
 * THE CHAT NEVER RENDERS IN PLACE. Its children go through a portal into the provider's one node,
 * here at home exactly as when the chat floats, so ChatInterface keeps one parent fiber for its whole
 * life and a move between hosts never remounts it. The `div` this renders is only the place the node
 * stands while the chat is home: it holds nothing else, and it is adopted in a layout effect so the
 * node is in the document before the browser paints.
 *
 * WHILE THE CHAT FLOATS the tab shows the placeholder beside that home, and the home steps out of the
 * tab's box (`hidden`): an empty `h-full` home would leave the placeholder below the box, clipped, and the
 * reader with an empty tab and nothing to press. Bring it back is `collapse`, the same way home as the
 * floating header's button.
 *
 * `sessionId` and `showing` are the chat's facts, published to the provider for the readers that need
 * them outside the chat tab and cleared when the slot unmounts.
 */
export function ChatHostSlot({
  sessionId,
  showing,
  children,
}: {
  sessionId: string | null;
  showing: boolean;
  children: ReactNode;
}) {
  const { placement, collapse } = useChatHost();
  const { node, moveTo, hostWindowValue, setHomeElement, publishFacts } = useChatHostMechanics();
  const homeRef = useRef<HTMLDivElement | null>(null);

  const registerHome = useCallback((element: HTMLDivElement | null) => {
    homeRef.current = element;
    setHomeElement(element);
  }, [setHomeElement]);

  // The node comes home while the placement says home. A move to the very host it already stands in
  // is a no-op, so this is safe to re-run.
  useLayoutEffect(() => {
    const home = homeRef.current;
    if (placement === 'home' && home) moveTo(home, false);
  }, [placement, moveTo]);

  useLayoutEffect(() => {
    publishFacts({ sessionId, showing });
    return () => publishFacts(null);
  }, [sessionId, showing, publishFacts]);

  return (
    <>
      <div
        ref={registerHome}
        data-chat-host-home
        className={cn('flex h-full min-h-0 flex-col', placement !== 'home' && 'hidden')}
      />
      {placement !== 'home' && <ChatHostPlaceholder placement={placement} onBringBack={collapse} />}
      {createPortal(<HostWindowProvider value={hostWindowValue}>{children}</HostWindowProvider>, node)}
    </>
  );
}
