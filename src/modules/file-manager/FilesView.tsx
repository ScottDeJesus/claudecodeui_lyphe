import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderTree, Pin, PinOff, Plus } from 'lucide-react';

import { FileManager } from '@/modules/file-manager/FileManager';
import { pinFolder, unpinFolder } from '@/modules/file-manager/hooks/useFilesPins';
import { selectFilesRoot, useSelectedFilesRoot } from '@/modules/file-manager/hooks/useSelectedFilesRoot';
import { FolderBrowserModal, createProjectRequest } from '@/modules/project-creation-wizard';
import { useToast } from '@/shared/context/ToastContext';
import { Button, Chip, EmptyState } from '@/shared/ui';
import type { FileOpenRequest, FilesRoot, ProjectChoice } from '@/shared/types';
import { cn } from '@/shared/utils';

/** What the Files view needs from the project-workspace module, which owns every one of these. */
type FilesViewProps = {
  /** The strip, in strip order: the git repositories, then the folders the operator pinned. */
  roots: FilesRoot[];
  /**
   * Every registered project. The pin flow reads it to tell a folder the app already knows, which
   * is pinned as it is, from one it has never opened, which is registered first.
   */
  projectChoices: ProjectChoice[];
  /**
   * A file asked to open from elsewhere in the app — chat, git, the palette — by absolute path. The
   * root that holds it shows it, so the root on screen never acts on another root's path.
   */
  openRequest: FileOpenRequest | null;
  /** Called once the request above has been acted on, so the owner can retire it. */
  onRequestHandled: () => void;
  /** The one "open a path" capability, handed to the file tree so it opens files the way chat and git do. */
  onFileOpen: (filePath: string) => void;
  /**
   * Re-reads the projects list. The pin flow waits on it after registering a folder the app had
   * never opened, so the new project is a root before it is pinned and selected.
   */
  onProjectsChanged: () => Promise<void>;
};

/** Where focus lands once a flow has redrawn the roots: on the root that was pinned, or on whatever the selection fell back to after an unpin. */
type FocusLanding = { kind: 'pinned' | 'unpinned'; path: string };

/** Whether a root holds a path: the path is the root itself, or lies under it. */
const rootHolds = (root: FilesRoot, path: string) => (
  path === root.fullPath || path.startsWith(`${root.fullPath.replace(/\/+$/, '')}/`)
);

/** The deepest root that holds a path — ~/.claude and ~/.claude/claudecodeui_lyphe are both roots, and a file under the second is the second's. */
function deepestRootHolding(roots: FilesRoot[], path: string): FilesRoot | null {
  let deepest: FilesRoot | null = null;
  for (const root of roots) {
    if (rootHolds(root, path) && (deepest === null || root.fullPath.length > deepest.fullPath.length)) {
      deepest = root;
    }
  }
  return deepest;
}

/**
 * The Files view: its own strip of roots, over the file manager of the selected one.
 *
 * Used by the project-workspace module's WorkspaceMain as the Files pane, which owns the roots, the
 * projects list and the open request this view acts on.
 *
 * The strip belongs to the view — the git repositories, then the folders the operator pinned —
 * and opening another chat never moves it. One chip per root with the selected one lit, then
 * "Pin a folder", then Unpin, shown while a pinned root is selected: a pin that cannot be taken
 * back is a trap. While any root is pinned, Unpin's slot keeps its width with a git root selected
 * too, so the strip's rows follow the roots and never the selection — on a phone the body under it
 * never jumps as roots are picked. A pinned root wears a pin, so Unpin coming and going has a
 * reason the reader can see.
 *
 * Focus never falls to the page when the roots redraw under it: an unpin lands on the selected
 * chip (the root the selection fell back to, announced as pressed), an answered pin on the new
 * root's chip, and a pin closed with no answer back on "Pin a folder".
 *
 * The chips wrap rather than scroll: a root half off the edge reads as a broken row, not as more to
 * come. The strip stands on the body's own ground at the body's own inset, so its chips line up with
 * the panes under it and the panes' top padding is the whole gap between them — no rule, which
 * would be a second line a few pixels above the panes' own edges.
 */
