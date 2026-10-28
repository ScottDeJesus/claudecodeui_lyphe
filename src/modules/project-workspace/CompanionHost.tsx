import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useCurrentApplication } from '@/modules/app-switcher';
import { useChatHost } from '@/modules/chat-host';
import { CompanionProvider } from '@/modules/companion';
import { useProjectEffectsState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/**
 * Rendered by ProjectWorkspaceShell inside the chat host's and the application switcher's providers: holds Kaylee's provider
 * and answers her order to open a chat on this page, which is the one thing she asks of the workspace.
 *
 * OPENING A CHAT HERE IS THREE THINGS, in this order. The Chat view comes forward (as a notification's landing does: the
 * route alone leaves a page on Files or Git looking at Files or Git). The route moves to `/session/<id>`. And when an
 * application is in front of the main region, which hides the chat view whatever the route says, the chat host's `open()`
 * floats the chat over it: the way the chat's hotkey and the switcher's FAB bring it, and one that needs no gesture, since a
 * window the browser refuses (a socket frame has no user activation) falls back to the floating panel. With no application
 * up, the chat view is already what is on screen and the chat is left where it is.
 *
 * The callback changes identity when an application comes or goes; the provider reads the newest at the moment a frame
 * arrives, so nothing resubscribes.
 */
export default function CompanionHost({ navigate, children }: Pick<ProjectWorkspaceShellProps, 'navigate'> & { children: ReactNode }) {
  // The effects slice, not the main one: its callbacks keep one identity, so a selection does not wake this component.
  const { setActiveTab } = useProjectEffectsState();
  const { open: floatChat } = useChatHost();
  const covered = useCurrentApplication() !== null;

  const openCompanionChat = useCallback(
    (sessionId: string) => {
      setActiveTab('chat');
      navigate(`/session/${sessionId}`);
      if (covered) floatChat();
    },
    [setActiveTab, navigate, covered, floatChat],
  );

  return <CompanionProvider onOpenChat={openCompanionChat}>{children}</CompanionProvider>;
}
