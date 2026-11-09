import { memo, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, CheckSquare, Copy, Edit2, GitBranch, Loader2, MoreHorizontal, Pin, PinOff, Square, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Badge, buttonVariants, Dialog, DialogContent, DialogTitle, LLMProviderLogo, SignalLoop, Tooltip } from '@/shared/ui';
import { cn,copyTextToClipboard } from '@/shared/utils';
import { LLM_PROVIDER_LABELS, PAGE_ANCHOR } from '@/shared/constants';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider } from '@/shared/types';
import { api } from '@/shared/api';
import { useSessionForkingProviders } from '@/shared/hooks/useProviderCapabilities';
import { useCliVersion } from '@/shared/hooks/useCliVersion';
import { usePageAnchor } from '@/shared/context/PageAnchorsContext';
import { useAwaitingInputSessionIdSet, useSubagentRunningSessionIdSet } from '@/shared/context/SessionProtectionContext';
import { createSessionViewModel, formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import SidebarSessionMeta from '@/modules/sidebar/SidebarSessionMeta';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
  currentTime: Date;
  /** Resolved for this row, so a keystroke elsewhere does not invalidate it. */
  isEditing: boolean;
  renameDraft: string;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  /** Branches this session into an independent one; absent when its provider cannot. */
  onForkSession?: (session: SessionWithProvider) => void;
  /** This project's list is in bulk-selection mode: the row acts as a checkbox and hides its options. */
  isSelecting: boolean;
  /** Ticked for the pending bulk delete. Resolved by the list, which never ticks a running row. */
  isChecked: boolean;
  /** Takes the owning projectId so this memoized row binds itself without the list making a closure per row. */
  onToggleSessionSelected: (projectId: string, sessionId: string) => void;
  t: TFunction;
};

type CopyState = 'loading' | 'idle' | 'copying' | 'copied' | 'error';
/**
 * The mark beside a running session: a spinner while it works, a yellow dot while a question or
 * permission prompt waits on the user — the run is paused on them, not busy.
 *
 * Two of the three are NOT about this row's own run. The purple dot says a subagent launched from
 * this chat is still working, usually after the turn that launched it ended; the yellow dot says a
 * question is waiting, and a question outlives the turn that asked it too — a backgrounded agent's
 * completion wakes the CLI for a continuation turn no run is registered for. Either is drawn beside
 * the spinner when there is one, and on its own when there is not — including on the selected row,
 * which is the row a reader is most likely to be watching.
 */
function SessionRunIndicator({
  isProcessing,
  awaitingInput,
  subagentsRunning,
  t,
}: {
  isProcessing: boolean;
  awaitingInput: boolean;
  subagentsRunning: boolean;
  t: TFunction;
}) {
  const label = t('simpleList.awaitingInput');
  return (
    <>
      {(isProcessing || awaitingInput) && (awaitingInput ? (
        <Tooltip content={label} position="top">
          <span
            role="status"
            aria-label={label}
            className="vv-pulse flex h-5 w-5 items-center justify-center"
          >
            {/* The same 8px disc as the simple list's unread dot, in the warning ink. */}
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn-ink" />
          </span>
        </Tooltip>
      ) : (
        <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
          <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
            <SignalLoop state="thinking" size={13} />
          </span>
        </Tooltip>
      ))}
      {subagentsRunning && (
        <Tooltip content={t('simpleList.subagentsRunning')} position="top">
          <span
            data-testid="session-subagents-running"
            role="status"
            aria-label={t('simpleList.subagentsRunning')}
            className="flex h-5 w-5 items-center justify-center"
          >
            {/* The pinned strip's own running mark, in its own ink. */}
            <SignalLoop state="working" signal="secondary" size={12} />
          </span>
        </Tooltip>
      )}
    </>
  );
}