export function FilesView({ roots, projectChoices, openRequest, onRequestHandled, onFileOpen, onProjectsChanged }: FilesViewProps) {
  const push = useToast();
  // The root this device last showed, by path — module-scope, so it outlives this view's unmounts.
  const storedPath = useSelectedFilesRoot();

  // The stored path while it is on the strip, else the first root: a pin taken off on another page,
  // or a repository the install stopped listing, falls back rather than leaving nothing selected.
  const selectedRoot = roots.find((root) => root.fullPath === storedPath) ?? roots[0] ?? null;
  // Whether Unpin's slot is drawn at all: with no pin there is nothing to unpin, and no width to keep.
  const anyPinned = roots.some((root) => root.pinned);

  // Where a flow that redraws the roots lands focus. The kit Chip takes no ref, so the handles are
  // the two containers: the strip, whose pressed chip is the selected root and whose first
  // `button:not([aria-pressed])` is "Pin a folder", and the empty state, whose one button is "Pin a folder".
  const stripRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);

  // Set by an unpin or an answered pin just before it writes, read by the effect below once the roots
  // have been redrawn. A ref: nothing renders from it, and it must not be a render of its own.
  const pendingLandingRef = useRef<FocusLanding | null>(null);

  // Focus on the pressed chip — the selected root — or, with no strip, the empty state's button.
  const focusSelectedRoot = useCallback(() => {
    const target = stripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?? emptyRef.current?.querySelector<HTMLElement>('button');
    target?.focus();
  }, []);

  // Focus on "Pin a folder": the first button of either container that announces no pressed state.
  const focusPinChip = useCallback(() => {
    (stripRef.current ?? emptyRef.current)?.querySelector<HTMLElement>('button:not([aria-pressed])')?.focus();
  }, []);

  // The roots redrew under a press that took focus with it (the Unpin button, the modal's Select), so focus
  // is put back by hand. Only once the redraw is the one that press asked for: an unpinned path gone from
  // the strip, or the pinned one selected.
  useEffect(() => {
    const landing = pendingLandingRef.current;
    if (!landing) return;
    const redrawn = landing.kind === 'pinned'
      ? selectedRoot?.fullPath === landing.path
      : !roots.some((root) => root.fullPath === landing.path);
    if (!redrawn) return;
    pendingLandingRef.current = null;
    focusSelectedRoot();
  }, [focusSelectedRoot, roots, selectedRoot]);

  // The root an open request belongs to: the deepest root that holds its absolute path, else the selected
  // root, which takes the path as it is and lets the server decide.
  const requestRoot = useMemo(
    () => (openRequest ? (deepestRootHolding(roots, openRequest.path) ?? selectedRoot) : null),
    [openRequest, roots, selectedRoot],
  );

  // An explicit open is the operator asking to see that file, so the view moves to the root that holds it.
  // Opening another chat never raises a request, so it never moves the strip.
  useEffect(() => {
    if (requestRoot && requestRoot.fullPath !== selectedRoot?.fullPath) {
      selectFilesRoot(requestRoot.fullPath);
    }
  }, [requestRoot, selectedRoot]);

  // With no root there is no file manager to take the request, and left standing it would be replayed
  // onto the first root pinned later. A request is an event: it is retired here.
  useEffect(() => {
    if (openRequest && !selectedRoot) onRequestHandled();
  }, [onRequestHandled, openRequest, selectedRoot]);

  // Whether the folder browser is open: the pin chip opens it, and an answer or a close shuts it.
  const [browserOpen, setBrowserOpen] = useState(false);

  // The browser closed with no folder chosen: nothing changed, and focus returns to the chip that opened it.
  const handleBrowserClosed = useCallback(() => {
    setBrowserOpen(false);
    focusPinChip();
  }, [focusPinChip]);

  // The wrapper the folder browser is mounted in. The wizard's modal is a bare scrim with no dialog role, no focus move and
  // no Escape of its own, and it is shared with the wizard — so this view makes it a dialog from outside: the wrapper names
  // it, focus moves in once it has loaded, Tab stays inside it, and Escape closes it.
  const browserRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = browserRef.current;
    if (!browserOpen || !dialog) return undefined;
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];

    // The modal is lazy, so it may not be in the wrapper yet: focus its first control the moment it arrives.
    const firstControl = focusables()[0];
    let watcher: MutationObserver | null = null;
    if (firstControl) {
      firstControl.focus();
    } else {
      watcher = new MutationObserver(() => {
        const arrived = focusables()[0];
        if (!arrived) return;
        watcher?.disconnect();
        arrived.focus();
      });
      watcher.observe(dialog, { childList: true, subtree: true });
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape in the new-folder field is that field's own (it cancels the field), not the dialog's.
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        handleBrowserClosed();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusables();
      if (controls.length === 0) return;
      const outside = !dialog.contains(document.activeElement);
      const atEdge = document.activeElement === controls[event.shiftKey ? 0 : controls.length - 1];
      if (outside || atEdge) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      watcher?.disconnect();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [browserOpen, handleBrowserClosed]);

  // The browser answered a folder path. A folder already on the strip is selected; one the app knows as a
  // project is pinned as it is; one it has never opened is registered first, through the wizard's own door.
  // That door also brings back a project the operator archived from the chat list: the server reactivates an
  // archived row at the path, so the answer is an ordinary active project.
  const handleFolderChosen = useCallback(async (folderPath: string) => {
    setBrowserOpen(false);
    if (roots.some((root) => root.fullPath === folderPath)) {
      if (selectedRoot?.fullPath === folderPath) {
        focusSelectedRoot();
      } else {
        pendingLandingRef.current = { kind: 'pinned', path: folderPath };
        selectFilesRoot(folderPath);
      }
      return;
    }
    const known = projectChoices.find((choice) => choice.fullPath === folderPath);
    if (known) {
      pendingLandingRef.current = { kind: 'pinned', path: known.fullPath };
      pinFolder(known.fullPath);
      selectFilesRoot(known.fullPath);
      return;
    }
    try {
      const project = await createProjectRequest({ path: folderPath });
      // The pin is the project's own path as the server resolved it: a root matches a pin by exact `fullPath`.
      const projectPath = typeof project?.fullPath === 'string' ? project.fullPath : folderPath;
      await onProjectsChanged();
      pendingLandingRef.current = { kind: 'pinned', path: projectPath };
      pinFolder(projectPath);
      selectFilesRoot(projectPath);
    } catch (cause) {
      // A 409 says a project is already registered at this path — this page's list had not heard of it (another window
      // registered it). Not a refusal to show: refresh the list and pin the folder as the registered project it is.
      if (cause instanceof Error && 'status' in cause && cause.status === 409) {
        await onProjectsChanged();
        pendingLandingRef.current = { kind: 'pinned', path: folderPath };
        pinFolder(folderPath);
        selectFilesRoot(folderPath);
        return;
      }
      push({
        tone: 'warn',
        title: 'That folder was not pinned',
        message: cause instanceof Error ? cause.message : 'The folder could not be added.',
      });
      focusPinChip();
    }
  }, [focusPinChip, focusSelectedRoot, onProjectsChanged, projectChoices, push, roots, selectedRoot]);

  // Takes the selected pin off the strip. Its folder and files stay as they are; focus lands on the root
  // the selection falls back to once the strip has redrawn.
  const handleUnpin = useCallback(() => {
    if (!selectedRoot?.pinned) return;
    pendingLandingRef.current = { kind: 'unpinned', path: selectedRoot.fullPath };
    unpinFolder(selectedRoot.fullPath);
  }, [selectedRoot]);

  // One chip for the strip and the empty state alike: the way to add a folder is the same mark
  // wherever it is offered. Solid-edged, because a dashed chip edge is Verve's unknown state.
  const pinChip = (
    <Chip
      size="sm"
      action
      title="Choose a folder to keep in Files, whichever chat is open. A folder whose project was archived from the chat list comes back to it."
      onClick={() => setBrowserOpen(true)}
    >
      <Plus className="size-3.5" aria-hidden="true" />
      Pin a folder
    </Chip>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {selectedRoot ? (
        <>
          <div ref={stripRef} role="group" aria-label="Folders" className="flex flex-none flex-wrap items-center gap-1.5 px-3.5 pt-3.5 md:px-4 md:pt-4">
            {roots.map((root) => (
              <Chip
                key={root.projectId}
                size="sm"
                selected={root.projectId === selectedRoot.projectId}
                title={root.fullPath}
                className="max-w-full"
                onClick={() => selectFilesRoot(root.fullPath)}
              >
                {root.pinned && <Pin className="size-3 flex-none" aria-hidden="true" />}
                <span className="min-w-0 truncate">{root.displayName}</span>
              </Chip>
            ))}
            {/* The two actions keep one line: Unpin never wraps alone, and it stretches to the chip's height. */}
            <div className="flex items-stretch gap-1.5">
              {pinChip}
              {anyPinned && (
                // Neutral ink and a neutral hover, not the ghost's accent: taking a folder off the strip is
                // not a go-ahead, and the ghost's hover fill is the selected chip's own (`!`, because the kit's
                // ghost hover rule outranks a plain hover utility). `invisible` holds the slot with a git root
                // selected, out of the tab order and the accessibility tree. The title says the one thing a
                // reader fears: nothing on disk is touched.
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-auto px-2.5 text-xs text-muted-foreground hover:!bg-secondary hover:text-foreground [&_svg]:size-3.5',
                    !selectedRoot.pinned && 'invisible',
                  )}
                  aria-label={`Unpin ${selectedRoot.displayName}`}
                  title={`Take ${selectedRoot.displayName} off the strip. Its folder and files stay as they are.`}
                  onClick={handleUnpin}
                >
                  <PinOff aria-hidden="true" />
                  Unpin
                </Button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {/* Keyed on the root, so every listing, open file and edit session belongs to ONE root. The request
                goes only to its own root's manager: the root on screen never acts on another root's path. */}
            <FileManager
              key={selectedRoot.projectId}
              root={selectedRoot}
              openRequest={openRequest && requestRoot?.projectId === selectedRoot.projectId ? openRequest : null}
              onRequestHandled={onRequestHandled}
              onFileOpen={onFileOpen}
            />
          </div>
        </>
      ) : (
        // No strip without a root to put on it: the empty state takes the pane, and the pin chip
        // stands right under its sentence, where the eye already is. Under the frame, not in it:
        // the kit's in-frame action is a tonal button, and adding a folder keeps one mark — the
        // strip's chip — wherever it is offered.
        <div ref={emptyRef} className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4">
          <EmptyState
            icon={FolderTree}
            title="No folders to browse"
            message="Pin a folder to browse its files. It stays in Files whichever chat you open."
          />
          {pinChip}
        </div>
      )}
      {/* Its own Suspense: the pane's boundary is the workspace's, and the browser's first load must not blank the pane. */}
      {browserOpen && (
        <div ref={browserRef} role="dialog" aria-modal="true" aria-label="Choose a folder to pin">
          <Suspense fallback={null}>
            <FolderBrowserModal isOpen autoAdvanceOnSelect={false} onClose={handleBrowserClosed} onFolderSelected={handleFolderChosen} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
