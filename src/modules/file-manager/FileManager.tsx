import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';

import { api } from '@/shared/api';
import { FileTree, useFileTreeUpload } from '@/modules/file-tree';
import { Button, ConfirmDialog } from '@/shared/ui';
import { useToast } from '@/shared/context/ToastContext';
import { cn, downloadBlobAsFile, formatBytes } from '@/shared/utils';
import type { Project, UploadedFileRecord } from '@/shared/types';
import { getEditSessionStatus, useEditSessionStatus } from '@/modules/file-editor';
import { DirectoryListing } from '@/modules/file-manager/DirectoryListing';
import { FileBreadcrumb } from '@/modules/file-manager/FileBreadcrumb';
import { PreviewPane } from '@/modules/file-manager/PreviewPane';
import { useEditGuard } from '@/modules/file-manager/hooks/useEditGuard';
import { useFileManagerState } from '@/modules/file-manager/hooks/useFileManagerState';

/** What the file manager needs; rendered by the project-workspace module as the Files tab. */
type FileManagerProps = {
  selectedProject: Project;
  /**
   * A path somewhere else in the app asked to open, and the line it asked for when it named one. It
   * is a fresh wrapper every time, and the owner retires it once `onRequestHandled` fires — which is
   * what makes asking for the SAME path twice a second request rather than a no-op. `nonce` carries
   * that same "this is a new ask" downward, where the wrapper's identity does not reach.
   */
  openRequest: { path: string; line?: number; nonce: number } | null;
  /** Called once the request above has been acted on, so the owner can retire it. */
  onRequestHandled: () => void;
  /** The one "open a path" capability, so the tree reaches the workspace the way chat and git do. */
  onFileOpen: (filePath: string) => void;
};

/** The directory part of a path, in whatever form the caller spelled it. */
const directoryOf = (path: string) => path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

/**
 * The files a drop actually carries.
 *
 * Directories are counted rather than sent: `dataTransfer.files` reports a dropped folder as a
 * zero-byte entry, and uploading that would put a lie on disk. The tree beside this pane takes a
 * whole folder, which is what the caller is told.
 */
