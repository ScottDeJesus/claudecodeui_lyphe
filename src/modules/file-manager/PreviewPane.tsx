import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { api } from '@/shared/api';
import { EmptyState, Spinner } from '@/shared/ui';
import { cn, formatBytes, formatRelativeTime } from '@/shared/utils';
import type { EditSessionStatus, FilePreview, PreviewView } from '@/shared/types';
import { DocumentPreview } from '@/modules/document-preview';
import { FileEditor } from '@/modules/file-editor';
import { PreviewHeader } from '@/modules/file-manager/PreviewHeader';
import { choosePreviewBody } from '@/modules/file-manager/utils/previewBody';

/** What the preview pane needs; rendered by the file-manager module's FileManager. */
type PreviewPaneProps = {
  /**
   * The scroller the arranger stacks both panes inside, owned by `FileManager`. Revealing a line
   * means moving TWO scrollers — this pane's rows, and the pane itself when the layout has wrapped.
   */
  paneScrollRef: RefObject<HTMLDivElement>;
  projectId: string;
  /** The selected file, project-relative. Null when nothing is selected. */
  selectedPath: string | null;
  preview: FilePreview | null;
  /**
   * The line a caller asked to land on, or null when nobody named one. The row carrying it is
   * marked and scrolled to; a line past the end of the window is simply not found, and the
   * window's own top stays on screen rather than a wrong line being marked.
   */
  targetLine: number | null;
  /** Which ask put that line here. Re-asking re-scrolls on this alone, with no re-read. */
  targetNonce: number;
  /** A line that turned out to be past the end of the file, once the window has fallen back to the top. */
  missedLine: number | null;
  /** The server's own sentence when this file could not be read. */
  error: string | null;
  onDownload: () => void;
  /** The one edit session, when it belongs to this project; the pane shows the editor for its file. */
  editing: EditSessionStatus | null;
  /** Asks to open `path` in the editor at `anchorLine`; the file manager guards it against a dirty session. */
  onRequestEdit: (path: string, anchorLine: number) => void;
  /** The editor closed; the outcome says whether the file on disk changed. */
  onEditorClosed: (outcome: 'saved' | 'discarded' | 'clean') => void;
};

/**
 * What the footer says about the window on screen — a RANGE, because a window no longer always
 * begins at line 1.
 *
 * "First N of M lines" was true only while every preview started at the top. A window opened at a
 * file reference's line would have it claim to be showing the first 200 lines of a file it is
 * showing the middle of, which is the kind of wrong a reader has no way to notice.
 */
function lineRangeLabel(
  preview: Extract<FilePreview, { kind: 'text' }>,
  missedLine: number | null,
  settledLine: number | null,
): string {
  // Names the line the READER asked for, never the window start derived from it: `99959` is
  // `line - 40`, a number nobody typed and nobody can map back to what they clicked. When the
  // file's length was known the ask was clamped to its last line, and saying WHICH line that is
  // turns a pane the reader cannot account for into one that explains itself.
  const overshot = missedLine === null ? '' : (settledLine !== null
    ? ` Line ${missedLine} is past the end of this file — this is line ${settledLine}, its last.`
    : ` Line ${missedLine} is past the end of this file.`);

  if (preview.lines.length === 0) {
    return (preview.totalLines !== null
      ? `No lines from ${preview.startLine} — the file has ${preview.totalLines}.`
      : `No lines from ${preview.startLine}.`) + overshot;
  }
  const range = `Lines ${preview.startLine}–${preview.startLine + preview.lines.length - 1}`;
  return (preview.totalLines !== null ? `${range} of ${preview.totalLines}.` : `${range}.`) + overshot;
}

/** Joins the facts the app actually has into one meta line, dropping the ones it does not. */
const metaLine = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' · ');

/** `image/png` reads as `PNG image`; a MIME with no subtype just says `image`. */
const imageKindLabel = (mime: string) => {
  const subtype = mime.split('/')[1];
  return subtype ? `${subtype.toUpperCase()} image` : 'image';
};

