import type { ReactNode } from 'react';

import { ChatHostFab } from '@/modules/chat-host/ChatHostFab';
import { ChatHostHeader } from '@/modules/chat-host/ChatHostHeader';
import { ChatHostPanel } from '@/modules/chat-host/ChatHostPanel';
import { ChatHostWindow } from '@/modules/chat-host/ChatHostWindow';
import { useChatHost } from '@/modules/chat-host/context/ChatHostContext';
import { useFloatingPanel } from '@/modules/chat-host/hooks/useFloatingPanel';
import { HeldPage } from '@/shared/ui';

/**
 * The panel and its button, in a component of its own so that the anchor, the viewport, the size and the pair's place are read
 * only while the panel exists.
 *
 * FOLDED, THE PANEL IS HELD (`HeldPage`), not taken down: it stays mounted with the chat's node in its body, so the transcript
 * keeps its scroll and the composer its draft, and nothing of it is seen, focused or pressed until the button brings it back.
 */
function FloatingPanel({ header }: { header: ReactNode }) {
  const { collapse, canPopOut, popOut, folded } = useChatHost();
  const { placement, bodyRef, onResize, onResizeEnd, moveHandle, fabPosition, onFabDragStart, onFabPositionChange } = useFloatingPanel();

  return (
    <>
      <HeldPage held={folded}>
        <ChatHostPanel
          placement={placement}
          header={<ChatHostHeader header={header} onCollapse={collapse} onPopOut={canPopOut ? popOut : undefined} moveHandle={moveHandle} />}
          bodyRef={bodyRef}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      </HeldPage>
      <ChatHostFab position={fabPosition} onDragStart={onFabDragStart} onPositionChange={onFabPositionChange} />
    </>
  );
}

/**
 * Used by project-workspace's WorkspaceFrame, beside the frame and outside its hold, so the chat floats over every page of the
 * app: the host the chat floats in. `header` is the header's session part.
 *
 * It draws the panel and its button while the placement is 'panel', the picture-in-picture window's header while it is 'window',
 * and nothing otherwise. It reads only the placement and the window, so a drag of the button or the header, which moves the anchor
 * many times a second, re-renders the panel beneath it and never this component.
 */
export function ChatHostFloating({ header }: { header: ReactNode }) {
  const { placement, pipWindow } = useChatHost();
  if (placement === 'panel') return <FloatingPanel header={header} />;
  if (placement === 'window' && pipWindow) return <ChatHostWindow pip={pipWindow} header={header} />;
  return null;
}
