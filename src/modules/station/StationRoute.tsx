import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { StationProvider, useStation } from '@/modules/station/context/StationContext';
import { StationLandedProvider } from '@/modules/station/context/StationLandedContext';
import { StationNeedsProvider } from '@/modules/station/context/StationNeedsContext';
import { StationSessionsProvider } from '@/modules/station/context/StationSessionsContext';
import { useCardsTakeStage } from '@/modules/station/hooks/useCardsTakeStage';
import { useStationPresence } from '@/modules/station/hooks/useStationPresence';
import { useTakeHerFloor } from '@/modules/station/hooks/useTakeHerFloor';
import { useUnlockHerVoice } from '@/modules/station/hooks/useUnlockHerVoice';
import { StationShell } from '@/modules/station/StationShell';
import type { CompanionOpenTarget } from '@/shared/companion-types';
import { useStationDoors, useStationShowing } from '@/shared/context/StationLayerContext';
import { HeldPage } from '@/shared/ui';

/**
 * Where her `open` lands while the station is the page on screen: the workspace's host (`CompanionHost`) hands her every order to the station first
 * (`openOnStage`), and this registers the answer. It puts what she opened on the stage — a chat, a card, a page or a check, named by the label her door
 * resolved — and the workspace's navigation is not used. It stands INSIDE `StationProvider` because the stage is the station's. Draws nothing.
 */
function StageOpensForHer() {
  const { setFocus } = useStation();
  const { registerStageOpen } = useStationDoors();

  useEffect(() => {
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
        case 'check':
          setFocus({ kind: 'check', node: target.node, key: target.key, label: label || target.key });
          return;
      }
    };
    return registerStageOpen(openOnStage);
  }, [setFocus, registerStageOpen]);

  return null;
}

/**
 * What the station does only while it is the page on screen, in a component of its own so a switch of pages re-renders this and nothing under it: she
 * takes her floor here and unlocks her voice on his first press, the page's title is the station's, and what the page shows is told to the server
 * (`useStationPresence`). Each stands down when the workspace comes forward, and starts again when the station does. Draws nothing.
 */
function StationWhileShowing() {
  const { t } = useTranslation();
  const showing = useStationShowing();
  useTakeHerFloor();
  useUnlockHerVoice();
  useStationPresence();

  const title = t('station.title', { defaultValue: 'Kaylee Station' });
  useEffect(() => {
    if (!showing) return undefined;
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [showing, title]);

  return null;
}

/** Holds the station's layer while the workspace is the page on screen. Its own component, so `children` (built once) is not re-rendered by a switch. */
function HeldStation({ children }: { children: ReactNode }) {
  return <HeldPage held={!useStationShowing()}>{children}</HeldPage>;
}

/** What stands inside every provider: her new cards and walk taking the stage, and the station's layout. */
function StationHome() {
  useCardsTakeStage();
  return <StationShell />;
}

/**
 * KAYLEE STATION, the page `/station` shows: the operator's watch-floor, drawn over the workspace and never in place of it. It is mounted by
 * `StationLayer` on the first visit and then STAYS MOUNTED, held out of reach (`HeldPage`) while the workspace is on screen, so a return to it
 * draws what it held and fetches nothing: the stage, the rail's reads, the strip's landings, the scroll, what he typed to her.
 *
 * It is drawn inside the workspace's own providers (`ProjectWorkspaceShell` hosts it beside the frame), so it reads what the workspace
 * reads: auth, the one socket, the live bus, the lanes' feeds, the theme, the toasts, THE CHAT HOST AND KAYLEE'S PROVIDER. The page holds one of each: her
 * `companion_open` reaches the station through the doors (`StageOpensForHer`) while it is on screen, her floor and her voice are the page's, and no second
 * client name or second chat host exists. And it wears the app's own theme: nothing here holds a colour over his choice.
 *
 * What it mounts, outermost first: `StationProvider` (the focus, the back-stack, the tier, the memory); `StationSessionsProvider` (his chats, read at
 * mount and kept on the shell's hint, so the rail, the chat's stage and her draft's Steer all draw the same rows); `StationLandedProvider` (the
 * week's landings and his last look: the strip draws them, and the look-aways that write the look are heard while the station is on screen);
 * `StationNeedsProvider` (everything that needs him, read at mount and kept on six events: the rail draws its items, the stages say when theirs is gone,
 * and the compact and phone plans read its count); and, inside them, `StageOpensForHer` (her orders to open), `StationWhileShowing` (her floor, her voice's
 * unlock, the title and the presence, each only while the station is on screen) and `StationHome` (her new cards and walk taking the stage, and the layout).
 * The phone's frame (`pwa-mode` on html and body, `--keyboard-height`) is the workspace's, which never leaves.
 *
 * Rendered by `StationLayer` (this module), the lazy chunk's one entry.
 */
export function StationRoute() {
  return (
    <StationProvider>
      <StationSessionsProvider>
        <StationLandedProvider>
          <StationNeedsProvider>
            <StageOpensForHer />
            <StationWhileShowing />
            <HeldStation>
              <StationHome />
            </HeldStation>
          </StationNeedsProvider>
        </StationLandedProvider>
      </StationSessionsProvider>
    </StationProvider>
  );
}
