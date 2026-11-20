import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentApplication } from '@/modules/app-switcher';
import { CompanionCore, useCompanion } from '@/modules/companion';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { RoadmapCircle } from '@/modules/roadmap';
import { SessionsBoard } from '@/modules/sidebar';
import { openStation } from '@/shared/cloudcliDoors';
import { HOLDS_PLACES, ROADMAP_CIRCLE_AT_DESK, ROADMAP_CIRCLE_ON_PHONE } from '@/shared/constants';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { Project, RecentConversationListItem, RoadmapStackRest } from '@/shared/types';

/** The side of the square Kaylee's docked core is drawn in, in px: on a phone, and larger at a desk, where the foot has the room. */
const CORE_SIZE = 60;
const CORE_SIZE_AT_DESK = 76;

/**
 * Where the roadmap's circle rests at the head, in the home's own pixels, at a desk and on a phone: its middle on the line Kaylee's core stands on at the
 * foot, so the two are one above the other. The head is as tall as the circle needs, and the cog stands level with it across the page.
 */
const CIRCLE_AT_DESK: RoadmapStackRest = ROADMAP_CIRCLE_AT_DESK;
const CIRCLE_ON_PHONE: RoadmapStackRest = ROADMAP_CIRCLE_ON_PHONE;

/** The menu's side, in px, and how far the head reaches below the circle's middle: its radius, half an arc's band and a little air. */
const MENU_SIZE = 44;
const HEAD_BELOW_CIRCLE = 13;

type WorkspaceHomeProps = {
  /** Whether the home has been the page on screen at least once: its board reads the chats' feed from then on. */
  visited: boolean;
};

/**
 * THE SESSIONS HOME, the page `/home` shows: his chats laid out by folder across the page (`SessionsBoard`, the sidebar's simple list in another form), with
 * three marks at its corners. It is drawn over the held workspace and holds no state of its own: every press is one the workspace already has.
 *
 * - A CHAT, pressed, is brought forward in the workspace (`openChatInWorkspace`, the door Kaylee's own order to open a chat goes through). New chat is the
 *   workspace's new-chat screen; a chat closed or deleted here is let go of by the workspace as if its own list had removed it.
 * - KAYLEE'S CORE, docked at the foot on the start side, live as it is everywhere and drawn as a chat's core is (`CompanionCore`): the
 *   body with her conversation's context and the account's week as two rings on it. A press on the core opens the station; a press
 *   on the outer ring's band opens the account switcher; a long press brings up the wheel of places, held (`HOLDS_PLACES`).
 * - THE MENU, at the head on the end side, is the one way to every other place (`PlacesMenu`): it brings up the wheel of places (the
 *   screens, the station, the last chat, Settings, and the applications' acts under it). It is the same press the chat's head and the
 *   station carry, so the way out of any page is in one place.
 * - THE ROADMAP'S CIRCLE, at the head on the start side, over Kaylee's core: small until pressed, then the whole stack over the home (`RoadmapCircle`,
 *   which lies over the home's box and takes no press but the circle's while it is small).
 *
 * The root is the workspace frame's own box (`pwa-status-clear fixed inset-0`, its bottom riding `--keyboard-height`), so in the home-screen app it clears
 * the status bar and lifts over the keyboard as the frame does.
 *
 * Rendered by `WorkspaceHomeLayer`, inside the shell's providers (Kaylee's among them).
 */
export function WorkspaceHome({ visited }: WorkspaceHomeProps) {
  const { t } = useTranslation();
  const { sidebarSharedProps } = useProjectSidebarState();
  const { projects, onNewSession, onSessionDelete, isMobile } = sidebarSharedProps;
  const circle = isMobile ? CIRCLE_ON_PHONE : CIRCLE_AT_DESK;
  const coreSize = isMobile ? CORE_SIZE : CORE_SIZE_AT_DESK;
  const doors = useStationDoors();
  // How many times the reader has come back from the station with its roadmap standing: the circle lies down from standing each time (`RoadmapCircle`).
  const [returns, setReturns] = useState(0);
  useEffect(() => doors.onShowingChange(() => {
    if (doors.homeShowing() && doors.takeRoadmapTravel('home')) setReturns((count) => count + 1);
  }), [doors]);
  const { picture } = useCompanion();
  const companionName = picture?.settings.name ?? t('companion.defaultName');

  const openChat = useCallback((chat: RecentConversationListItem) => doors.openChatInWorkspace(chat.sessionId), [doors]);
  // The workspace's own New chat: it stands the workspace on its new-chat screen while the home still covers it (its move is held), then the page follows.
  const newChat = useCallback((project: Project) => {
    onNewSession(project);
    doors.navigate('/');
  }, [onNewSession, doors]);
  const sessionRemoved = useCallback((sessionId: string) => onSessionDelete(sessionId), [onSessionDelete]);

  // An application put up from here (a row of the list, pressed) stands over the workspace, which this page covers: the workspace
  // comes forward so it is seen. Only a change of the application in front while the home is on screen; one already up stays under.
  const applicationId = useCurrentApplication()?.app.id ?? null;
  const shownApplicationRef = useRef(applicationId);
  useEffect(() => {
    const before = shownApplicationRef.current;
    shownApplicationRef.current = applicationId;
    if (applicationId !== null && applicationId !== before && doors.homeShowing()) doors.navigate(doors.workspacePath());
  }, [applicationId, doors]);

  return (
    <div
      data-workspace-home=""
      className="pwa-status-clear fixed inset-0 flex flex-col bg-background text-foreground"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <header className="flex flex-none items-start justify-end px-3 md:pr-11" style={{ height: circle.cy + circle.radius + HEAD_BELOW_CIRCLE, paddingTop: circle.cy - MENU_SIZE / 2 }}>
        <PlacesMenu triggerClassName="size-11" />
      </header>

      <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-2 md:px-12">
        <h1 className="sr-only">{t('home.title')}</h1>
        <SessionsBoard projects={projects} enabled={visited} onOpenChat={openChat} onNewChat={newChat} onSessionRemoved={sessionRemoved} />
      </main>

      {/* At a desk the foot is taller for the larger core, which keeps its middle under the roadmap's circle (66 px in). */}
      <footer className="flex h-[84px] flex-none items-center justify-between px-3 pb-[var(--safe-area-inset-bottom)] md:h-[100px] md:pl-7 md:pr-11">
        {/* The inner ring is a reading here (the conversation is the station's): the core's press takes its band, and only the outer
            ring's band, outside it, opens the account switcher. */}
        <CompanionCore
          size={coreSize}
          label={t('home.station', { name: companionName })}
          onPress={() => {
            // The roadmap goes with the reader: the station's stack arrives from this page's circle.
            doors.markRoadmapTravel('station');
            openStation(doors.navigate);
          }}
          layered={!isMobile}
          // Held, the core brings up the places, a fan from the foot on a phone: slide to one and let go.
          pressMarks={{ 'data-home-core': '', ...HOLDS_PLACES }}
        />
      </footer>

      <RoadmapCircle rest={circle} returns={returns} />
    </div>
  );
}