function readDroppedFiles(transfer: DataTransfer): { files: File[]; folders: number } {
  const items = Array.from(transfer.items ?? []);
  if (items.length === 0) {
    return { files: Array.from(transfer.files), folders: 0 };
  }

  const files: File[] = [];
  let folders = 0;

  for (const item of items) {
    if (item.kind !== 'file') {
      continue;
    }
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      folders += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  return { files, folders };
}

/**
 * The Files tab: the project tree, the directory in view, and one file's preview.
 *
 * Exported through the file-manager barrel; the project-workspace module renders it as the Files
 * tab and owns the `openRequest` that chat, git and the palette all raise.
 *
 * The three panes sit side by side and WRAP rather than switch on a breakpoint, so a narrow
 * window stacks them without a second layout to keep in step. Every toast raised here is
 * advisory — the listing that refreshes underneath it is the record of what happened.
 */
export function FileManager({ selectedProject, openRequest, onRequestHandled, onFileOpen }: FileManagerProps) {
  const push = useToast();
  const projectId = selectedProject.projectId;
  const projectName = selectedProject.displayName || projectId;

  // `path` is the working directory the app opened the project at; `fullPath` is what the sidebar
  // falls back to when it is absent. Either one is the root every path below is measured against,
  // and an empty root simply leaves absolute paths absolute — which the server accepts.
  const {
    currentDir,
    listing,
    selectedPath,
    preview,
    targetLine,
    targetNonce,
    missedLine,
    loading,
    error,
    previewError,
    enter,
    up,
    select,
    refresh,
  } = useFileManagerState(projectId, selectedProject.path ?? selectedProject.fullPath ?? '');

  // What the in-flight upload should be called if it fails. The upload hook reports a failure as
  // a message with no file in it, and "was not uploaded" needs to name something.
  const pendingUploadLabelRef = useRef('The file');
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // The div that ARRANGES the two panes, handed to the preview pane so it can bring its own top
  // into view. Below `md` the panes wrap and this is the scroller they stack inside, so a pane
  // that scrolls only its own rows still sits a full container-height below the fold. Passed down
  // rather than reached for through `parentElement`: the pane then moves one node it was GIVEN,
  // which is the whole difference between this and `scrollIntoView`.
  const paneScrollRef = useRef<HTMLDivElement>(null);
  // Every way into a file — the tree, the rows below, an open request from chat, git or the
  // palette — arrives here first, because a file may only take the place of another file once the
  // open session's unsaved text has been saved, dropped, or deliberately kept.
  const openFile = useCallback((path: string, line?: number) => {
    const directory = directoryOf(path);
    // Walk the listing to the file's folder first, so the row that opens is the row in view.
    // Skipped for a file already here: re-entering the directory the reader is standing in is a
    // re-read of the folder for nothing.
    if (directory !== currentDir) {
      enter(directory);
    }
    select(path, line);
  }, [currentDir, enter, select]);
  const {
    guardedSelect,
    requestEdit,
    openGuardOpen,
    editGuardOpen,
    dirtyName,
    editName,
    canSaveFirst,
    savingFirst,
    handleSaveAndOpen,
    handleDiscardAndOpen,
    handleDiscardAndEdit,
    handleKeepEditing,
  } = useEditGuard(projectId, openFile);
  // The one edit session, when it is this project's file: PreviewPane shows the editor for its
  // path, and nothing of another project's belongs in this tab. `editing` is the LAYOUT flag the
  // panes read — true only while that session's file is the SELECTED one, because the editor takes
  // the screen for its own file and for no other, and a hidden tree with no editor on screen would
  // be a blank tab.
  const session = useEditSessionStatus();
  const editingSession = session !== null && session.projectId === projectId ? session : null;
  const editing = editingSession?.path === selectedPath;

  const reportUploadFailure = useCallback((message: string, type: 'success' | 'error') => {
    // The hook's own success line counts files; the record-driven toast below names them, so only
    // its failures are worth passing on from here.
    if (type === 'success') {
      return;
    }
    push({ tone: 'warn', title: `${pendingUploadLabelRef.current} was not uploaded`, message });
  }, [push]);

  const { uploadFiles, uploadProgress } = useFileTreeUpload({
    selectedProject,
    onRefresh: refresh,
    showToast: reportUploadFailure,
  });

  const announceUpload = useCallback((record: UploadedFileRecord) => {
    push({
      tone: 'positive',
      title: `Uploaded ${record.name}`,
      message: `It landed in ${currentDir || projectName} — ${formatBytes(record.size)}.`
        + (record.renamedFrom ? ` (renamed from ${record.renamedFrom})` : ''),
    });
  }, [currentDir, projectName, push]);

  const sendFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    pendingUploadLabelRef.current = files.length === 1 ? files[0].name : `${files.length} files`;
    const saved = await uploadFiles(files, currentDir);
    if (saved === null) {
      // The hook already said why, naming the file through `reportUploadFailure`.
      return;
    }

    for (const record of saved) {
      announceUpload(record);
    }

    // A 200 does not mean every file landed: the server drops one whose destination resolves
    // outside the project and answers with the rest. Counting the records is the only way to
    // notice, and a shortfall nobody mentions is two green toasts telling the opposite story.
    const missing = files.length - saved.length;
    if (missing > 0) {
      push({
        tone: 'warn',
        title: missing === files.length
          ? (files.length === 1 ? `${files[0].name} did not land` : 'None of those files landed')
          : `${missing} of ${files.length} did not land`,
        message: 'The folder below is the record of what arrived.',
      });
    }
  }, [announceUpload, currentDir, push, uploadFiles]);

  const handleDropFiles = useCallback((transfer: DataTransfer) => {
    const { files, folders } = readDroppedFiles(transfer);
    if (folders > 0) {
      push({
        tone: 'warn',
        title: 'Folders are not uploaded here',
        message: 'Drop the files themselves, or drop the folder onto the tree on the left.',
      });
    }
    void sendFiles(files);
  }, [push, sendFiles]);

  const handleUploadInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files;
    if (picked && picked.length > 0) {
      void sendFiles(Array.from(picked));
    }
    event.target.value = '';
  }, [sendFiles]);

  const handleDownload = useCallback(async () => {
    if (!selectedPath) {
      return;
    }

    const fileName = selectedPath.split('/').pop() ?? selectedPath;
    try {
      const response = await api.readFileBlob(projectId, selectedPath);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      downloadBlobAsFile(await response.blob(), fileName);
      push({
        tone: 'info',
        title: 'Download started',
        message: 'Your browser is saving the file — nothing on the machine changes.',
      });
    } catch (cause) {
      push({
        tone: 'warn',
        title: `${fileName} was not downloaded`,
        message: cause instanceof Error ? cause.message : 'The file could not be read.',
      });
    }
  }, [projectId, push, selectedPath]);

  // A request is consumed ONCE, and the owner is told so it can retire it. The mark cannot live in
  // a ref here: this pane is mounted only while the Files tab is showing, so a ref would reset on
  // every tab switch and replay a request the reader satisfied minutes ago — dragging them back out
  // of a folder they had since walked into.
  useEffect(() => {
    if (!openRequest) {
      return;
    }
    guardedSelect(openRequest.path, openRequest.line);
    onRequestHandled();
  }, [guardedSelect, onRequestHandled, openRequest]);

  // The reader may have left a file open in the editor, and its pane unmounts with this tab along
  // with the view that showed it — so a returning reader lands back on that file rather than on an
  // empty pane. Once per project, and never under an open request: that request names its own file
  // and is consumed by the effect above, and restoring over it would drag the reader off the file
  // they just asked for. The ref rather than a dependency list is what makes it once: navigating
  // the tree must not re-run it, and there is no state here to read that says "already restored".
  const restoredProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredProjectRef.current === projectId) {
      return;
    }
    restoredProjectRef.current = projectId;
    if (openRequest) {
      return;
    }
    const live = getEditSessionStatus();
    if (live !== null && live.projectId === projectId) {
      openFile(live.path);
    }
  }, [openFile, openRequest, projectId]);

  // The editor closed on saved, discarded or clean, and only the first of those moved the file —
  // but the listing and the read-only preview are both reads of that file, so both are re-read
  // rather than trusted to still be right.
  const handleEditorClosed = useCallback(() => {
    refresh();
  }, [refresh]);

  const selectedName = selectedPath && directoryOf(selectedPath) === currentDir
    ? selectedPath.split('/').pop() ?? null
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5 bg-background p-3.5 md:flex-row md:p-4">
      {/* The prototype draws the tree 190px wide, over a name-only list. The real one carries a
          search box, five controls and four columns in its DEFAULT detailed view. At 280 the
          "Detailed view" toggle hung 9px past the pane's `overflow-hidden` edge, unclickable; at 320
          every control sits inside it, which is what the probe measures and what this width is for.
          The COLUMN GRID is a separate thing and never fits: it re-flows to 338 here and is CLIPPED
          by this section's `overflow-hidden`, so the Permissions head is truncated at 320 as it is
          at every width — the tree has no horizontal scroll to reach it with. Narrowing this pane
          again means re-measuring the controls, not the grid. */}
      <section aria-label="Project files" className={cn('flex h-[210px] flex-none flex-col overflow-hidden rounded-xl border border-border bg-card md:h-auto md:w-[320px]', editing && 'max-md:hidden')}>
        <FileTree selectedProject={selectedProject} onFileOpen={onFileOpen} />
      </section>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
          <FileBreadcrumb projectName={projectName} currentDir={currentDir} onNavigate={enter} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>Refresh</Button>
            {/* Withheld when the read was refused and nothing of this project has resolved: the
                upload would target the project root and the server CREATES a target it cannot
                reach, so offering it beside "Directory not found" is both a claim that cannot be
                taken and a write nobody asked for. A refusal that still has rows (walking into a
                walled subfolder) leaves the reader in a real folder, and keeps the offer. */}
            {!(error && !listing) && (
              <Button size="sm" onClick={() => uploadInputRef.current?.click()}>Upload files</Button>
            )}
          </div>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Upload files into this folder"
          onChange={handleUploadInputChange}
        />

        {/* `[&>section]:max-h-full` bounds BOTH panes, and belongs here because this is what
            arranges them. Each pane declares an inner `overflow-y-auto` that was never a real
            scroller: a pane is a flex item on a WRAPPING line, so nothing capped its height — it
            grew to its content (4,827px for a 200-line preview at 1440x900), its inner div
            inherited that, and `scrollTop` was stuck at 0. THIS div scrolled instead, which is why
            revealing a line took the directory listing with it. Capping one pane alone unbalances
            the row (a capped preview beside a listing still growing to 2,796px scrolls out of view),
            so the cap must be symmetric — and a child selector stays symmetric for a third pane.
            While a file is open in the editor a phone gives it the whole tab: the listing (the first
            pane) steps aside below `md`, as the tree does, and the preview takes the full height. */}
        <div
          ref={paneScrollRef}
          className={cn(
            'flex min-h-0 flex-1 flex-wrap content-start overflow-y-auto overflow-x-hidden [&>section]:max-h-full',
            editing && 'max-md:[&>section:first-child]:hidden [&>section:last-child]:h-full',
          )}
        >
          <DirectoryListing
            entries={listing?.entries ?? []}
            hasParent={currentDir !== ''}
            selectedName={selectedName}
            loading={loading}
            error={error}
            upload={uploadProgress}
            onOpenDirectory={(name) => enter(currentDir ? `${currentDir}/${name}` : name)}
            onOpenFile={(name) => guardedSelect(currentDir ? `${currentDir}/${name}` : name)}
            onUp={up}
            onDropFiles={handleDropFiles}
          />

          <PreviewPane
            paneScrollRef={paneScrollRef}
            projectId={projectId}
            selectedPath={selectedPath}
            preview={preview}
            targetLine={targetLine}
            targetNonce={targetNonce}
            missedLine={missedLine}
            error={previewError}
            onDownload={() => { void handleDownload(); }}
            editing={editingSession}
            onRequestEdit={requestEdit}
            onEditorClosed={handleEditorClosed}
          />
        </div>
      </div>

      <ConfirmDialog
        open={openGuardOpen}
        title="Unsaved changes"
        message={`${dirtyName} has unsaved changes.`}
        actions={[
          ...(canSaveFirst ? [{ label: 'Save and open', variant: 'default' as const, onSelect: handleSaveAndOpen, busy: savingFirst }] : []),
          { label: 'Discard and open', variant: 'destructive', onSelect: handleDiscardAndOpen },
          { label: 'Keep editing', variant: 'outline', onSelect: handleKeepEditing },
        ]}
        onDismiss={handleKeepEditing}
      />
      <ConfirmDialog
        open={editGuardOpen}
        title="Unsaved changes"
        message={`${dirtyName} has unsaved changes in another project. Discard them and edit ${editName}?`}
        actions={[
          { label: 'Keep editing', variant: 'outline', onSelect: handleKeepEditing },
          { label: 'Discard and edit', variant: 'destructive', onSelect: handleDiscardAndEdit },
        ]}
        onDismiss={handleKeepEditing}
      />
    </div>
  );
}