/** Rendered by SidebarProjectSessions for one session row, including its rename, copy, fork, select and delete controls. */
function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  needsAttention,
  currentTime,
  isEditing,
  renameDraft,
  onRenameDraftChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  isSelecting,
  isChecked,
  onToggleSessionSelected,
  t,
}: SidebarSessionItemProps) {
  const isCompact = useCompactSidebar();
  // The whole row (both of its layouts) is an anchor a floating guide can point at while this chat is the one being read, drafted for or walked.
  const anchorRef = usePageAnchor(PAGE_ANCHOR.chatRow(session.id));
  const { installed: installedCliVersion, staleSessionIds, staleVersionOf } = useCliVersion();
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const compactSessionAge = formatCompactAge(sessionView.sessionTime, currentTime);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const [isMobileOptionsOpen, setIsMobileOptionsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [providerSessionId, setProviderSessionId] = useState<string | null>(null);
  const providerIdRequestRef = useRef(0);
  const isAwaitingInput = useAwaitingInputSessionIdSet().has(session.id);
  const isSubagentRunning = useSubagentRunningSessionIdSet().has(session.id);
  const showAttentionIndicator = needsAttention && !isSelected;
  const showRecentIndicator = !showAttentionIndicator && !isProcessing && sessionView.isActive;
  const providerLabel = LLM_PROVIDER_LABELS[session.__provider];

  // While editing, dismiss only when the user clicks outside the inline rename panel
  // (matches Escape / cancel-button behaviour). The mobile rename lives inside the
  // bottom sheet, which owns its own dismissal, so the listener stays off there.
  useEffect(() => {
    if (!isEditing || isMobileOptionsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = editingContainerRef.current;
      if (container && !container.contains(event.target as Node)) {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, isMobileOptionsOpen, onCancelEditingSession]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, renameDraft, session.__provider);
  };

  // Read from the backend capability matrix rather than branching on the
  // provider id here; the underlying request is cached module-side, so every
  // row in the sidebar shares one fetch.
  const forkableProviders = useSessionForkingProviders();
  const canForkThisSession = forkableProviders.has(session.__provider);

  const requestDeleteSession = () => {
    onDeleteSession(session.id, sessionView.sessionName);
  };

  // A running session cannot be deleted, so it cannot be ticked either; the row
  // still renders, locked, instead of disappearing from the list mid-selection.
  const isSelectable = isSelecting && !isProcessing;
  const toggleSelected = () => {
    onToggleSessionSelected(project.projectId, session.id);
  };
  // Space activates neither the desktop anchor nor the compact div, and Enter
  // only the anchor, so both keys are handled here and tick either row alike.
  const handleSelectionKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isSelectable || (event.key !== ' ' && event.key !== 'Enter')) {
      return;
    }
    event.preventDefault();
    toggleSelected();
  };
  const SelectionIcon = isChecked ? CheckSquare : Square;
  const selectionIcon = isSelecting ? (
    <SelectionIcon
      className={cn(
        'h-4 w-4 flex-shrink-0',
        isChecked ? 'text-primary' : 'text-muted-foreground',
        !isSelectable && 'opacity-40',
      )}
      aria-hidden="true"
    />
  ) : null;

  // A pinned chat is drawn first in its project and is never closed when it falls asleep. The server
  // answers a pin with a `session_upserted` carrying the new flag, which is how the mark and the
  // order change here — no local copy of the flag is kept.
  const isPinned = session.pinned === true;
  const togglePinned = async () => {
    try {
      const response = await api.setSessionPinned(session.id, !isPinned);
      if (!response.ok) throw new Error(`setSessionPinned answered HTTP ${response.status}`);
    } catch (error) {
      console.error('[SidebarSessionItem] Failed to pin or unpin the session:', error);
    }
  };

  const loadProviderSessionId = async () => {
    const requestId = ++providerIdRequestRef.current;
    setCopyState('loading');
    try {
      const response = await api.providerSessionId(session.id);
      const payload = await response.json();
      const loadedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof loadedSessionId !== 'string' || !loadedSessionId) {
        throw new Error('Provider session ID is unavailable');
      }

      if (requestId !== providerIdRequestRef.current) return;
      setProviderSessionId(loadedSessionId);
      setCopyState('idle');
    } catch {
      if (requestId !== providerIdRequestRef.current) return;
      setProviderSessionId(null);
      setCopyState('error');
    }
  };

  const resetCopyState = () => {
    providerIdRequestRef.current += 1;
    setCopyState('idle');
    setProviderSessionId(null);
  };

  const setOptionsOpen = (open: boolean) => {
    if (open) {
      setProviderSessionId(null);
      void loadProviderSessionId();
    } else {
      resetCopyState();
    }
  };

  const setMobileOptionsOpen = (open: boolean) => {
    setIsMobileOptionsOpen(open);
    setOptionsOpen(open);
    if (!open && isEditing) {
      onCancelEditingSession();
    }
  };

  const startMobileRename = () => {
    onStartEditingSession(project.projectId, session.id, sessionView.sessionName);
  };

  const saveMobileRename = () => {
    saveEditedSession();
    setMobileOptionsOpen(false);
  };

  const copyProviderSessionId = async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  };

  const handleCopyAction = () => {
    if (copyState === 'error' && !providerSessionId) {
      void loadProviderSessionId();
    } else {
      void copyProviderSessionId();
    }
  };

  const isCopyPending = copyState === 'loading' || copyState === 'copying';
  const CopyStateIcon = copyState === 'copied' ? Check : Copy;
  const copyLabel = copyState === 'loading'
    ? `Loading ${providerLabel} session ID…`
    : copyState === 'copied'
      ? `${providerLabel} session ID copied`
      : copyState === 'error'
        ? providerSessionId
          ? `Couldn't copy ${providerLabel} session ID`
          : `${providerLabel} session ID unavailable`
        : `Copy ${providerLabel} session ID`;

  return (
    <div ref={anchorRef} className="group relative">
      {(showAttentionIndicator || showRecentIndicator) && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <Tooltip
            content={showAttentionIndicator
              ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
              : t('tooltips.activeSessionIndicator')}
            position="right"
          >
            {/* A ● rather than a bare disc: the state has to survive greyscale and a reader who
                does not separate amber from green, so the mark carries it as well as the ink. */}
            <div
              role="status"
              aria-label={showAttentionIndicator
                ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
                : t('tooltips.activeSessionIndicator')}
              className={cn(
                'vv-pulse flex h-2.5 w-2.5 items-center justify-center text-[9px] leading-none',
                showAttentionIndicator ? 'text-warn-ink' : 'text-primary',
              )}
            >
              <span aria-hidden="true">●</span>
            </div>
          </Tooltip>
        </div>
      )}

      {isCompact && (
      <div>
        <div
          role={isSelecting ? 'checkbox' : undefined}
          aria-checked={isSelecting ? isChecked : undefined}
          aria-disabled={isSelecting && !isSelectable ? true : undefined}
          tabIndex={isSelecting ? 0 : undefined}
          className={cn(
            'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
            isSelected ? 'bg-primary/5 border-primary/20' : '',
            !isSelected && isProcessing
              ? 'border-border/60 bg-muted/20'
              : !isSelected && sessionView.isActive
              ? 'border-primary/30 bg-primary/5'
              : 'border-border/30',
            isChecked && 'border-primary/40 bg-primary/10',
          )}
          onClick={isSelecting ? (isSelectable ? toggleSelected : undefined) : selectMobileSession}
          onKeyDown={isSelecting ? handleSelectionKeyDown : undefined}
        >
          <div className="flex items-center gap-2">
            {selectionIcon}
            <div
              className={cn(
                'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <LLMProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div
                  className="min-w-0 flex-1 truncate text-sm font-normal text-foreground"
                  title={sessionView.sessionName}
                >
                  {sessionView.sessionName}
                </div>
                {isPinned ? (
                  <Pin
                    data-testid="session-pinned"
                    role="img"
                    aria-label={t('simpleList.pinned')}
                    className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                  />
                ) : null}
                {isProcessing || isAwaitingInput || isSubagentRunning ? (
                  <span className="ml-auto flex flex-shrink-0 items-center gap-1">
                    <SessionRunIndicator
                      isProcessing={isProcessing}
                      awaitingInput={isAwaitingInput}
                      subagentsRunning={isSubagentRunning}
                      t={t}
                    />
                  </span>
                ) : null}
              </div>
              <SidebarSessionMeta
                provider={session.__provider}
                messageCount={sessionView.messageCount}
                age={compactSessionAge}
                t={t}
              />
            </div>

            {!isSelecting && (
              <button
                type="button"
                aria-label={`Session options for ${sessionView.sessionName}`}
                aria-haspopup="dialog"
                aria-expanded={isMobileOptionsOpen}
                className="ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:scale-95"
                onClick={(event) => {
                  event.stopPropagation();
                  setMobileOptionsOpen(true);
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <Dialog open={isMobileOptionsOpen} onOpenChange={setMobileOptionsOpen}>
          <DialogContent
            aria-describedby="mobile-session-options-description"
            animationClassName="animate-bottom-sheet-content-show motion-reduce:animate-none"
            className="bottom-0 left-0 top-auto max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl border-x-0 border-b-0 px-4 pb-safe-area-inset-bottom pt-3"
          >
            <DialogTitle>Session options</DialogTitle>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />

            <div className="mb-4 flex items-center gap-3 px-1">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
                <LLMProviderLogo provider={session.__provider} className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={sessionView.sessionName}>
                  {sessionView.sessionName}
                </p>
                <p id="mobile-session-options-description" className="text-xs text-muted-foreground">
                  {providerLabel} session
                </p>
              </div>
            </div>

            {isEditing ? (
              <div className="mb-3 space-y-2">
                <label htmlFor={`mobile-session-rename-${session.id}`} className="block px-1 text-xs font-medium text-muted-foreground">
                  Session name
                </label>
                <input
                  id={`mobile-session-rename-${session.id}`}
                  type="text"
                  value={renameDraft}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveMobileRename();
                    }
                  }}
                  className="w-full rounded-xl border-2 border-primary/40 bg-background px-3 py-3 text-foreground shadow-sm focus:border-primary focus:outline-none"
                  autoFocus
                  autoComplete="off"
                  // 16px keeps iOS Safari from zooming the viewport on focus.
                  style={{ fontSize: '16px' }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveMobileRename}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
                  >
                    <Check className="h-5 w-5 flex-shrink-0" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEditingSession}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/35 px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-muted"
                  >
                    <X className="h-5 w-5 flex-shrink-0" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={startMobileRename}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
                >
                  <Edit2 className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Rename session</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyAction}
                  disabled={isCopyPending}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                    copyState === 'copied'
                      ? 'border-primary/30 bg-primary/5 text-accent-ink'
                      : copyState === 'error'
                        ? 'border-warn-ink/30 bg-warn-ink/10 text-warn-ink'
                        : 'border-border bg-muted/35 text-foreground active:bg-muted',
                  )}
                >
                  {isCopyPending ? (
                    <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
                  ) : (
                    <CopyStateIcon className="h-5 w-5 flex-shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{copyLabel}</span>
                    {copyState === 'error' && (
                      <span className="mt-0.5 block text-xs">Tap to try again.</span>
                    )}
                  </span>
                </button>

                {onForkSession && canForkThisSession && !isProcessing && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOptionsOpen(false);
                      onForkSession(session);
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
                  >
                    <GitBranch className="h-5 w-5 flex-shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">Fork session</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Continue from a copy, leaving this one untouched.
                      </span>
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setMobileOptionsOpen(false);
                    void togglePinned();
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
                >
                  {isPinned ? <PinOff className="h-5 w-5 flex-shrink-0" /> : <Pin className="h-5 w-5 flex-shrink-0" />}
                  <span className="text-sm font-medium">{isPinned ? t('simpleList.unpin') : t('simpleList.pin')}</span>
                </button>

                {!isProcessing && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOptionsOpen(false);
                      requestDeleteSession();
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-destructive transition-colors active:bg-destructive/10"
                  >
                    <Trash2 className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm font-medium">Close or delete session</span>
                  </button>
                )}
              </div>
            )}

            {!isEditing && (
              <button
                type="button"
                onClick={() => setMobileOptionsOpen(false)}
                className="mb-3 mt-2 min-h-11 w-full rounded-xl text-sm font-medium text-muted-foreground transition-colors active:bg-muted"
              >
                Cancel
              </button>
            )}
          </DialogContent>
        </Dialog>
      </div>
      )}

      {!isCompact && (
      <div>
        <a
          href={`/session/${session.id}`}
          role={isSelecting ? 'checkbox' : undefined}
          aria-checked={isSelecting ? isChecked : undefined}
          aria-disabled={isSelecting && !isSelectable ? true : undefined}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'h-auto w-full justify-start rounded-md border bg-card p-2 text-left font-normal transition-all duration-150',
            isSelecting ? 'pr-2' : 'pr-11',
            isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
            !isSelected && isProcessing
              ? 'border-border/60 bg-muted/20 hover:bg-muted/25'
              : !isSelected && sessionView.isActive
                ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                : 'hover:bg-accent/50',
            isChecked && 'border-primary/40 bg-primary/10',
          )}
          // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
          // native right-click menu use the href to open a new tab/window.
          // While selecting, every click ticks the row instead.
          onClick={(event) => {
            if (isSelecting) {
              event.preventDefault();
              if (isSelectable) {
                toggleSelected();
              }
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSessionSelect(session, project.projectId);
          }}
          onKeyDown={isSelecting ? handleSelectionKeyDown : undefined}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            {selectionIcon}
            <div
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <LLMProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div
                  className="min-w-0 flex-1 truncate text-sm font-normal text-foreground"
                  title={sessionView.sessionName}
                >
                  {sessionView.sessionName}
                </div>
                {isPinned ? (
                  <Pin
                    data-testid="session-pinned"
                    role="img"
                    aria-label={t('simpleList.pinned')}
                    className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                  />
                ) : null}
                {isProcessing || isAwaitingInput || isSubagentRunning ? (
                  <span
                    className={cn(
                      'ml-auto flex flex-shrink-0 items-center gap-1 transition-opacity duration-200',
                      isEditing ? 'opacity-0' : !isSelecting && 'group-hover:opacity-0',
                    )}
                  >
                    <SessionRunIndicator
                      isProcessing={isProcessing}
                      awaitingInput={isAwaitingInput}
                      subagentsRunning={isSubagentRunning}
                      t={t}
                    />
                  </span>
                ) : null}
              </div>
              <SidebarSessionMeta
                provider={session.__provider}
                messageCount={sessionView.messageCount}
                age={compactSessionAge}
                t={t}
              />
              {staleSessionIds.has(session.id) && (
                // Inert on purpose: the restart lives in this conversation's own banner, beside the sentence that explains what it does.
                <Badge tone="warn" className="mt-1 text-[11px]" title={`Open the conversation to restart it on Claude CLI ${installedCliVersion}`}>↻ On CLI {staleVersionOf(session.id)}</Badge>
              )}
            </div>
          </div>
        </a>

        <div
          ref={editingContainerRef}
          // The options belong to the ordinary row; a selecting row is a checkbox and carries none.
          className={cn(
            'absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 opacity-100 transition-all duration-200',
            isSelecting && 'hidden',
          )}
        >
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={renameDraft}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 hover:bg-primary/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-primary" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-muted hover:bg-muted/70"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </>
            ) : (
              <ActionMenu
                label="Session options"
                ariaLabel={`Session options for ${sessionView.sessionName}`}
                icon={MoreHorizontal}
                iconOnly
                variant="ghost"
                size="icon"
                onOpenChange={setOptionsOpen}
                triggerClassName="h-7 w-7 text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100"
                menuClassName="w-[260px] rounded-xl p-1.5 shadow-xl"
                header={(
                  <div className="mb-1 border-b border-border px-3 py-2">
                    <p className="truncate text-xs font-medium text-foreground" title={sessionView.sessionName}>
                      {sessionView.sessionName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{providerLabel} session</p>
                  </div>
                )}
                items={[
                  {
                    key: 'rename',
                    label: 'Rename session',
                    icon: Edit2,
                    onSelect: () => onStartEditingSession(project.projectId, session.id, sessionView.sessionName),
                  },
                  {
                    key: 'pin',
                    label: isPinned ? t('simpleList.unpin') : t('simpleList.pin'),
                    icon: isPinned ? PinOff : Pin,
                    onSelect: () => void togglePinned(),
                  },
                  {
                    key: 'copy',
                    label: copyLabel,
                    description: copyState === 'error' ? 'Click to try again.' : undefined,
                    icon: CopyStateIcon,
                    loading: isCopyPending,
                    closeOnSelect: false,
                    onSelect: handleCopyAction,
                  },
                  ...(onForkSession && canForkThisSession && !isProcessing ? [{
                    key: 'fork',
                    label: 'Fork session',
                    description: 'Continue from a copy, leaving this one untouched.',
                    icon: GitBranch,
                    onSelect: () => onForkSession(session),
                  }] : []),
                  ...(!isProcessing ? [{
                    key: 'delete',
                    label: 'Close or delete session',
                    icon: Trash2,
                    isDanger: true,
                    showDividerBefore: true,
                    onSelect: requestDeleteSession,
                  }] : []),
                ]}
              />
            )}
          </div>
      </div>
      )}
    </div>
  );
}

/**
 * Memoized: a websocket session delta re-renders the sidebar roughly every
 * 0.5-2s during a run, and a rename keystroke re-renders it per character.
 *
 * SidebarProjectSessions hands every row but the one being renamed a constant
 * draft, and the session objects come from a per-project cache, so the compare
 * succeeds for the rest.
 */
export default memo(SidebarSessionItem);
