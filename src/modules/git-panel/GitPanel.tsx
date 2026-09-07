import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Spinner, Tabs } from '@/shared/ui';
import type { FileOpenHandler, GitPanelView, Project } from '@/shared/types';
import { useGitReadController } from '@/modules/git-panel/hooks/useGitReadController';
import { useGitDelegation } from '@/modules/git-panel/hooks/git-delegation';
import { describeUpstreamPosition } from '@/modules/git-panel/utils/gitPanelUtils';
import ChangesReadOnlyView from '@/modules/git-panel/changes/ChangesReadOnlyView';
import GitDelegationCard from '@/modules/git-panel/GitDelegationCard';
import GitRepositoryErrorState from '@/modules/git-panel/GitRepositoryErrorState';
import GitStatusHeader from '@/modules/git-panel/GitStatusHeader';
import HistoryView from '@/modules/git-panel/history/HistoryView';

const GIT_TABS: { id: GitPanelView; label: string }[] = [
  { id: 'changes', label: 'Changes' },
  { id: 'history', label: 'History' },
];

const DEFAULT_BRANCH = 'main';

type GitPanelProps = {
  selectedProject: Project | null;
  isMobile?: boolean;
  onFileOpen?: FileOpenHandler;
};

/**
 * Exported through the git-panel barrel; the project-workspace module renders it as the
 * source-control tab.
 *
 * The panel READS. It shows which branch this is, how it stands against the upstream, what
 * is waiting to be pushed and what each change looks like — and it has no verb for any of
 * it. Committing and pushing happen in the agent run this panel delegates to, so the one
 * place a person can start a git write is a conversation, not a button here.
 */
export default function GitPanel({ selectedProject, isMobile = false, onFileOpen }: GitPanelProps) {
  // Which of the two views is on screen. Nothing else depends on it — both read the same
  // controller — so it lives here rather than in the controller.
  const [activeView, setActiveView] = useState<GitPanelView>('changes');

  const navigate = useNavigate();

  // ONE controller for the whole panel. The lists read its payloads and the delegation card
  // takes the controller itself, so the answer a finished run reports and the rows on screen
  // come from the same refreshed read and cannot contradict each other.
  const controller = useGitReadController(selectedProject);
  const { status, remoteStatus, commits, loading, error, diffFor, refresh } = controller;

  // Decided ONCE, here, from the server's own flags, and handed to the header and the Changes
  // view together: the one shape in which the badge and the body cannot disagree about
  // whether there is an upstream to be ahead of.
  const upstream = describeUpstreamPosition(remoteStatus, status);

  // The delegation's whole view of the project: the id it belongs to, and the directory the
  // conversation is started in. Keyed on the two STRINGS rather than the project object, which
  // arrives with a new identity on renders that changed nothing about either — and null rather
  // than an empty path, because a conversation cannot be started in a directory we cannot name.
  const projectPath = selectedProject?.fullPath || selectedProject?.path || null;
  const projectId = selectedProject?.projectId ?? null;
  const delegationProject = useMemo(
    () => (projectId && projectPath ? { id: projectId, path: projectPath } : null),
    [projectId, projectPath],
  );
  const delegation = useGitDelegation(delegationProject, controller);

  const openConversation = useCallback(
    (sessionId: string) => navigate(`/session/${sessionId}`),
    [navigate],
  );

  // Built once and rendered from two places: below the lists, and below the repository error
  // state, where it is the only thing that still knows a run happened.
  const delegationSlot = (
    <GitDelegationCard
      state={delegation.state}
      status={status}
      upstream={upstream}
      starting={delegation.starting}
      notice={delegation.notice}
      onStart={() => void delegation.start()}
      onDismiss={delegation.dismiss}
      onOpenConversation={openConversation}
    />
  );

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Select a project to view source control</p>
      </div>
    );
  }

  // Nothing is drawn until the first read lands. The header would otherwise have to name a
  // branch it has not been told yet, and the only name available to guess with is "main" —
  // which would be a value standing in for an unknown, on the one screen whose whole job is
  // to report what git actually says.
  if (loading && !status) {
    return (
      <section aria-label="Source control" className="flex h-full flex-col bg-background">
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="Reading this project's git state" />
        </div>
        {/* A run in flight is not waiting on this read, and coming back to its project starts one:
            the card keeps narrating through it rather than being replaced by a spinner. */}
        {delegation.state.phase !== 'idle' && (
          <div className="flex-none border-t border-border p-4">{delegationSlot}</div>
        )}
      </section>
    );
  }

  // Without a repository there is no branch and no upstream, so the header would be three
  // empty tokens above an explanation. The empty state owns the panel instead — but not the run:
  // a read that fails AFTER a press is exactly when the outcome is worth having, and the card
  // holds the only link to the conversation it happened in. It joins an idle card's silence.
  if (error) {
    return (
      <section aria-label="Source control" className="flex h-full flex-col bg-background">
        <GitRepositoryErrorState
          error={error}
          details={status?.details}
          notGitRepository={status?.notGitRepository}
        />
        {delegation.state.phase !== 'idle' && (
          <div className="flex-none border-t border-border p-4">{delegationSlot}</div>
        )}
      </section>
    );
  }

  return (
    // A labelled region: the panel is a landmark of its own inside the workspace, and it is
    // also the exact subtree a verification run scans for a write control that grew back.
    <section aria-label="Source control" className="flex h-full flex-col bg-background">
      <GitStatusHeader
        branch={status?.branch || DEFAULT_BRANCH}
        upstream={upstream}
        loading={loading}
        onRefresh={() => void refresh()}
      />

      <div className="flex-none px-4 pb-3">
        <Tabs
          tabs={GIT_TABS}
          active={activeView}
          // Narrowed rather than cast: Tabs hands back a plain string, and the two ids this
          // panel has are the only two it can mean.
          onChange={(id) => setActiveView(id === 'history' ? 'history' : 'changes')}
          ariaLabel="Source control views"
        />
      </div>

      {activeView === 'changes' && (
        <ChangesReadOnlyView
          key={selectedProject.fullPath}
          status={status}
          commits={commits}
          upstream={upstream}
          isMobile={isMobile}
          diffFor={diffFor}
          onFileOpen={onFileOpen}
        />
      )}

      {activeView === 'history' && (
        <HistoryView
          // Keyed for the same reason the sibling above is: the per-row diffs this view opens
          // belong to ONE repository, and without a key they would outlive a project change —
          // an in-flight read for the old project resolving into the new one's map.
          key={selectedProject.projectId}
          isMobile={isMobile}
          commits={commits}
          projectId={selectedProject.projectId}
        />
      )}

      {/* The delegation slot, and the panel's only verb. It sits outside the tabs because it
          speaks for the repository rather than for either list, and it POSITIONS the card here
          rather than the card positioning itself. */}
      <div className="flex-none border-t border-border p-4">{delegationSlot}</div>
    </section>
  );
}
