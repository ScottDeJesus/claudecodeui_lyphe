import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useBackToWorkspace, useCurrentApplication, useShowApplication } from '@/modules/app-switcher';
import { useChatHost } from '@/modules/chat-host';
import { CompanionProvider } from '@/modules/companion';
import { useProjectEffectsState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { CompanionOpenTarget } from '@/shared/companion-types';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/** The registry id of ArchPulse, whose DocSpace pages Kaylee opens (its deep links: `/#page=<id>[&block=<id>]`). */
const ARCHPULSE_APP_ID = 'archpulse';

/**
 * Rendered by ProjectWorkspaceShell inside the chat host's and the application switcher's providers: holds Kaylee's provider
 * and answers her orders to open a chat, a card, a page or a check on this page — the provider calls `onOpen(target, label)` only on the
 * page that holds the floor, so every branch below acts without asking whose turn it is. The workspace has no use for the label
 * (the spoken name the door resolved, which the station's stage names a thing by) and ignores it.
 *
 * OPENING A CHAT HERE IS THREE THINGS, in this order. The Chat view comes forward (as a notification's landing does: the
 * route alone leaves a page on Files or Git looking at Files or Git). The route moves to `/session/<id>`. And when an
 * application is in front of the main region, which hides the chat view whatever the route says, the chat host's `open()`
 * floats the chat over it: the way the chat's hotkey and the switcher's FAB bring it, and one that needs no gesture, since a
 * window the browser refuses (a socket frame has no user activation) falls back to the floating panel. With no application
 * up, the chat view is already what is on screen and the chat is left where it is.
 *
 * OPENING A CARD IS THE RUNNER LANDING, `?runner=<plan>`: `useRunnerLanding` takes the name and holds the Roadmap tab forward,
 * and its In flight face shows the card. When an application covers the workspace the tab would be drawn under it, so the
 * workspace comes forward first, through the switcher's own way back. The Roadmap tab is set at once, and the landing
 * (`useRevealCard`, the one writer of that URL) then moves the route to the current path with the param.
 *
 * OPENING A PAGE IS ARCHPULSE'S OWN DEEP LINK, `/#page=<id>[&block=<id>]`, shown through the switcher's `useShowApplication`:
 * it puts ArchPulse up at the address, and when ArchPulse is already up it MOVES that pane there (the drawer's toggle would
 * take it down), the page resolving the fragment on its own `hashchange`.
 *
 * OPENING A CHECK BRINGS THE CERBERUS TAB FORWARD, `setActiveTab('cerberus')`, the workspace first when an application covers it (the
 * tab would be drawn under it). The tab is the whole of Cerberus's health picture, so the check is found there, not singled out.
 *
 * The callback changes identity when an application comes or goes or the route moves; the provider reads the newest at the
 * moment a frame arrives, so nothing resubscribes.
 */
export default function CompanionHost({ navigate, children }: Pick<ProjectWorkspaceShellProps, 'navigate'> & { children: ReactNode }) {
  // The effects slice, not the main one: its callbacks keep one identity, so a selection does not wake this component.
  const { setActiveTab } = useProjectEffectsState();
  const { open: floatChat } = useChatHost();
  const covered = useCurrentApplication() !== null;
  const backToWorkspace = useBackToWorkspace();
  const showApplication = useShowApplication();
  const revealCard = useRevealCard();

  const openOnThisPage = useCallback(
    (target: CompanionOpenTarget, _label: string) => {
      switch (target.kind) {
        case 'chat':
          setActiveTab('chat');
          navigate(`/session/${target.sessionId}`);
          if (covered) floatChat();
          return;
        case 'card':
          if (covered) backToWorkspace();
          setActiveTab('runner');
          revealCard(target.plan);
          return;
        case 'page':
          showApplication(ARCHPULSE_APP_ID, `/#page=${target.pageId}${target.blockId ? `&block=${target.blockId}` : ''}`);
          return;
        case 'check':
          if (covered) backToWorkspace();
          setActiveTab('cerberus');
          return;
      }
    },
    [setActiveTab, navigate, covered, floatChat, backToWorkspace, revealCard, showApplication],
  );

  return <CompanionProvider onOpen={openOnThisPage}>{children}</CompanionProvider>;
}
