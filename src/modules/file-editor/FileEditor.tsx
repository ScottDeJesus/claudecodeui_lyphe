import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Banner, Button, ConfirmDialog } from '@/shared/ui';
import { useTheme } from '@/shared/context/ThemeContext';
import { useToast } from '@/shared/context/ToastContext';
import { useWindowedDocument } from '@/modules/file-editor/hooks/useWindowedDocument';
import {
  discardEditSession,
  endEditSession,
  registerSaveHandler,
} from '@/modules/file-editor/utils/editSessionStore';

/** What the editor needs; rendered by the file-manager module's PreviewPane through the barrel. */
type FileEditorProps = {
  projectId: string;
  /** The file being edited, project-relative. */
  path: string;
  /** The file line the editor opens at — the line the reader was looking at in the preview. */
  anchorLine: number;
  /** Called once the reader is done; the outcome says whether the file on disk changed. */
  onClose: (outcome: 'saved' | 'discarded' | 'clean') => void;
};

/** `48210` reads `48,210`: every number in the toolbar is a count a person reads, not an id. */
const formatCount = (value: number) => value.toLocaleString('en-US');

/**
 * The Files tab's editor: one text file, edited a window of lines at a time.
 *
 * Used by the file-manager module's PreviewPane, which swaps it in for the read-only lines when
 * the reader presses Edit, and takes it back out through `onClose`.
 *
 * The toolbar sits OUTSIDE the scroller, so Save and Close stay on screen however far the reader
 * scrolls, and below `md` both are 44px tall — Verve's touch minimum. The banners stack between the
 * toolbar and the text, and each is drawn from the status alone: warn (amber) for a conflict or a
 * failed save, because errors are never red; info for the line too long to edit.
 */
