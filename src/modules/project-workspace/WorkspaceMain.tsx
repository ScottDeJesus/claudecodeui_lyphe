import React, { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInterface, type ChatExportSurface, type TokenUsageSurface } from '@/modules/chat';
import { FileManager } from '@/modules/file-manager';
import { StandaloneShell } from '@/modules/standalone-shell';
import { GitPanel } from '@/modules/git-panel';
import { PluginTabContent } from '@/modules/plugins';
import { BrowserUsePanel } from '@/modules/browser-use';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { MemoryIntakePanel } from '@/modules/memory-intake';
import { RunnerPanel } from '@/modules/plan-runner';
import { TaskMasterPanel, useTaskMasterProjectSync } from '@/modules/task-master';
import type { AppTab, Project, ProjectSession, SessionEstablishedContext, SessionNavigationOptions, SettingsMainTab } from '@/shared/types';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useFileOpenResolver } from '@/modules/project-workspace/hooks/useFileOpenResolver';
import { useWorkspaceTabGates } from '@/modules/project-workspace/hooks/useWorkspaceTabGates';
import WorkspaceHeader from '@/modules/project-workspace/WorkspaceHeader';
import WorkspaceStateView from '@/modules/project-workspace/WorkspaceStateView';
import WorkspaceErrorBoundary from '@/modules/project-workspace/WorkspaceErrorBoundary';

type WorkspaceMainProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  externalMessageUpdate: number;
  newSessionTrigger: number;
};

