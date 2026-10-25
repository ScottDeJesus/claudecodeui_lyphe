import React, { Suspense, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInterface, type ChatExportSurface, type TokenUsageSurface } from '@/modules/chat';
import { ChatGutterLayout } from '@/modules/chat-gutters';
import { ChatHostSlot, useChatHost } from '@/modules/chat-host';
import { FilesView } from '@/modules/file-manager';
import { StandaloneShell } from '@/modules/standalone-shell';
import { GitRepositoriesPanel } from '@/modules/git-panel';
import { PluginTabContent } from '@/modules/plugins';
import { BrowserUsePanel } from '@/modules/browser-use';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { InboxPanel } from '@/modules/inbox';
import { KanbanPanel } from '@/modules/kanban';
import { RoadmapTab } from '@/modules/roadmap';
import { ApiPanel } from '@/modules/api-tab';
import { CerberusPanel } from '@/modules/cerberus';
import { TaskMasterPanel, useTaskMasterProjectSync } from '@/modules/task-master';
import { UniversePanel } from '@/modules/universe';
import { SchedulesPanel } from '@/modules/schedules';
import { NotesPanel } from '@/modules/notes';
import type { AppTab, FileOpenRequest, FilesRoot, GitRepository, Project, ProjectChoice, ProjectSession, SessionEstablishedContext, SessionNavigationOptions, SettingsMainTab } from '@/shared/types';
import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { absolutePathIn } from '@/shared/utils';
import { useFileOpenResolver } from '@/modules/project-workspace/hooks/useFileOpenResolver';
import { useRunnerLanding } from '@/modules/project-workspace/hooks/useRunnerLanding';
import { useWorkspaceViews } from '@/modules/project-workspace/hooks/useWorkspaceViews';
import WorkspaceHeader from '@/modules/project-workspace/WorkspaceHeader';
import WorkspaceStateView from '@/modules/project-workspace/WorkspaceStateView';
import WorkspaceErrorBoundary from '@/modules/project-workspace/WorkspaceErrorBoundary';

type WorkspaceMainProps = {
  /** The git tab's repositories, in strip order — memoised upstream, so its identity is stable. */
  gitRepositories: GitRepository[];
  /** The Files view's roots, in strip order — memoised upstream, so its identity is stable. */
  filesRoots: FilesRoot[];
  /** The projects a new chat can start in, and how to switch to one. */
  projectChoices: ProjectChoice[];
  onSelectProject: (projectId: string) => void;
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
  /** Re-reads the projects list; the Files view waits on it after registering a folder the app had never opened. */
  onProjectsChanged: () => Promise<void>;
};

function reloadPage() {
  window.location.reload();
}

/** The largest file the chat previews inline, and how many reads — and bytes — it holds at once. */
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_READS = 64;
const MAX_PREVIEW_CACHE_BYTES = 150 * 1024 * 1024;

/**
 * A response's body, refused once it passes `cap` bytes. For a response with no `Content-Length` —
 * a compressing proxy strips it — where the size is only known by counting what arrives.
 */
async function readCapped(response: Response, cap: number): Promise<Blob | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: BlobPart[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
}

/**
 * Rendered by ProjectMainRegion to show the active view's pane, with a project selected or not. Nothing in the
 * rail is project-scoped, so the house views (Roadmap, Kanban, Inbox, Browser and the rest) draw on their own;
 * only the panes that read the open project — Chat, Shell, Tasks and a plugin's — draw the
 * choose-a-project body when none is selected. Files and Git browse their own roots.
 */