export function FileEditor({ projectId, path, anchorLine, onClose }: FileEditorProps) {
  const { isDarkMode } = useTheme();
  const push = useToast();
  // The engine: a CodeMirror view over a window of this file, plus everything the window needs
  // fetched, evicted and written back. It also owns the toolbar's numbers, so the status alone
  // drives what this component draws.
  const { hostRef, status, save, reloadFromDisk, copyEdits, discard } = useWindowedDocument({
    projectId,
    path,
    anchorLine,
    isDarkMode,
  });
  // Whether the "discard your changes?" question is up. Held here because only a Close pressed
  // while the document is dirty raises it, and both of its answers are this editor's to act on.
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  // The file manager saves the open session through the store before it opens another file, so
  // the store holds this editor's save function exactly while this editor is on screen: a stale
  // one would be a false promise that the mounted engine is still there to answer it.
  useEffect(() => {
    registerSaveHandler(save);
    return () => registerSaveHandler(null);
  }, [save]);

  const handleSave = () => {
    void save();
  };

  const handleClose = () => {
    if (status.dirty) {
      setCloseConfirmOpen(true);
      return;
    }
    // Nothing is at stake, so the session ends with the view: a later open of this file starts
    // clean rather than restoring a document nobody has open.
    endEditSession();
    onClose('clean');
  };

  const handleKeepEditing = () => setCloseConfirmOpen(false);

  const handleDiscard = () => {
    setCloseConfirmOpen(false);
    // The window is re-read as well as the session dropped: the reader chose the file on disk
    // over their text, and what is left on screen behind the closing editor is that file.
    discard();
    discardEditSession();
    onClose('discarded');
  };

  const handleCopyEdits = () => {
    void copyEdits().then((count) => {
      if (count === 0) {
        push({
          tone: 'warn',
          title: 'Nothing to copy',
          message: 'This file has no unsaved changes.',
        });
        return;
      }
      push({
        tone: 'info',
        title: `Copied ${count} ${count === 1 ? 'line' : 'lines'}`,
        message: 'Your changes are on the clipboard — the file on disk still does not have them.',
      });
    }, (cause: unknown) => {
      // The browser can refuse the clipboard (a denied permission, a document that is not
      // focused). That is the one case where the reader is told nothing was copied, because the
      // edits are still only here and a silent failure would read as a successful copy.
      push({
        tone: 'warn',
        title: 'Could not copy',
        message: cause instanceof Error ? cause.message : 'Your browser refused the clipboard.',
      });
    });
  };

  const handleReload = () => {
    void reloadFromDisk();
  };

  // A failed SAVE has a document worth retrying on screen, and the dirty flag is what says so;
  // a failed READ has nothing to write and is retried by reading again. Retrying the read would
  // throw the edits away, which is the one thing the conflict banner exists to prevent.
  const handleRetry = () => {
    if (status.dirty) {
      void save();
      return;
    }
    void reloadFromDisk();
  };

  // The editor's own keymap answers Mod-s while the text has focus. This answers it for the rest
  // of the editor — the toolbar, a banner's buttons — where nothing would stop the key reaching
  // the browser as its own Save Page command. A press the keymap already took is skipped on
  // `defaultPrevented`, so one press is one save however the focus sits.
  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
      return;
    }
    event.preventDefault();
    handleSave();
  };

  const fileName = path.split('/').pop() ?? path;
  const canSave = status.dirty && (status.phase === 'ready' || status.phase === 'error');
  const range = `Lines ${formatCount(status.firstLine)}–${formatCount(status.lastLine)}`;
  // A clean error is a read that failed — the first window, or a reload — so no range on screen is
  // the file's; a dirty one is a failed save, and its range and "Unsaved changes" are both still true.
  const statusText = status.phase === 'loading'
    ? `Reading ${fileName}…`
    : status.phase === 'error' && !status.dirty
      ? `Couldn't open ${fileName} for editing`
      : [
        status.totalLines === null ? range : `${range} of ${formatCount(status.totalLines)}`,
        status.dirty ? 'Unsaved changes' : 'All changes saved',
      ].join(' · ');
  const showBanners = status.phase === 'conflict' || (status.phase === 'error' && status.message !== null) || status.longLineStop !== null;

  return (
    <section
      aria-label="File editor"
      data-window-first={status.firstLine}
      data-window-last={status.lastLine}
      data-window-lines={status.lastLine - status.firstLine + 1}
      data-dirty={status.dirty ? 'true' : 'false'}
      data-phase={status.phase}
      onKeyDown={handleEditorKeyDown}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-none flex-col gap-1 border-b border-border px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>{fileName}</span>
          <Button aria-label="Save file" size="sm" className="max-md:h-11" disabled={!canSave} onClick={handleSave}>
            {status.phase === 'saving' ? 'Saving…' : 'Save'}
          </Button>
          <Button aria-label="Close editor" variant="outline" size="sm" className="max-md:h-11" onClick={handleClose}>
            {status.dirty ? 'Cancel' : 'Close'}
          </Button>
        </div>
        <div className="text-[12.5px] text-muted-foreground">{statusText}</div>
      </div>

      {showBanners && (
        <div className="flex flex-none flex-col gap-2 px-3.5 pt-2.5">
          {status.phase === 'conflict' && (
            <div data-editor-banner="conflict">
              <Banner tone="warn">
                <div className="flex flex-col gap-2.5">
                  <p>{fileName} changed on disk after you opened it. Saving is off so your edits cannot overwrite the newer version.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" className="max-md:h-11" onClick={handleCopyEdits}>Copy my changes</Button>
                    <Button variant="outline" size="sm" className="max-md:h-11" onClick={handleReload}>Reload from disk</Button>
                  </div>
                </div>
              </Banner>
            </div>
          )}
          {status.phase === 'error' && status.message !== null && (
            <div data-editor-banner="error">
              <Banner tone="warn">
                <div className="flex flex-col gap-2.5">
                  <p>{status.message}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" className="max-md:h-11" onClick={handleRetry}>Try again</Button>
                  </div>
                </div>
              </Banner>
            </div>
          )}
          {status.longLineStop !== null && (
            <div data-editor-banner="long-line">
              <Banner tone="info">
                Editing stops at line {formatCount(status.longLineStop)}: it is too long to edit here.
              </Banner>
            </div>
          )}
        </div>
      )}

      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />

      <ConfirmDialog
        open={closeConfirmOpen}
        title="Unsaved changes"
        message={`Discard your changes to ${fileName}?`}
        actions={[
          { label: 'Keep editing', variant: 'outline', onSelect: handleKeepEditing },
          { label: 'Discard', variant: 'destructive', onSelect: handleDiscard },
        ]}
        onDismiss={handleKeepEditing}
      />
    </section>
  );
}