/** Rendered by ProjectMainRegion to show the selected project's active tab: chat, files, shell, git, tasks, browser or a plugin. */
function WorkspaceMain({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
}: WorkspaceMainProps) {
  const { t } = useTranslation();
  const preferences = useUiPreferences();
  const { showRawParameters, showThinking, showWork, sendByCtrlEnter } = preferences;

  // The same reading the sidebar's tab strip takes — one hook, so the strip and these panes can
  // never disagree about which tabs exist.
  const {
    shouldShowTasksTab,
    shouldShowBrowserTab,
    shouldShowShellTab,
    shouldShowMemoryTab,
    shouldShowRunnerTab,
    preferencesSettled,
  } = useWorkspaceTabGates(activeTab);

  useTaskMasterProjectSync(selectedProject);

  // The one path-opening capability three caller families share — the chat's Edit/Write cards and
  // bare links, the git panel's changed-file rows, and the tree beside the file manager. It lives
  // here because opening a path is a WORKSPACE act: the Files tab has to come forward for the pane
  // that shows it. Asking for the SAME path twice is a second request because the first was retired
  // to `null` on its way through — the wrapper's identity is the signal, and it is always fresh.
  //
  // `line` is optional and only `openFileAt` below ever sets it. `nonce` rides ALONG the wrapper
  // identity rather than instead of it: the wrapper is retired at the workspace, but the file
  // manager's own selection is not, so re-asking for the same path at the same line needs a value
  // that CHANGES for the selection to notice and re-scroll.
  const [openRequest, setOpenRequest] = useState<{ path: string; line?: number; nonce: number } | null>(null);

  // The counter behind that nonce. A ref, not state: nothing renders from it, and bumping it must
  // not be a second render on top of the request it is part of.
  const openRequestNonce = useRef(0);

  // The chat's token count, lifted so the mobile header can carry it (the composer hides its
  // copy below `md`). Chat-tab only: the number is that chat's, and the header stays a strip of
  // navigation on every other tab.
  const [tokenUsageSurface, setTokenUsageSurface] = useState<TokenUsageSurface | null>(null);
  // The export button travels the same way and for the same reason: on a phone it used to float
  // over the transcript it was exporting.
  const [chatExportSurface, setChatExportSurface] = useState<ChatExportSurface | null>(null);

  const handleFileOpen = useCallback((filePath: string) => {
    openRequestNonce.current += 1;
    setOpenRequest({ path: filePath, nonce: openRequestNonce.current });
    setActiveTab('files');
  }, [setActiveTab]);

  // The same act, at a line. A SECOND function rather than a second parameter on `handleFileOpen`:
  // that one is a `FileOpenHandler`, whose second parameter is `diffInfo` and is already carrying a
  // real diff object from `ToolRenderer` — so a line threaded through there would arrive as a line
  // on every Edit/Write card in the chat. Its three existing consumers are untouched by this.
  const openFileAt = useCallback((filePath: string, line?: number) => {
    openRequestNonce.current += 1;
    setOpenRequest({ path: filePath, line, nonce: openRequestNonce.current });
    setActiveTab('files');
  }, [setActiveTab]);

  // Retired the moment the file manager has acted on it. The request is an EVENT, and leaving it
  // standing turns it into a standing instruction: the manager is mounted only while the Files tab
  // is showing, so an unretired request is replayed on the next visit.
  const handleRequestHandled = useCallback(() => {
    setOpenRequest(null);
  }, []);

  // Resolves bare/partial file references (e.g. links inside chat messages) to real project files
  // before opening them in the file manager — at the line the reference named, when it named one.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, openFileAt);

  // The three effects below snap a PREFERENCE-gated tab back to chat when its gate turns off:
  // tasks, shell and browser vanish the moment a person switches them off, and leaving the
  // workspace pointed at a tab that is no longer on the bar leaves an empty pane. There is no
  // fourth effect for the Memory tab, and adding one would fight the design: that tab is
  // DATA-gated, so its gate is written to HOLD while it is the selected tab
  // (`useWorkspaceTabGates`) and filing the last pending memory empties the panel instead of
  // taking the tab away mid-act. The Runner tab is the SECOND DATA-gated tab and takes the same
  // policy — no fifth effect for it either, for exactly the same reason: a run ending under
  // someone reading its phases must leave them where they are standing. Two kinds of tab, two policies, each living in the layer that
  // owns the act — the gate rule in the hook that decides a tab exists, the navigation here,
  // where `setActiveTab` is.
  //
  // The two preference-gated snap-backs wait for `preferencesSettled`, and it is a dependency
  // rather than an early return so the flag flipping re-runs them on its own — the reducer
  // returns the SAME state object when the server's value equals the default, so a value that
  // never moved would otherwise never re-trigger the check.
  //
  // Why they wait at all: `activeTab` is restored from localStorage on mount, and these effects
  // rewrite it. Read off a cold mirror a preference is the DEFAULT, not the user's — so an
  // unguarded snap-back moves someone off a tab their own saved preference puts on the bar,
  // and overwrites the stored tab on the way past. Once settled they still run on mount, which
  // is what keeps a genuinely hidden tab from leaving an empty pane behind.
  useEffect(() => {
    if (preferencesSettled && !shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [preferencesSettled, shouldShowTasksTab, activeTab, setActiveTab]);

  useEffect(() => {
    if (preferencesSettled && !shouldShowShellTab && activeTab === 'shell') {
      setActiveTab('chat');
    }
  }, [preferencesSettled, shouldShowShellTab, activeTab, setActiveTab]);

  // The browser gate is the same hazard from a DIFFERENT store: `useBrowserUseEnabled` starts
  // false and turns true after its own fetch, so `preferencesSettled` says nothing about it and
  // gating on that flag here would be a borrowed signal. Pre-existing; noted, not papered over.
  useEffect(() => {
    if (!shouldShowBrowserTab && activeTab === 'browser') {
      setActiveTab('chat');
    }
  }, [shouldShowBrowserTab, activeTab, setActiveTab]);

  // Stable so React.memo(ChatInterface) can bail out: an inline arrow here made every
  // WorkspaceMain render re-render the whole chat tree — and this component re-renders on
  // every `openRequest` change and on each of the two preference-gated tab effects settling.
  //
  // The chat is offered this (below, as `onShowAllTasks`) on `shouldShowTasksTab`, not on the
  // bare `tasksEnabled` it once read: with tasks enabled but task-master NOT installed the Tasks
  // tab is off the bar and its pane is never mounted, so the old predicate handed the reader a
  // link to a tab the snap-back effect above returns straight to chat. One capability, one
  // predicate.
  const showAllTasks = useCallback(() => {
    setActiveTab('tasks');
  }, [setActiveTab]);

  // Both palette ops end in the same place — the file manager's preview; they differ only in what
  // they are given. `openFile` carries a real path off the file source, `openFileReference` a bare
  // reference out of a chat message, which is why that one goes through the resolver first.
  //
  // Stable arguments keep usePaletteOpsRegister's effect from tearing down and
  // rewriting the whole palette registry on every render.
  usePaletteOpsRegister({ openFile: handleFileOpen, openFileReference: resolvedFileOpen });

  if (isLoading) {
    return <WorkspaceStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <WorkspaceStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        newSessionLabel={t('mainContent.newSession')}
        tokenUsage={activeTab === 'chat' ? tokenUsageSurface : null}
        chatExport={activeTab === 'chat' ? chatExportSurface : null}
      />

      <div className="flex min-h-0 min-w-[200px] flex-1 flex-col overflow-hidden">
        <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
          <WorkspaceErrorBoundary showDetails>
            <ChatInterface
              isActive={activeTab === 'chat'}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              onFileOpen={handleFileOpen}
              onNavigateToSession={onNavigateToSession}
              onSessionEstablished={onSessionEstablished}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              showWork={showWork}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              newSessionTrigger={newSessionTrigger}
              onTokenUsageSurface={setTokenUsageSurface}
              onChatExportSurface={setChatExportSurface}
              onShowAllTasks={shouldShowTasksTab ? showAllTasks : null}
            />
          </WorkspaceErrorBoundary>
        </div>

        {activeTab === 'files' && (
          <div className="h-full overflow-hidden">
            <FileManager
              selectedProject={selectedProject}
              openRequest={openRequest}
              onRequestHandled={handleRequestHandled}
              onFileOpen={handleFileOpen}
            />
          </div>
        )}

        {shouldShowShellTab && activeTab === 'shell' && (
          <div className="h-full w-full overflow-hidden">
            <StandaloneShell
              project={selectedProject}
              session={selectedSession}
              showHeader={false}
              isActive={activeTab === 'shell'}
            />
          </div>
        )}

        {activeTab === 'git' && (
          <div className="h-full overflow-hidden">
            <GitPanel
              selectedProject={selectedProject}
              isMobile={isMobile}
              onFileOpen={handleFileOpen}
            />
          </div>
        )}

        {shouldShowTasksTab && <TaskMasterPanel isVisible={activeTab === 'tasks'} />}

        {shouldShowBrowserTab && activeTab === 'browser' && (
          <div className="h-full overflow-hidden">
            <BrowserUsePanel isVisible={activeTab === 'browser'} onShowSettings={onShowSettings} />
          </div>
        )}

        {shouldShowMemoryTab && activeTab === 'memory' && (
          <div className="h-full overflow-hidden">
            <MemoryIntakePanel />
          </div>
        )}

        {shouldShowRunnerTab && activeTab === 'runner' && (
          <div className="h-full overflow-hidden">
            <RunnerPanel />
          </div>
        )}

        {activeTab.startsWith('plugin:') && (
          <div className="h-full overflow-hidden">
            <PluginTabContent
              pluginName={activeTab.replace('plugin:', '')}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(WorkspaceMain);