function WorkspaceMain({
  gitRepositories,
  filesRoots,
  projectChoices,
  onSelectProject,
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
  onProjectsChanged,
}: WorkspaceMainProps) {
  const { t } = useTranslation();
  const preferences = useUiPreferences();
  const { showRawParameters, showThinking, showWork, showCompactSummary, sendByCtrlEnter } = preferences;

  // The views list, its two preference gates and their settled flag, off the one hook the rail and the palette
  // read the list from — so these panes and the rail's buttons can never disagree about which views exist.
  const { views, shouldShowShellTab, shouldShowTasksTab, preferencesSettled } = useWorkspaceViews();

  // The two landings onto the Roadmap tab: `?runner=<plan>` brings it forward on its In flight face with that plan's card in view,
  // and `?roadmap=<name>` on its Roadmap face with that roadmap selected.
  const { revealPlan, clearReveal, openRoadmap, clearOpenRoadmap } = useRunnerLanding({ activeTab, setActiveTab });

  useTaskMasterProjectSync(selectedProject);

  // While the chat floats it is live outside this tab: it counts as the active chat whichever tab is open,
  // and the gutters stand down — the floating chat draws its own pinned subagent strip.
  const floating = useChatHost().placement !== 'home';

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
  const [openRequest, setOpenRequest] = useState<FileOpenRequest | null>(null);

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

  // The request always carries an ABSOLUTE path, because Files picks the root that holds it. A relative
  // one — a chat card that named a file by its project path — is the open project's, and joins its folder.
  const projectFolder = selectedProject?.fullPath;
  const handleFileOpen = useCallback((filePath: string) => {
    openRequestNonce.current += 1;
    setOpenRequest({ path: absolutePathIn(projectFolder, filePath), nonce: openRequestNonce.current });
    setActiveTab('files');
  }, [projectFolder, setActiveTab]);

  // The same act, at a line. A SECOND function rather than a second parameter on `handleFileOpen`:
  // that one is a `FileOpenHandler`, whose second parameter is `diffInfo` and is already carrying a
  // real diff object from `ToolRenderer` — so a line threaded through there would arrive as a line
  // on every Edit/Write card in the chat. Its three existing consumers are untouched by this.
  const openFileAt = useCallback((filePath: string, line?: number) => {
    openRequestNonce.current += 1;
    setOpenRequest({ path: absolutePathIn(projectFolder, filePath), line, nonce: openRequestNonce.current });
    setActiveTab('files');
  }, [projectFolder, setActiveTab]);

  // Retired the moment the file manager has acted on it. The request is an EVENT, and leaving it
  // standing turns it into a standing instruction: the manager is mounted only while the Files tab
  // is showing, so an unretired request is replayed on the next visit.
  const handleRequestHandled = useCallback(() => {
    setOpenRequest(null);
  }, []);

  // Resolves bare/partial file references (e.g. links inside chat messages) to real project files
  // before opening them in the file manager — at the line the reference named, when it named one.
  const { open: resolvedFileOpen, resolve: resolveFileReference } = useFileOpenResolver(selectedProject, openFileAt);

  // The chat's file previews read their bytes through the SAME resolver a chip click opens through,
  // so the preview under a chip and the file the chip opens are one file — except that a preview never
  // takes the resolver's filename-only guess: a chip that opens a same-named file is noticed on the
  // click, a preview of it is presented as the file the author meant.
  //
  // One read per project, path and SCOPE — the reply that names the file (`previewScope.ts`). A row
  // unmounting outside its band reuses its reply's read; a later reply naming the same path reads the
  // file again, so a screenshot overwritten between two replies shows each reply the bytes its chip
  // opens. A read that found nothing is not kept. Bounded in entries and in bytes held — a read counts
  // its declared size from the moment its headers arrive — and each file in its size: over the cap it
  // is refused on `Content-Length`, or, where a proxy stripped that header, part-way through its body.
  const projectId = selectedProject?.projectId;
  const previewReadsRef = useRef(new Map<string, { read: Promise<Blob | null>; bytes: number }>());
  const readFileReference = useCallback((filePath: string, scope: string | null): Promise<Blob | null> => {
    if (!projectId) return Promise.resolve(null);
    const reads = previewReadsRef.current;
    // A row with no scope is read and not kept: a key per mount would never be asked for again, and
    // each would hold a slot and its bytes until evicted.
    const key = scope === null ? null : `${projectId}\u0000${scope}\u0000${filePath}`;
    const held = key === null ? undefined : reads.get(key);
    if (held) return held.read;

    // Oldest out first (a Map iterates in insertion order), until both bounds hold.
    const evict = () => {
      let heldBytes = 0;
      for (const item of reads.values()) heldBytes += item.bytes;
      while (reads.size > MAX_PREVIEW_READS || heldBytes > MAX_PREVIEW_CACHE_BYTES) {
        const oldest = reads.entries().next().value as [string, { bytes: number }] | undefined;
        if (!oldest) break;
        reads.delete(oldest[0]);
        heldBytes -= oldest[1].bytes;
      }
    };

    const entry = { read: Promise.resolve<Blob | null>(null), bytes: 0 };
    entry.read = (async () => {
      try {
        const response = await api.readFileBlob(projectId, await resolveFileReference(filePath, { allowBasename: false }));
        if (!response.ok) {
          void response.body?.cancel();
          return null;
        }
        const declared = response.headers.get('content-length');
        if (declared === null) return await readCapped(response, MAX_PREVIEW_BYTES);
        const size = Number(declared);
        if (!(size <= MAX_PREVIEW_BYTES)) {
          void response.body?.cancel();
          return null;
        }
        entry.bytes = size;
        evict();
        return await response.blob();
      } catch {
        return null;
      }
    })();
    if (key === null) return entry.read;
    reads.set(key, entry);
    void entry.read.then((blob) => {
      if (!blob) {
        if (reads.get(key) === entry) reads.delete(key);
        return;
      }
      entry.bytes = blob.size;
      evict();
    });
    return entry.read;
  }, [projectId, resolveFileReference]);

  // The two effects below snap a PREFERENCE-gated view back to chat when its gate turns off: tasks and
  // shell vanish from the rail the moment a person switches them off, and leaving the workspace pointed
  // at a view that is no longer there leaves an empty pane.
  //
  // Both wait for `preferencesSettled`, and it is a dependency rather than an early return so the flag
  // flipping re-runs them on its own — the reducer returns the SAME state object when the server's value
  // equals the default, so a value that never moved would otherwise never re-trigger the check.
  //
  // Why they wait at all: `activeTab` is restored from localStorage on mount, and these effects
  // rewrite it. Read off a cold mirror a preference is the DEFAULT, not the user's — so an
  // unguarded snap-back moves someone off a view their own saved preference puts on the rail, and
  // overwrites the stored tab on the way past. Once settled they still run on mount, which is what
  // keeps a genuinely hidden view from leaving an empty pane behind.
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
  usePaletteOpsRegister({ openFile: handleFileOpen, openFileReference: resolvedFileOpen, readFileReference });

  if (isLoading) {
    return <WorkspaceStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  // The body a pane that reads the open project draws when none is selected. Built once; WorkspaceMain's own
  // header stands above it, so it brings none of its own.
  const chooseProjectBody = <WorkspaceStateView mode="empty" showHeader={false} isMobile={isMobile} onMenuClick={onMenuClick} />;

  // Chat names the open chat in the phone header; every other view names itself. An id the list does not
  // hold (a plugin's, while the plugin list loads or after the plugin is gone) has no name to give, so there
  // the header names the chat.
  const viewLabel = activeTab === 'chat' ? null : (views.find((view) => view.id === activeTab)?.label ?? null);

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        viewLabel={viewLabel}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        newSessionLabel={t('mainContent.newSession')}
        tokenUsage={activeTab === 'chat' ? tokenUsageSurface : null}
        chatExport={activeTab === 'chat' ? chatExportSurface : null}
      />

      <div className="flex min-h-0 min-w-[200px] flex-1 flex-col overflow-hidden">
        <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
          {selectedProject ? (
            <WorkspaceErrorBoundary showDetails>
              {/* The gutters wrap the chat from OUTSIDE, so the transcript and the composer keep
                  their own column untouched. The boundary is handed down rather than imported
                  there: each widget body gets its own, and a crashing widget cannot blank the
                  chat tab. */}
              <ChatGutterLayout enabled={!isMobile && !floating} sessionId={selectedSession?.id ?? null}
                boundary={WorkspaceErrorBoundary}>
                <ChatHostSlot sessionId={selectedSession?.id ?? null} showing={activeTab === 'chat'}>
                  <ChatInterface
                    isActive={activeTab === 'chat' || floating}
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
                    showCompactSummary={showCompactSummary}
                    projectChoices={projectChoices}
                    onSelectProject={onSelectProject}
                    sendByCtrlEnter={sendByCtrlEnter}
                    externalMessageUpdate={externalMessageUpdate}
                    newSessionTrigger={newSessionTrigger}
                    onTokenUsageSurface={setTokenUsageSurface}
                    onChatExportSurface={setChatExportSurface}
                    onShowAllTasks={shouldShowTasksTab ? showAllTasks : null}
                  />
                </ChatHostSlot>
              </ChatGutterLayout>
            </WorkspaceErrorBoundary>
          ) : chooseProjectBody}
        </div>

        {shouldShowTasksTab && (selectedProject
          ? <TaskMasterPanel isVisible={activeTab === 'tasks'} />
          : activeTab === 'tasks' && <div className="h-full overflow-hidden">{chooseProjectBody}</div>)}

        {/* Every panel below is lazy (its module's barrel exports it that way), so it loads on its
            tab's first open. One boundary for them, and none around the chat above: a panel still
            loading never blanks the conversation beside it, and a panel whose code fails to load
            fails inside this pane instead of taking the whole app down. */}
        {/* Keyed to the tab, so one panel's failure never paints over the next tab picked. Retry is
            a reload: React.lazy keeps a failed load's error for the life of the page, so re-rendering
            would only throw it again. */}
        <WorkspaceErrorBoundary
          message="This tab could not load. Reloading the page usually fixes it."
          resetKeys={[activeTab]}
          onRetry={reloadPage}
        >
        <Suspense fallback={null}>
          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FilesView
                roots={filesRoots}
                projectChoices={projectChoices}
                openRequest={openRequest}
                onRequestHandled={handleRequestHandled}
                onFileOpen={handleFileOpen}
                onProjectsChanged={onProjectsChanged}
              />
            </div>
          )}

          {shouldShowShellTab && activeTab === 'shell' && (
            <div className="h-full w-full overflow-hidden">
              {selectedProject ? (
                <StandaloneShell
                  project={selectedProject}
                  session={selectedSession}
                  showHeader={false}
                  isActive={activeTab === 'shell'}
                />
              ) : chooseProjectBody}
            </div>
          )}

          {activeTab === 'git' && (
            <div className="h-full overflow-hidden">
              <GitRepositoriesPanel
                repositories={gitRepositories}
                isMobile={isMobile}
                onFileOpen={handleFileOpen}
              />
            </div>
          )}

          {activeTab === 'browser' && (
            <div className="h-full overflow-hidden">
              <BrowserUsePanel isVisible={activeTab === 'browser'} onShowSettings={onShowSettings} />
            </div>
          )}

          {activeTab === 'runner' && (
            <div className="h-full overflow-hidden">
              <RoadmapTab
                revealPlan={revealPlan}
                onRevealed={clearReveal}
                openRoadmap={openRoadmap}
                onRoadmapOpened={clearOpenRoadmap}
              />
            </div>
          )}

          {/* No gate, like the board below: the tab is always on the strip. */}
          {activeTab === 'api' && (
            <div className="h-full overflow-hidden">
              <ApiPanel />
            </div>
          )}

          {/* No gate either, for the same reason: the fleet's health is a fact about the house whichever
              project is open, and a monitor that hid on a quiet day could never say "All quiet". */}
          {activeTab === 'cerberus' && (
            <div className="h-full overflow-hidden">
              <CerberusPanel projectChoices={projectChoices} />
            </div>
          )}

          {/* No gate: the board is always on the strip, the way chat, files and git are. It is also
              GLOBAL — the project it is handed is a first-run hint about which board to select, not
              a filter — so nothing here unmounts or refetches when the open project changes, and
              with no project open there is simply no hint. */}
          {activeTab === 'kanban' && (
            <div className="h-full overflow-hidden">
              <KanbanPanel projectId={selectedProject?.projectId ?? null} />
            </div>
          )}

          {/* No gate either, for the same reason: the sky is global, not a view of the open project,
              so nothing here unmounts or refetches when the selected project changes. */}
          {activeTab === 'universe' && (
            <div className="h-full overflow-hidden">
              <UniversePanel />
            </div>
          )}

          {/* No gate, for the same reason as the board and the sky: the registry describes the
              box itself, so nothing here depends on which project is open. */}
          {activeTab === 'schedules' && (
            <div className="h-full overflow-hidden">
              <SchedulesPanel />
            </div>
          )}

          {/* No gate, for the same reason again: the notes belong to the account and not to the
              project, so nothing here changes with the selection. */}
          {activeTab === 'notes' && (
            <div className="h-full overflow-hidden">
              <NotesPanel />
            </div>
          )}

          {/* No gate, for the same reason: what waits on the operator is the house's, not the open project's.
              Its three bodies are each a full-height panel with a scroller of its own, so the pane just gives it the room. */}
          {activeTab === 'inbox' && (
            <div className="h-full overflow-hidden">
              <InboxPanel />
            </div>
          )}

          {activeTab.startsWith('plugin:') && (
            <div className="h-full overflow-hidden">
              {selectedProject ? (
                <PluginTabContent
                  pluginName={activeTab.replace('plugin:', '')}
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                />
              ) : chooseProjectBody}
            </div>
          )}
        </Suspense>
        </WorkspaceErrorBoundary>
      </div>
    </div>
  );
}

export default React.memo(WorkspaceMain);
