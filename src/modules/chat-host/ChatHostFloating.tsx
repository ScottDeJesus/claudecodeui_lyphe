import type { ReactNode } from 'react';

import { ChatHostHeader } from '@/modules/chat-host/ChatHostHeader';
import { ChatHostPanel } from '@/modules/chat-host/ChatHostPanel';
import { ChatHostWindow } from '@/modules/chat-host/ChatHostWindow';
import { useChatHost } from '@/modules/chat-host/context/ChatHostContext';
import { useFloatingPanel } from '@/modules/chat-host/hooks/useFloatingPanel';

/** The panel, in a component of its own so that the anchor, the viewport and the size are read only while the panel exists. */
function FloatingPanel({ header }: { header: ReactNode }) {
  const { collapse } = useChatHost();
  const { placement, bodyRef, onResize, onResizeEnd } = useFloatingPanel();

  return (
    <ChatHostPanel
      placement={placement}
      header={<ChatHostHeader header={header} onCollapse={collapse} />}
      bodyRef={bodyRef}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
    />
  );
}

/**
 * Used by project-workspace's WorkspaceFrame inside the shell's fixed container, before the FAB: the host the
 * chat floats in. `header` is the header's session part.
 *
 * It draws the panel while the placement is 'panel', the picture-in-picture window's header while it is
 * 'window', and nothing otherwise. It reads only the placement and the window, so a drag of the FAB — which
 * moves the anchor many times a second — re-renders the panel beneath it and never this component.
 */
export function ChatHostFloating({ header }: { header: ReactNode }) {
  const { placement, pipWindow } = useChatHost();
  if (placement === 'panel') return <FloatingPanel header={header} />;
  if (placement === 'window' && pipWindow) return <ChatHostWindow pip={pipWindow} header={header} />;
  return null;
}
