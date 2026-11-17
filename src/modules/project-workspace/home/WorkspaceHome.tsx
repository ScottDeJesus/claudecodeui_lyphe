import { Menu as MenuIcon, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentApplication, useSwitcherActions } from '@/modules/app-switcher';
import { CompanionFace, useCompanion } from '@/modules/companion';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useRailBadges } from '@/modules/project-workspace/hooks/useRailBadges';
import { useWorkspaceViews } from '@/modules/project-workspace/hooks/useWorkspaceViews';
import { RoadmapCircle } from '@/modules/roadmap';
import { SessionsBoard } from '@/modules/sidebar';
import { openStation } from '@/shared/cloudcliDoors';
import { ROADMAP_CIRCLE_AT_DESK, ROADMAP_CIRCLE_ON_PHONE } from '@/shared/constants';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { AppTab, ChatDoor, Project, RecentConversationListItem, RoadmapStackRest } from '@/shared/types';
import { ActionMenu, Button } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';

/**
 * The views the home's menu leads to, in its order: the screens he visits seldom. Chat is not one (the home is his chats), and the tools he does not use as
 * screens (Shell, Files, Git, Browser, Tasks, Notes) stay on the rail alone. The Roadmap view leads them for what the home's circle does not carry: the
 * tree, the choice of roadmap, and In flight's board. A view the person has hidden from the navigation is left out here too.
 */
const MENU_VIEWS: readonly AppTab[] = ['runner', 'cerberus', 'inbox', 'api', 'kanban', 'universe', 'schedules'];

/** The side of the square Kaylee's docked core is drawn in, in px: a chat's own core's size. */
const CORE_SIZE = 60;

/**
 * Where the roadmap's circle rests at the head, in the home's own pixels, at a desk and on a phone: its middle on the line Kaylee's core stands on at the
 * foot, so the two are one above the other. The head is as tall as the circle needs, and the cog stands level with it across the page.
 */
const CIRCLE_AT_DESK: RoadmapStackRest = ROADMAP_CIRCLE_AT_DESK;
const CIRCLE_ON_PHONE: RoadmapStackRest = ROADMAP_CIRCLE_ON_PHONE;

/**
 * A chat door that opens nothing, for the switcher's list of acts: the list wants a door for its Chat act, and the home leaves that act out
 * (the chat it would float belongs to a page the home covers). The workspace's own door (`useChatDoor`) is built once, by its frame.
 */
const NO_CHAT_DOOR: ChatDoor = { floating: false, unread: false, toggle: () => {}, collapse: () => {} };

/** The cog's side, in px, and how far the head reaches below the circle's middle: its radius, half an arc's band and a little air. */
const COG_SIZE = 44;
const HEAD_BELOW_CIRCLE = 13;

type WorkspaceHomeProps = {
  /** Whether the home has been the page on screen at least once: its board reads the chats' feed from then on. */
  visited: boolean;
};

/**
 * THE SESSIONS HOME, the page `/home` shows: his chats laid out by folder across the page (`SessionsBoard`, the sidebar's simple list in another form), with
 * four marks at its corners. It is drawn over the held workspace and holds no state of its own: every press is one the workspace already has.
 *
 * - A CHAT, pressed, is brought forward in the workspace (`openChatInWorkspace`, the door Kaylee's own order to open a chat goes through). New chat is the
 *   workspace's new-chat screen; a chat closed or deleted here is let go of by the workspace as if its own list had removed it.
 * - KAYLEE'S CORE, docked at the foot on the start side, live as it is everywhere (`CompanionFace`): a press opens the station.
 * - THE COG, at the head on the end side, opens Settings over the home (the workspace's own dialog, which stands in a portal over every page).
 * - THE MENU, at the foot on the end side, lists the screens he visits seldom, each with what its rail badge says while it has one; choosing one shows that
 *   view in the workspace.
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
  const { setActiveTab, sidebarSharedProps } = useProjectSidebarState();
  const { projects, onNewSession, onSessionDelete, onShowSettings, isMobile } = sidebarSharedProps;
  const circle = isMobile ? CIRCLE_ON_PHONE : CIRCLE_AT_DESK;
  const { views } = useWorkspaceViews();
  const badges = useRailBadges();
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

  const places = useMemo<ActionMenuItem[]>(() => MENU_VIEWS.flatMap((id) => {
    const view = views.find((item) => item.id === id && !item.hiddenFromNav);
    if (view === undefined) return [];
    return [{
      key: view.id,
      label: view.label,
      description: badges[view.id]?.words,
      // The view first, then the page: the workspace comes forward at the address it held, already showing it.
      onSelect: () => {
        setActiveTab(view.id);
        doors.navigate(doors.workspacePath());
      },
    }];
  }), [views, badges, setActiveTab, doors]);

  // The applications' acts, under the screens: the list of applications always, and what can be done to the one in front (reload it,
  // close it, open it in a tab) while one is up. The switcher's own list (`useSwitcherActions`), less the acts that cannot run and less
  // Chat, which floats the chat of a page this one covers. This menu is where the applications' floating button went.
  const switcherActs = useSwitcherActions(NO_CHAT_DOOR);
  const applicationActs = useMemo<ActionMenuItem[]>(() => switcherActs
    .filter((act) => act.key !== 'chat' && !act.disabled)
    .map((act, index) => ({
      key: `application-${act.key}`,
      label: act.label,
      showDividerBefore: index === 0,
      onSelect: act.run,
    })), [switcherActs]);
  const menuItems = useMemo(() => [...places, ...applicationActs], [places, applicationActs]);

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
      <header className="flex flex-none items-start justify-end px-3 md:pr-11" style={{ height: circle.cy + circle.radius + HEAD_BELOW_CIRCLE, paddingTop: circle.cy - COG_SIZE / 2 }}>
        <Button data-home-settings variant="outline" size="icon" className="size-11" aria-label={t('rail.settings')} title={t('rail.settings')} onClick={onShowSettings}>
          <Settings aria-hidden="true" />
        </Button>
      </header>

      <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-2 md:px-12">
        <h1 className="sr-only">{t('home.title')}</h1>
        <SessionsBoard projects={projects} enabled={visited} onOpenChat={openChat} onNewChat={newChat} onSessionRemoved={sessionRemoved} />
      </main>

      <footer className="flex h-[84px] flex-none items-center justify-between px-3 pb-[var(--safe-area-inset-bottom)] md:pl-9 md:pr-11">
        <button
          type="button"
          data-home-core
          aria-label={t('home.station', { name: companionName })}
          title={t('home.station', { name: companionName })}
          onClick={() => {
            // The roadmap goes with the reader: the station's stack arrives from this page's circle.
            doors.markRoadmapTravel('station');
            openStation(doors.navigate);
          }}
          className="grid flex-none place-items-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          style={{ width: CORE_SIZE, height: CORE_SIZE }}
        >
          <CompanionFace size={CORE_SIZE} />
        </button>
        {menuItems.length > 0 && (
          <ActionMenu
            label={t('home.places')}
            ariaLabel={t('home.places')}
            items={menuItems}
            icon={MenuIcon}
            iconOnly
            align="right"
            variant="outline"
            size="icon"
            triggerClassName="size-11"
          />
        )}
      </footer>

      <RoadmapCircle rest={circle} returns={returns} />
    </div>
  );
}
