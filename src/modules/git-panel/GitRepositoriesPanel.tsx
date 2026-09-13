import { useMemo } from 'react';

import type { FileOpenHandler, GitRepository } from '@/shared/types';
import { EmptyState, Tabs } from '@/shared/ui';
import GitPanel from '@/modules/git-panel/GitPanel';
import { selectGitRepository, useSelectedGitRepository } from '@/modules/git-panel/hooks/useSelectedGitRepository';

type GitRepositoriesPanelProps = {
  /**
   * The repositories on the strip, in strip order, already matched to registered projects by the
   * workspace's state provider — a path the app never registered has no database id for the git
   * routes to read, so it never arrives here.
   */
  repositories: GitRepository[];
  /**
   * The workspace's project path. It decides nothing about which repository shows — only whether a
   * changed file can open in Files, which browses that project and no other.
   */
  selectedProjectPath: string;
  isMobile: boolean;
  onFileOpen?: FileOpenHandler;
};

/**
 * Exported through the git-panel barrel; the project-workspace module renders it as the git tab.
 *
 * The tab's own strip of repositories decides what is on screen — never the workspace's session or
 * project, so changing either leaves the git tab on the repository it was showing.
 */
export default function GitRepositoriesPanel({
  repositories,
  selectedProjectPath,
  isMobile,
  onFileOpen,
}: GitRepositoriesPanelProps) {
  const selectedRepoPath = useSelectedGitRepository();

  // Built once per list rather than inline: `Tabs` re-measures its indicator whenever the array
  // it is handed changes, and a fresh one on every render is a measurement and a render apiece.
  const tabs = useMemo(
    () => repositories.map((repository) => ({ id: repository.fullPath, label: repository.displayName })),
    [repositories],
  );

  // A stored path that is no longer on the strip falls through to the first tab.
  const activeRepository = repositories.find((repository) => repository.fullPath === selectedRepoPath)
    ?? repositories[0]
    ?? null;

  if (!activeRepository) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          title="No repositories to show"
          message="None of the git tab's repositories is a registered project. Open each one as a project and it appears here."
        />
      </div>
    );
  }

  // Files browses the workspace's project, so a changed path can open there only when the
  // repository on screen IS that project — any other would open the wrong file, or none.
  const canOpenInFiles = selectedProjectPath === activeRepository.fullPath;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Equal shares, so the four repositories sit evenly on any width and a phone shortens a
          long name with an ellipsis instead of pushing the last tab off the screen. */}
      <div className="flex-none border-b border-border px-2 pt-2 sm:px-4">
        <Tabs
          tabs={tabs}
          active={activeRepository.fullPath}
          onChange={selectGitRepository}
          ariaLabel="Repositories"
          variant="underline"
          equal
        />
      </div>
      <div className="min-h-0 flex-1">
        {/* Keyed on the repository so every read, open diff and view choice belongs to ONE of
            them and none outlives a switch to the next tab. */}
        <GitPanel
          key={activeRepository.projectId}
          repository={activeRepository}
          isMobile={isMobile}
          onFileOpen={canOpenInFiles ? onFileOpen : undefined}
        />
      </div>
    </div>
  );
}
