import { LLMProviderLogo } from '@/shared/ui';
import { getSessionTitle } from '@/shared/utils';
import type { Project, ProjectSession } from '@/shared/types';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import { ChatExportMenu, TokenUsageSummary, type ChatExportSurface, type TokenUsageSurface } from '@/modules/chat';

type WorkspaceHeaderProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  /**
   * The active view's rail name; `null` on Chat, where the header names the open chat instead. `null` is
   * also what an id the views list does not hold gets — a plugin's view while the plugin list loads or
   * after the plugin is gone — and the header then reads as the chat.
   */
  viewLabel: string | null;
  isMobile: boolean;
  onMenuClick: () => void;
  newSessionLabel: string;
  /** The open chat's token count and its breakdown opener; `null` off the chat tab. */
  tokenUsage?: TokenUsageSurface | null;
  /** What the open chat needs to be exported; `null` off the chat tab or with nothing to export. */
  chatExport?: ChatExportSurface | null;
};

/**
 * The strip above the active pane — on mobile only.
 *
 * It carries the drawer button and a name. On DESKTOP it renders nothing: the sidebar is docked
 * one column to the left and already names the chat, so a second copy would be a full-width bar
 * repeating the line beside it. On mobile that sidebar is a slide-over, so both things here are
 * the only ones on screen — the only way to reach navigation, and the only place the screen is named.
 *
 * WHAT IT NAMES DEPENDS ON THE VIEW. On Chat (`viewLabel` null) it is the open chat: the provider's
 * logo, the chat's title, and — with a project selected — the project's name underneath. On any other
 * view it is that view's rail name alone, as the mockup's topbar has it: the chat is not what the
 * operator is looking at there, so naming it would label a screen with another screen's title, and
 * the logo and the project line belong to that chat. A view with no name to give (`viewLabel` null for
 * an id the views list does not hold) cannot be told apart from Chat here, so it wears the chat's face.
 *
 * The Chat / Files / Git tabs used to live here too, with a scroller and a pair of chevrons;
 * they moved to the sidebar under the wordmark and did not come back. The token count came the
 * other way: on a phone the composer's footer row is the tightest strip on the screen, so below
 * `md` the count sits at this row's right edge and the composer hides its copy. The export
 * button sits to the count's right for the same reason: on a phone it floated over the top of
 * the transcript it was offering to export.
 */
export default function WorkspaceHeader({
  selectedProject,
  selectedSession,
  viewLabel,
  isMobile,
  onMenuClick,
  newSessionLabel,
  tokenUsage = null,
  chatExport = null,
}: WorkspaceHeaderProps) {
  if (!isMobile) return null;

  const onChat = viewLabel === null;
  const title = viewLabel ?? (selectedSession ? getSessionTitle(selectedSession) : newSessionLabel);

  return (
    <header className="pwa-header-safe flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-1.5 backdrop-blur-sm">
      <MobileMenuButton onMenuClick={onMenuClick} />
      {onChat && selectedSession && (
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
        {onChat && selectedProject && (
          <div className="truncate text-xs leading-tight text-muted-foreground">
            {selectedProject.displayName}
          </div>
        )}
      </div>
      {tokenUsage && (
        <TokenUsageSummary usage={tokenUsage.usage} onClick={tokenUsage.onShow} className="flex-none" />
      )}
      {chatExport && (
        <div className="flex-none">
          <ChatExportMenu {...chatExport} />
        </div>
      )}
    </header>
  );
}
