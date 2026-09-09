import { LLMProviderLogo } from '@/shared/ui';
import { getSessionTitle } from '@/shared/utils';
import type { Project, ProjectSession } from '@/shared/types';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';

type WorkspaceHeaderProps = {
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  isMobile: boolean;
  onMenuClick: () => void;
  newSessionLabel: string;
};

/**
 * The strip above the active pane — on mobile only.
 *
 * It carries the drawer button and the name of the open chat. On DESKTOP it renders nothing:
 * the sidebar is docked one column to the left and already names the chat, so a second copy
 * would be a full-width bar repeating the line beside it. On mobile that sidebar is a
 * slide-over, so both things here are the only ones on screen — the only way to reach
 * navigation, and the only place the open chat is named.
 *
 * The Chat / Files / Git tabs used to live here too, with a scroller and a pair of chevrons;
 * they moved to the sidebar under the wordmark and did not come back.
 */
export default function WorkspaceHeader({
  selectedProject,
  selectedSession,
  isMobile,
  onMenuClick,
  newSessionLabel,
}: WorkspaceHeaderProps) {
  if (!isMobile) return null;

  const title = selectedSession ? getSessionTitle(selectedSession) : newSessionLabel;

  return (
    <header className="pwa-header-safe flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-1.5 backdrop-blur-sm">
      <MobileMenuButton onMenuClick={onMenuClick} />
      {selectedSession && (
        <LLMProviderLogo provider={selectedSession.__provider} className="h-4 w-4 flex-none" />
      )}
      {/* `min-w-0` on the flex child is what lets `truncate` work at all — without it the
          child takes its content width and a long chat name pushes the row wider than the
          phone. The project name rides underneath because on mobile the sidebar that would
          otherwise say which project this is sits behind a drawer. */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight text-foreground" title={title}>
          {title}
        </div>
        <div className="truncate text-xs leading-tight text-muted-foreground">
          {selectedProject.displayName}
        </div>
      </div>
    </header>
  );
}
