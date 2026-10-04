import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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
 * WHILE THE CHAT IS AWAY the tab shows the placeholder beside that home, and the home steps out of the
 * tab's box: an empty `h-full` home would leave the placeholder below the box, clipped, and the reader with
 * an empty tab and nothing to press. It gives up its height (`h-0 overflow-hidden`) and is NOT `hidden`:
 * collapse carries the node home while the placement still says the chat floats, and a text field cannot
 * hold focus inside a `display: none` box — the composer would lose its caret on the way home, where a box
 * that is still rendered at no height keeps it. Bring it back is `collapse`, the same way home as the
 * floating header's button.
 *
 * AWAY MEANS THE NODE HAS LEFT, NOT THAT THE PLACEMENT CHANGED. The panel carries the node in the same commit
 * that sets its placement, but a picture-in-picture window is placed the moment the browser hands it over and
 * receives the chat only once its stylesheets have loaded — a wait that a slow stylesheet host stretches to
 * seconds. Squeezing the home at the placement would leave the chat in a zero-height box for the whole wait:
 * its scroller, read by the 'before' of the move, would report the squeezed geometry, and the scroll events
 * the squeeze causes would mark the reader as scrolled up, so the transcript would not follow the foot into
 * the window. So the home and the placeholder follow the 'after' of each move (`floating`), and the tab keeps
 * showing the chat until the window has it.
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
  const { node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts } = useChatHostMechanics();
  const homeRef = useRef<HTMLDivElement | null>(null);

  // Whether the chat's node has left this slot's home for a floating host. State because the home's height
  // and the placeholder are drawn from it; written by the 'after' of every move (`floating`), which is the
  // one moment the node's parent changes. `placement` cannot say it: for a window the two differ by the wait.
  const [chatAway, setChatAway] = useState(false);
  useLayoutEffect(() => subscribeMove(({ phase, floating }) => {
    if (phase === 'after') setChatAway(floating);
  }), [subscribeMove]);

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

  // The facts are published on every change and cleared ONLY when the slot unmounts — two effects, because
  // one effect's cleanup also runs between two publishes (a new `sessionId`), and clearing there would tell
  // the provider the chat is gone and take a floating chat home every time the reader changes conversation.
  useLayoutEffect(() => {
    publishFacts({ sessionId, showing });
  }, [sessionId, showing, publishFacts]);
  useLayoutEffect(() => () => publishFacts(null), [publishFacts]);

  return (
    <>
      <div
        ref={registerHome}
        data-chat-host-home
        className={cn('flex min-h-0 flex-col', chatAway ? 'h-0 overflow-hidden' : 'h-full')}
      />
      {chatAway && placement !== 'home' && <ChatHostPlaceholder placement={placement} onBringBack={collapse} />}
      {createPortal(<HostWindowProvider value={hostWindowValue}>{children}</HostWindowProvider>, node)}
    </>
  );
}
