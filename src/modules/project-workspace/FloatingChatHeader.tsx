import { useCurrentApplication } from '@/modules/app-switcher';
import {
  useProjectChatState,
  useProjectSidebarState,
} from '@/modules/project-workspace/context/ProjectsStateContext';
import { SidebarSessionPicker } from '@/modules/sidebar';

/**
 * Rendered by WorkspaceFrame as the `header` of the floating chat (`ChatHostFloating`): the session part of
 * the panel's and the picture-in-picture window's top row, so a floating chat switches conversations the way
 * the sidebar does.
 *
 * THE ONLY NEW READER OF THE SIDEBAR STATE. That state (`sidebarSharedProps`) is rebuilt on every session
 * upsert, and whoever reads it wakes on each one. So the read lives in this small header alone: WorkspaceFrame,
 * the shell and the door never subscribe to it, and a background upsert re-renders a 40px row instead of the
 * workspace. Everything else the frame needs comes from the chat state, whose value moves only when the project
 * choices do.
 *
 * New chat starts in the project the application in front points at (`AppEntry.project`), the same project the
 * chat's door brings, and where nothing is framed or the application names none, `openProjectChat` reads null as
 * the project the chat is already in.
 */
export default function FloatingChatHeader() {
  const { sidebarSharedProps } = useProjectSidebarState();
  const { openProjectChat } = useProjectChatState();
  const currentApplication = useCurrentApplication();

  // The five members the picker takes, by name: `sidebarSharedProps` carries the sidebar's whole surface, and
  // handing it on whole would give the picker fifteen props it must not read.
  const { projects, selectedProject, selectedSession, onProjectSelect, onSessionSelect } = sidebarSharedProps;

  return (
    <SidebarSessionPicker
      projects={projects}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      onProjectSelect={onProjectSelect}
      onSessionSelect={onSessionSelect}
      onNewChat={() => openProjectChat(currentApplication?.app.project ?? null, 'new')}
    />
  );
}