/**
 * The right-hand pane: what one file looks like, and the editor when the reader edits it.
 *
 * Used by the file-manager module's FileManager, which owns the selection this reads.
 *
 * Its body is one of three, chosen once per render (`choice`): the editor, a document preview (a
 * PDF, Word file, sheet or media file, or a Markdown/CSV file's rendered view), or the read-only
 * ARMS. The arms are three because `FilePreview` has three: text is shown with its line numbers,
 * an image is loaded through the content stream and MEASURED by the browser, and a binary is
 * offered as a download. A figure the app has not learned yet is not drawn at all — the
 * `1440 × 900` appears only once `onLoad` has fired, never as a pair of zeros while the bytes are
 * still arriving. While the editor is up the pane takes its arranger's whole height, so the
 * editor's own scroller — not the arranger — is the one that scrolls.
 */
export function PreviewPane({
  paneScrollRef, projectId, selectedPath, preview, targetLine, targetNonce, missedLine, error, onDownload,
  editing, onRequestEdit, onEditorClosed,
}: PreviewPaneProps) {
  // The rows' own scroller, and this pane's outermost element. Held so revealing a line is two
  // bounded writes to two NAMED nodes — see the effect below for why that matters.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // The bytes this pane has loaded, and the pixel size the browser measured off them — each
  // tagged with the file it belongs to. Tagged rather than cleared when the selection moves,
  // because the tag is what keeps the PREVIOUS file's picture and `×` figure off the screen for
  // the frames before the new ones arrive. Two records rather than one: the URL is known well
  // before the size is, and a single record would have to invent a size to hold the URL.
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
  const [measured, setMeasured] = useState<{ path: string; width: number; height: number } | null>(null);

  const isImage = preview?.kind === 'image';
  const imagePath = isImage ? selectedPath : null;
  const settledImage = imagePath && loaded?.path === imagePath ? loaded : null;
  const imageUrl = settledImage?.url ?? null;
  const imageFailed = settledImage !== null && settledImage.url === null;
  const dimensions = imagePath && measured?.path === imagePath ? measured : null;

  useEffect(() => {
    if (!imagePath) {
      return undefined;
    }

    let objectUrl: string | null = null;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await api.readFileBlob(projectId, imagePath, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setLoaded({ path: imagePath, url: objectUrl });
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') {
          return;
        }
        // A settled record with no URL: the pane says the bytes did not arrive rather than
        // spinning forever on a load that is over.
        setLoaded({ path: imagePath, url: null });
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath, projectId]);

  /**
   * Puts the targeted line on screen — which takes TWO scrollers, one of them not this pane's.
   *
   * NEVER `scrollIntoView`: that walks every scrollable ancestor it can find, the page included,
   * and below `md` the two panes WRAP inside the arranger, so revealing a line that way scrolls
   * the directory listing clean off the top — the reader lands on their line having lost the
   * folder they were standing in.
   *
   * What makes this different is not that it stays inside the component — it does NOT. It writes
   * `scrollTop` on this pane's row scroller AND on `paneScrollRef`, the arranger owned by
   * `FileManager` and passed in deliberately. Both are single NAMED nodes, chosen here rather
   * than discovered by the browser, and the second is written only when it can actually scroll.
   * That is the whole distinction, and the reason it is spelled out: the next editor must not
   * read "it already reaches outside" as licence to reach for `scrollIntoView` again.
   *
   * Keyed on the preview OBJECT and on the ASK: a new window is a new object, and `targetNonce`
   * moves when the same window is asked for again — which is what returns a reader who has since
   * scrolled away to their line without re-reading a thing.
   *
   * A LAYOUT effect, not a passive one: `useEffect` runs after paint, so the window painted at its
   * own top and then jumped to the target — one visible frame at the wrong position on every open.
   * It reads and writes `scrollTop` and nothing else, on two nodes that are already laid out, which
   * is cheap enough to do before paint.
   */
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || targetLine === null) {
      return;
    }
    const row = container.querySelector<HTMLElement>('[data-target-line="true"]');
    if (!row) {
      // The window does not hold that line — a file shorter than the reference claimed. Nothing is
      // scrolled and nothing is marked, which leaves the window's own top on screen.
      return;
    }
    const offsetInView = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    // A third of the way down, not at the top edge: the lines LEADING UP to a target are most of
    // what makes it readable, and a target pinned to the top hides every one of them.
    container.scrollTop = Math.max(0, container.scrollTop + offsetInView - container.clientHeight / 3);

    // Then the SECOND scroller, because a row revealed inside a pane that is itself below the fold
    // is not revealed. Below `md` the panes wrap and stack, so the preview begins a full container
    // height down (measured: section top 1007 at 768x1024, 829 at 390x844 — the reader landed on
    // the directory listing and never saw the line). One write, to the arranger this pane was
    // handed, and only when it actually scrolls: side by side both panes are capped to its height,
    // it has nothing to move, and the listing beside the preview must not be moved.
    const arranger = paneScrollRef.current;
    const pane = sectionRef.current;
    if (!arranger || !pane || arranger.scrollHeight <= arranger.clientHeight) {
      return;
    }
    const paneTop = arranger.scrollTop + pane.getBoundingClientRect().top - arranger.getBoundingClientRect().top;
    arranger.scrollTop = Math.max(0, paneTop);
  }, [paneScrollRef, preview, targetLine, targetNonce]);

  const fileName = selectedPath?.split('/').pop() ?? '';
  // Which view of a Markdown/CSV file shows: 'rendered' first, and again whenever the path changes.
  // Tagged with the path it was chosen for, like the two image records above: the file the reader
  // has just left is not the file arriving, so a second CSV opens on its table rather than
  // inheriting the first one's Source view.
  const [viewChoice, setViewChoice] = useState<{ path: string | null; view: PreviewView }>({ path: null, view: 'rendered' });
  const view = viewChoice.path === selectedPath ? viewChoice.view : 'rendered';
  const setView = (next: PreviewView) => setViewChoice({ path: selectedPath, view: next });
  // True when the app's one edit session is this file: the pane then shows the editor in place of
  // the arms, and the header's Edit button is not drawn over it.
  const editingThis = editing !== null && editing.path === selectedPath;
  // The pane's whole routing rule, in one call: the header's Edit and toggle and the body below
  // are all read off this answer, so the buttons and what they sit above cannot disagree.
  const choice = choosePreviewBody({ preview, path: selectedPath, editingThis, view });
  // Edit opens the session where the reader is looking: the line a file reference named, else the
  // top of the window on screen, and line 1 for a file whose preview shows no lines at all. The
  // file manager guards it against a session left dirty in another project.
  const handleEdit = () => {
    if (selectedPath === null) {
      return;
    }
    onRequestEdit(selectedPath, targetLine ?? (preview?.kind === 'text' ? preview.startLine : null) ?? 1);
  };
  // The outcome is the file manager's business: only a save moved the file, and it re-reads the
  // listing and the preview for it. The pane keeps nothing of the session that has just ended.
  const handleEditorClosed = (outcome: 'saved' | 'discarded' | 'clean') => onEditorClosed(outcome);
  // The session's own file and line, held so the editor branch reads them without a cast: the body
  // is `editor` only while `editingThis` holds, and these are its values whenever it is drawn.
  const editingPath = editing?.path ?? '';
  const editingAnchorLine = editing?.anchorLine ?? 1;
  // The document body's bytes, for the file on screen. Rebuilt on every selection, and
  // `DocumentPreview` reads its loader through a ref and keys the fetch on the NAME, so a slow file
  // the reader has left cannot land its bytes under the file they opened in its place.
  const documentPath = selectedPath ?? '';
  const loadDocument = useCallback(async (signal: AbortSignal): Promise<Blob> => {
    const response = await api.readFileBlob(projectId, documentPath, { signal });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.blob();
  }, [projectId, documentPath]);
  const opening = <div className="p-4"><Spinner label={`Opening ${fileName}…`} /></div>;

  return (
    // The height that makes the `overflow-y-auto` below a REAL scroller is imposed by the pane
    // ARRANGER (`FileManager`), not here — see the comment on the wrapper there for why it has to
    // be applied to both panes at once rather than by each pane to itself.
    <section
      ref={sectionRef}
      aria-label="File preview"
      className={cn('flex min-h-[260px] min-w-0 flex-1 basis-[260px] flex-col overflow-hidden', choice.body.kind === 'editor' && 'h-full')}
    >
      <PreviewHeader selectedPath={selectedPath} canEdit={choice.canEdit} onEdit={handleEdit} toggle={choice.toggle}
        view={view} onViewChange={setView} onDownload={onDownload} />

      {choice.body.kind === 'editor' && (
        <Suspense fallback={opening}>
          <FileEditor
            projectId={projectId}
            path={editingPath}
            anchorLine={editingAnchorLine}
            onClose={handleEditorClosed}
          />
        </Suspense>
      )}

      {choice.body.kind === 'document' && (
        <Suspense fallback={opening}>
          <DocumentPreview kind={choice.body.document} name={fileName} bytes={preview?.bytes ?? null} load={loadDocument} onDownload={onDownload} />
        </Suspense>
      )}

      {choice.body.kind === 'arms' && (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {!selectedPath && (
            <div className="p-4">
              <EmptyState title="No file chosen" message="Pick a file on the left to read it here." />
            </div>
          )}

          {selectedPath && error && (
            <p className="px-4 py-4 text-[13px] text-warn-ink">▲ {error}</p>
          )}

          {selectedPath && !error && !preview && (
            <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-ink-faint">
              <Spinner />
              <span>Reading {fileName}…</span>
            </div>
          )}

          {preview?.kind === 'text' && (
            <div className="flex flex-col">
              <div className="flex flex-col gap-1 border-b border-border px-4 pb-2.5 pt-3.5">
                <div className="text-sm font-medium">{fileName}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {metaLine([
                    preview.language,
                    preview.bytes !== null && formatBytes(preview.bytes),
                    preview.totalLines !== null && `${preview.totalLines} lines`,
                    preview.mtime !== null && `changed ${formatRelativeTime(preview.mtime)}`,
                  ])}
                </div>
              </div>

              <div className="overflow-x-auto py-3 font-mono text-[12.5px] leading-[1.85]">
                {preview.lines.map((line, index) => {
                  // The file's OWN line number, not the row's position: the window can start
                  // anywhere, and a gutter counting from 1 in the middle of a file is a lie the
                  // reader would carry straight back into their editor.
                  const lineNumber = preview.startLine + index;
                  const isTarget = lineNumber === targetLine;
                  return (
                    // That absolute number is also the identity: this body is replaced whole when the
                    // file or the window changes, and a file has no other key for a row that may
                    // repeat verbatim.
                    <div
                      key={lineNumber}
                      data-line={lineNumber}
                      data-target-line={isTarget ? 'true' : undefined}
                      className={`flex gap-3.5 px-4${isTarget ? ' bg-primary/10' : ''}`}
                    >
                      <span className={`w-12 flex-none select-none text-right ${isTarget ? 'text-accent-ink' : 'text-ink-faint'}`}>
                        {lineNumber}
                      </span>
                      <span className="whitespace-pre text-muted-foreground">{line}</span>
                    </div>
                  );
                })}
              </div>

              <div className="px-4 pb-4 text-[12.5px] text-ink-faint">
                {/* `targetLine` IS the line the ask settled on once `missedLine` is set — the hook
                    clamps one to the other — so the footer names both without a third prop. */}
                {lineRangeLabel(preview, missedLine, targetLine)}
              </div>
            </div>
          )}

          {preview?.kind === 'image' && imagePath && (
            <div className="flex flex-col">
              <div className="flex flex-col gap-1 border-b border-border px-4 pb-2.5 pt-3.5">
                <div className="text-sm font-medium">{fileName}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {metaLine([
                    imageKindLabel(preview.mime),
                    preview.bytes !== null && formatBytes(preview.bytes),
                    // Only once the browser has measured it. A figure before then would be a guess.
                    dimensions && `${dimensions.width} × ${dimensions.height}`,
                    preview.mtime !== null && formatRelativeTime(preview.mtime),
                  ])}
                </div>
              </div>

              <div className="flex items-center justify-center p-4">
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt={fileName}
                    className="max-h-[50vh] max-w-full rounded-[10px] border border-border object-contain"
                    onLoad={(event) => setMeasured({
                      path: imagePath,
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })}
                  />
                )}
                {!imageUrl && imageFailed && (
                  <p className="text-[12.5px] text-warn-ink">▲ The image could not be loaded.</p>
                )}
                {!imageUrl && !imageFailed && (
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-faint">
                    <Spinner />
                    <span>Loading the image…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {preview?.kind === 'none' && (
            <div className="p-5">
              <EmptyState
                title="No preview for this file"
                message={`${metaLine([fileName, preview.bytes !== null && formatBytes(preview.bytes)])}. Download it to open it in a tool that understands the format.`}
                actionLabel="Download the file"
                onAction={onDownload}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
