import type { DragEvent } from 'react';

import { EmptyState, Meter, Spinner } from '@/shared/ui';
import { cn, formatBytes, formatRelativeTime } from '@/shared/utils';
import type { DirectoryEntry, FileTreeUploadProgressState } from '@/shared/types';

/** What the file manager's listing pane needs; rendered by the file-manager module's FileManager. */
type DirectoryListingProps = {
  entries: DirectoryEntry[];
  /** False at the project root, where there is no level to go up to and no row offering one. */
  hasParent: boolean;
  /** The selected file's name, when it lives in THIS directory. */
  selectedName: string | null;
  loading: boolean;
  error: string | null;
  /** The in-flight upload, so the row it is landing in can show its own progress. */
  upload: FileTreeUploadProgressState | null;
  onOpenDirectory: (name: string) => void;
  onOpenFile: (name: string) => void;
  onUp: () => void;
  onDropFiles: (transfer: DataTransfer) => void;
};

/** One row's three cells, so the header and every row below it line up on the same widths. */
const SIZE_CELL = 'w-[74px] flex-none text-right text-[12.5px] tabular-nums';
const CHANGED_CELL = 'w-[96px] flex-none text-right text-[12.5px]';
const ROW = 'flex w-full items-center gap-3 border-b border-border px-3.5 py-2.5 text-left transition-transform duration-quick ease-enter hover:bg-muted';

/**
 * The middle pane: what is in this directory, in the three columns a person scans — Name, Size,
 * Changed — over a footer that takes a drop.
 *
 * Used by the file-manager module's FileManager, which owns the directory it is showing.
 *
 * A cell reads `—` wherever the server sent `null`: an entry whose `lstat` failed still has a
 * row, and a size of `0 B` or a timestamp of "just now" would be an answer the app does not have.
 * A directory's size is `—` for the same reason: the listing route publishes no child count, and
 * the folder's own inode size is not one.
 */
export function DirectoryListing({
  entries,
  hasParent,
  selectedName,
  loading,
  error,
  upload,
  onOpenDirectory,
  onOpenFile,
  onUp,
  onDropFiles,
}: DirectoryListingProps) {
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onDropFiles(event.dataTransfer);
  };

  return (
    <section aria-label="Folder contents" className="flex min-h-[250px] min-w-0 flex-1 basis-[260px] flex-col overflow-hidden border-b border-r border-border">
      <div className="flex flex-none items-center gap-3 border-b border-border px-3.5 py-2 text-xs uppercase tracking-[0.14em] text-ink-faint">
        <span className="min-w-0 flex-1">Name</span>
        <span className={SIZE_CELL}>Size</span>
        <span className={CHANGED_CELL}>Changed</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Said above the rows, and beside them rather than instead of them: a refused read did not
            move the reader, so what they were looking at is still what they are in. */}
        {error && (
          <p className="px-3.5 py-4 text-[13px] text-warn-ink">▲ {error}</p>
        )}

        {/* Only while there is nothing to show. A re-read of the folder already on screen keeps its
            rows up rather than blinking them away for a spinner. */}
        {loading && entries.length === 0 && !error && (
          <div className="flex items-center gap-2 px-3.5 py-4 text-[13px] text-ink-faint">
            <Spinner />
            <span>Reading this folder…</span>
          </div>
        )}

        {/* The way out needs no listing — `up()` reads the directory in view — so it survives a
            refusal, which is exactly when a pane with no rows would otherwise trap the reader. */}
        {hasParent && (
          <button type="button" className={ROW} onClick={onUp}>
            <span aria-hidden="true" className="w-4 flex-none text-[11px] text-ink-faint">◀</span>
            <span className="min-w-0 flex-1 text-[13.5px] text-muted-foreground">Up one level</span>
            <span className={cn(SIZE_CELL, 'text-ink-faint')}>—</span>
            <span className={cn(CHANGED_CELL, 'text-ink-faint')}>—</span>
          </button>
        )}

        {entries.map((entry) => {
          const isSelected = entry.kind === 'file' && entry.name === selectedName;

          return (
            <button
              key={`${entry.kind}:${entry.name}`}
              type="button"
              {...(isSelected ? { 'aria-current': true } : {})}
              className={cn(
                ROW,
                'hover:translate-x-[3px]',
                // The wash alone would be the only thing saying "chosen", so the bar says it too.
                isSelected && 'border-l-2 border-l-primary bg-primary/10',
              )}
              onClick={() => (entry.kind === 'dir' ? onOpenDirectory(entry.name) : onOpenFile(entry.name))}
            >
              <span aria-hidden="true" className="w-4 flex-none text-[11px] text-ink-faint">
                {entry.kind === 'dir' ? '≔' : '·'}
              </span>
              {/* The name is ellipsised, so the full one is on the title — as in the prototype. */}
              <span
                title={entry.name}
                className={cn('min-w-0 flex-1 truncate text-[13.5px]', entry.kind === 'dir' && 'font-medium')}
              >
                {entry.name}
              </span>
              <span className={cn(SIZE_CELL, 'text-muted-foreground')}>
                {entry.kind === 'dir' ? '—' : formatBytes(entry.bytes)}
              </span>
              <span className={cn(CHANGED_CELL, 'text-muted-foreground')}>{formatRelativeTime(entry.mtime)}</span>
            </button>
          );
        })}

        {upload && upload.status === 'uploading' && (
          <div className="border-b border-border bg-primary/10 px-3.5 py-2.5">
            <Meter
              percent={upload.progress}
              label={upload.fileName ?? `${upload.fileCount} files`}
              value={`${upload.progress}%`}
              sub="Uploading"
            />
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="p-4">
            <EmptyState title="Nothing in this folder" message="Drop a file below, or ask an agent here to write one." />
          </div>
        )}
      </div>

      {/* No folder, no offer to put something in it: a refusal with no rows means nothing of this
          directory came back, and "upload them into this folder" under "Directory not found" is one
          sentence contradicting itself — over a server that would CREATE the missing target. */}
      {!(error && entries.length === 0) && (
        <div
          className="flex flex-none items-center gap-2.5 border-t border-dashed border-input px-3.5 py-2.5 text-[12.5px] text-ink-faint"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <span aria-hidden="true" className="text-[11px]">↑</span>
          <span className="min-w-0 flex-1">Drop files here to upload them into this folder</span>
        </div>
      )}
    </section>
  );
}
