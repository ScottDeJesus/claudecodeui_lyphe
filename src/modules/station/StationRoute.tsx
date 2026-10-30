import { useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatHostProvider } from '@/modules/chat-host';
import { CompanionProvider } from '@/modules/companion';
import { StationProvider, useStation } from '@/modules/station/context/StationContext';
import { useStationPresence } from '@/modules/station/hooks/useStationPresence';
import { useTakeHerFloor } from '@/modules/station/hooks/useTakeHerFloor';
import { StationShell } from '@/modules/station/StationShell';
import type { CompanionOpenTarget } from '@/shared/companion-types';
import { useTheme } from '@/shared/context/ThemeContext';

/**
 * Her provider on the station: the page holds one provider, and the workspace's `CompanionHost` does not exist on this route.
 * Her `open` puts what she opened on the stage — a chat, a card or a page, named by the label her door resolved — and the
 * workspace's navigation is not used. It stands INSIDE `StationProvider` because the stage is the station's: `onOpen` is a
 * press on it.
 */
function StationCompanion({ children }: { children: ReactNode }) {
  const { setFocus } = useStation();

  const openOnStage = (target: CompanionOpenTarget, label: string) => {
    switch (target.kind) {
      // A server a moment older than this page sends no label: the thing's own id names it until it is drawn.
      case 'chat':
        setFocus({ kind: 'chat', sessionId: target.sessionId, label: label || target.sessionId });
        return;
      case 'card':
        setFocus({ kind: 'card', plan: target.plan, label: label || target.plan });
        return;
      case 'page':
        setFocus({ kind: 'page', pageId: target.pageId, blockId: target.blockId, label: label || target.pageId });
        return;
    }
  };

  return <CompanionProvider onOpen={openOnStage}>{children}</CompanionProvider>;
}

/** What stands inside both providers: her floor, the presence of the stage, and the station's layout. */
function StationHome() {
  useTakeHerFloor();
  useStationPresence();
  return <StationShell />;
}

/**
 * KAYLEE STATION, the route at `/station`: the operator's watch-floor page, beside the workspace and outside its shell. It
 * stands inside every provider `App` mounts above the Router (auth, the one socket, the live bus, the lanes' feeds, theme,
 * toasts), so its regions read what the workspace reads.
 *
 * What it mounts, outermost first: THE THEME HOLD (the page is held dark while it stands, over his preference and without
 * writing it, so the toasts and dialogs that portal to `body` are dark too); the chat host's provider (her provider's
 * talk binding listens in the window the chat floats in, so it reads `useChatHost`; no chat is drawn here, so the host
 * stays idle); `StationProvider` (the focus, the back-stack, the tier, the memory); her provider (`CompanionProvider`),
 * mounted here because the workspace's host is not; and `StationHome` (her floor, the presence of the stage, the layout).
 *
 * Rendered by `src/App.tsx` through the module's barrel, in a `Suspense`.
 */
export function StationRoute() {
  const { t } = useTranslation();
  const { holdTheme } = useTheme();

  // A LAYOUT effect, so the hold is on before the first paint of the page and the station never shows light.
  useLayoutEffect(() => holdTheme('dark'), [holdTheme]);

  const title = t('station.title', { defaultValue: 'Kaylee Station' });
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [title]);

  return (
    <ChatHostProvider>
      <StationProvider>
        <StationCompanion>
          <StationHome />
        </StationCompanion>
      </StationProvider>
    </ChatHostProvider>
  );
}
