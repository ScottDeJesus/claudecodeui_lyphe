import { Menu as MenuIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSwitcherActions } from '@/modules/app-switcher';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceViews } from '@/modules/project-workspace/hooks/useWorkspaceViews';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { AppTab, ChatDoor } from '@/shared/types';
import { ActionMenu } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';

/**
 * The screens the menu leads to, in its order. The Roadmap view leads them: the features are what the menu is opened for most.
 * Chat is not one (the home is the chats), and the tools not used as screens (Shell, Files, Git, Browser, Tasks, Notes) stay on
 * the rail alone. A view the person has hidden from the navigation is left out here too.
 */
const MENU_VIEWS: readonly AppTab[] = ['runner', 'cerberus', 'inbox', 'api', 'kanban', 'universe', 'schedules'];

/**
 * A chat door that opens nothing, for the switcher's list of acts: the list wants a door for its Chat act, and the menu leaves that
 * act out (it floats the chat, which is the chat's own to do). The workspace's own door (`useChatDoor`) is built once, by its frame.
 */
const NO_CHAT_DOOR: ChatDoor = { floating: false, unread: false, toggle: () => {}, collapse: () => {} };

type PlacesMenuProps = {
  /** The page the menu stands on: that page is left out of its own list (a screen's own name too: the Bugs view's, `kanban`). */
  here: 'home' | 'chat' | 'station' | 'kanban';
  /** Classes for the trigger, whose size is its page's to say (the home's corner, the chat's head, the row by the companion's name). */
  triggerClassName?: string;
};

/**
 * THE ONE WAY TO EVERY OTHER PLACE, the same button on each page: the menu mark, which opens one list. First the screens (Roadmap
 * leading them), then the two pages that are not screens of the workspace (the sessions home, Kaylee Station; the one the menu
 * stands on is left out), then Settings, then, away from the station, the applications' acts. It only takes the reader places:
 * nothing in it counts or marks what waits on them.
 *
 * Every press is one the workspace already has: a screen is the workspace's own view brought forward at the address it held,
 * Settings is the workspace's dialog (a portal over every page), and the two pages are their doors (`openHome`, `openStation`).
 *
 * Used by `home/WorkspaceHome` (its head's end, where the cog stood), `ChatHead` (the end of the chat's head), `WorkspaceMain` (handed
 * to the Bugs view, the end of its head) and, through this module's barrel, the station module's `StationKaylee` (the last press in
 * the row by the companion's name).
 */
export function PlacesMenu({ here, triggerClassName }: PlacesMenuProps) {
  const { t } = useTranslation();
  const { setActiveTab, sidebarSharedProps } = useProjectSidebarState();
  const { onShowSettings } = sidebarSharedProps;
  const { views } = useWorkspaceViews();
  const doors = useStationDoors();
  const switcherActs = useSwitcherActions(NO_CHAT_DOOR);

  const items = useMemo<ActionMenuItem[]>(() => {
    const screens: ActionMenuItem[] = MENU_VIEWS.filter((id) => id !== here).flatMap((id) => {
      const view = views.find((item) => item.id === id && !item.hiddenFromNav);
      if (view === undefined) return [];
      return [{
        key: view.id,
        label: view.label,
        // The view first, then the page: the workspace comes forward at the address it held, already showing it.
        onSelect: () => {
          setActiveTab(view.id);
          doors.navigate(doors.workspacePath());
        },
      }];
    });
    const pages: ActionMenuItem[] = [
      ...(here === 'home' ? [] : [{ key: 'home', label: t('home.title'), onSelect: () => openHome(doors.navigate) }]),
      ...(here === 'station' ? [] : [{
        key: 'station',
        label: t('station.title', { defaultValue: 'Kaylee Station' }),
        onSelect: () => {
          // From the home the roadmap goes with the reader: the station's ring arrives from the home's circle.
          if (here === 'home') doors.markRoadmapTravel('station');
          openStation(doors.navigate);
        },
      }]),
    ].map((item, index) => ({ ...item, showDividerBefore: index === 0 && screens.length > 0 }));
    const settings: ActionMenuItem = { key: 'settings', label: t('rail.settings'), showDividerBefore: true, onSelect: onShowSettings };
    // The applications' acts: the list of applications always, and what can be done to the one in front while one is up. Not at
    // the station, which covers the workspace an application stands over.
    const applications: ActionMenuItem[] = here === 'station' ? [] : switcherActs
      .filter((act) => act.key !== 'chat' && !act.disabled)
      .map((act, index) => ({ key: `application-${act.key}`, label: act.label, showDividerBefore: index === 0, onSelect: act.run }));
    return [...screens, ...pages, settings, ...applications];
  }, [views, here, t, setActiveTab, doors, onShowSettings, switcherActs]);

  return (
    <ActionMenu
      label={t('places.menu')}
      ariaLabel={t('places.menu')}
      items={items}
      icon={MenuIcon}
      iconOnly
      align="right"
      variant="outline"
      size="icon"
      triggerClassName={triggerClassName}
    />
  );
}
