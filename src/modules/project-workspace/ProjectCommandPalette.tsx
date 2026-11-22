import { AudioLines } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSwitcherActions } from '@/modules/app-switcher';
import { CommandPalette } from '@/modules/command-palette';
import { useCompanion } from '@/modules/companion';
import { selectGitRepository } from '@/modules/git-panel';
import { usePlaces } from '@/modules/project-workspace/context/PlacesContext';
import { useProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceViews } from '@/modules/project-workspace/hooks/useWorkspaceViews';
import { GIT_REPO_PATHS } from '@/shared/constants';
import { useHomeShowing, useStationShowing } from '@/shared/context/StationLayerContext';
import type { AppTab, ChatDoor, PaletteGroup, PaletteNavRow } from '@/shared/types';

/** The views that are places of the wheel's, listed with the places: the rest of the views follow them. */
const PLACE_VIEWS: ReadonlySet<AppTab> = new Set<AppTab>(['runner', 'kanban', 'cerberus', 'inbox', 'api', 'universe', 'schedules', 'rnd']);

/**
 * Rendered by WorkspaceFrame to bind this module's project state, and the chat's door, to the
 * command-palette module. The door is handed in rather than built here because WorkspaceFrame builds
 * it once for the hotkey, the FAB and this palette: a second `useChatDoor` would be a second
 * "which press goes which way" to keep in step.
 */
function ProjectCommandPalette({ chatDoor }: { chatDoor: ChatDoor }) {
  const { t } = useTranslation();
  const {
    selectedProject,
    handleNewSession,
    openSettings,
    setActiveTab,
  } = useProjectCommandState();
  const { views } = useWorkspaceViews();
  const { places, newProject } = usePlaces();
  const stationShowing = useStationShowing();
  const homeShowing = useHomeShowing();

  // The switcher's five acts, the list the radial draws too. They are the switcher's to define (which
  // pane is in front, what a Reload is), so this only forwards them to the palette's Applications group.
  const switcherActions = useSwitcherActions(chatDoor);

  // The commit and branch rows lead to the git tab on this project's repository, so they are
  // offered only for a project that tab carries — a row for any other would bring forward a
  // repository other than the one it named. Keyed on the path STRING so a new project object with
  // the same path does not hand the palette a new function.
  const selectedRepoPath = selectedProject?.fullPath ?? null;
  const showSelectedRepoInGitTab = useMemo(
    () => (selectedRepoPath && (GIT_REPO_PATHS.length === 0 || GIT_REPO_PATHS.includes(selectedRepoPath))
      ? () => {
        selectGitRepository(selectedRepoPath);
        setActiveTab('git');
      }
      : null),
    [selectedRepoPath, setActiveTab],
  );

  // THE PLACES LEAD: the wheel's places in the wheel's order (Home, the station, the Roadmap, Bugs, the last chat, then the outer
  // ring's, Settings last), each going where the wheel's own press goes; then every other view off the one list the rail reads, so a
  // view added to that list is reachable here with no second edit. Memoised because a fresh array on every render would defeat the memo().
  const navRows = useMemo<PaletteNavRow[]>(
    () => [
      ...places.map((place) => ({ key: `place-${place.id}`, label: place.label, keywords: place.keywords, icon: place.icon, run: place.go })),
      ...views.filter((view) => !PLACE_VIEWS.has(view.id)).map((view) => ({
        key: view.id,
        label: view.label,
        keywords: view.keywords,
        icon: view.icon ?? undefined,
        run: () => setActiveTab(view.id),
      })),
    ],
    [places, views, setActiveTab],
  );

  // Kaylee's group: a row that opens her panel (her station is a place, so it is among the places). Her name is the one he gave her,
  // so it is read off her picture, and the memo keeps the group's identity through the frames she sends (each sentence changes the
  // picture, not her name).
  const { picture, setOpen: setCompanionOpen } = useCompanion();
  const companionName = picture?.settings.name ?? t('companion.defaultName');
  const companionGroup = useMemo<PaletteGroup>(
    () => ({
      heading: t('companion.palette.group', { name: companionName }),
      rows: [
        {
          key: 'companion',
          label: t('companion.palette.talk', { name: companionName }),
          keywords: t('companion.palette.keywords'),
          icon: AudioLines,
          run: () => setCompanionOpen(true),
        },
      ],
    }),
    [t, companionName, setCompanionOpen],
  );

  // The station or the sessions home on screen covers this page, and Ctrl+K is heard on the whole document: with the palette drawn it would open on a page
  // nobody sees and be open when he comes back. Not drawn, it hears nothing.
  if (stationShowing || homeShowing) return null;

  return (
    <CommandPalette
      selectedProject={selectedProject}
      onStartNewChat={handleNewSession}
      onOpenSettings={openSettings}
      onShowTab={setActiveTab}
      onShowRepoInGitTab={showSelectedRepoInGitTab}
      navRows={navRows}
      companionGroup={companionGroup}
      onNewProject={newProject}
      switcherActions={switcherActions}
    />
  );
}

export default memo(ProjectCommandPalette);
