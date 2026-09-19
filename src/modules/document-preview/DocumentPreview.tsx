import { Component, createContext, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileDown, FileX } from 'lucide-react';

import { EmptyState, Spinner } from '@/shared/ui';
import { formatBytes } from '@/shared/utils';
import type { DocumentPreviewKind, TextRenderingKind } from '@/shared/types';
import { documentCapFor, documentViewFor } from '@/modules/document-preview/documentRegistry';

/** What the frame needs; rendered by the file-manager module's PreviewPane through the barrel. */
type DocumentPreviewProps = {
  kind: DocumentPreviewKind | TextRenderingKind;
  /** The file's own name. Its extension is the one the kind was chosen from. */
  name: string;
  /** The file's size when the caller knows it. A size over the kind's cap is never fetched. */
  bytes: number | null;
  /** Fetches the file's bytes. This module knows no project and no API — the caller does. */
  load: (signal: AbortSignal) => Promise<Blob>;
  /** Draws the Download action on the too-large and failed states; without it there is none. */
  onDownload?: () => void;
};

/** Where the frame is: fetching, showing the view, refused by size, or failed to fetch or draw. */
type DocumentFrameState = 'loading' | 'ready' | 'failed' | 'too-large';

/** How a kind view speaks back to the frame around it; DocumentPreview provides it, PdfPreview reads it. */
type DocumentFrame = {
  /** The PDF's page count once pdf.js has opened it; the frame puts it on its root as `data-pdf-pages`. */
  reportPdfPages: (count: number) => void;
  /**
   * How a view reports a file its own library could not read. Optional only because the context's
   * default value — a view drawn with no frame around it — has no root to show a failure on.
   *
   * A view hands the cause up rather than throwing it: React reports an error its boundary catches
   * to the browser as an uncaught one, so an unreadable PDF or workbook would land in the reader's
   * console as a crash rather than as the frame's own `failed` sentence. The boundary stays for
   * what nobody expected — a chunk that will not load, a bug in a view — and lands in the same place.
   */
  reportFailure?: (cause: unknown) => void;
};

/** What the frame read of one file: its bytes, or the library's own words for why they could not be drawn. */
type FrameRead = { phase: 'ready'; blob: Blob } | { phase: 'failed'; message: string };

/**
 * The frame's back channel from its view. The view props are the contract every kind shares and
 * stay as they are; what only one kind learns — a PDF's page count — travels up through here to the
 * root, which is the element a reader of the frame addresses. Outside a frame it does nothing.
 * A view speaks a failure up the same way, which is how a file its own library cannot read reaches
 * the frame's `failed` state without being thrown to the browser on the way.
 */
export const DocumentFrameContext = createContext<DocumentFrame>({ reportPdfPages: () => undefined });

/** The library's own words for a failure, whatever it threw. A library that throws a string has said enough. */
function failureText(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : String(cause);
}

/**
 * Catches whatever a kind's view throws without reporting it first — a chunk that would not load,
 * a bug in a view — and hands it to the frame, which turns it into `failed`. It draws nothing
 * itself: the frame's own failed state is the one place that sentence is said. A file the library
 * simply cannot read is not a throw at all: the view reports that through the context.
 */
class ViewErrorBoundary extends Component<{ onFailure: (cause: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(cause: unknown): void {
    this.props.onFailure(cause);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The frame every document preview sits in: it fetches the bytes once, and draws the kind's view.
 *
 * Used by the file-manager module's PreviewPane for a PDF, Word, sheet, audio or video file, and
 * for the rendered view of a Markdown or CSV/TSV file.
 *
 * The frame owns the four states, so no view has to: `loading` while the bytes arrive, `ready`
 * with the view, `too-large` when the size passes the kind's cap — decided BEFORE any fetch — and
 * `failed` when the fetch or the view throws. The root carries `data-document-preview` and
 * `data-state`, which is what the probes wait on, and `data-pdf-pages` once a PDF view reports its count.
 */
export function DocumentPreview({ kind, name, bytes, load, onDownload }: DocumentPreviewProps) {
  // What this frame has read, tagged with the file it was read for. Tagged rather than cleared when
  // the name changes: the tag is what keeps the PREVIOUS file's bytes from being drawn under the new
  // file's name in the frames between the name arriving and its own bytes arriving.
  const [read, setRead] = useState<{ name: string; read: FrameRead } | null>(null);
  // The caller's loader, held in a ref so the fetch below keys on the NAME and not on the loader's
  // identity: PreviewPane passes a fresh arrow on every render, and depending on it would refetch
  // the file each time anything in that pane re-rendered.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  // The page count the PDF view reported. Held by the frame because the root carries it, and the
  // view has no prop to hand it up through.
  // Tagged with the file it counted, so the count of the PDF the reader has just left never stands
  // as the count of the one they have just opened.
  const [pdfReport, setPdfReport] = useState<{ name: string; pages: number } | null>(null);
  const pdfPages = pdfReport?.name === name ? pdfReport.pages : null;

  const cap = documentCapFor(name);
  // The cap is checked against the size the caller already knows, before a byte is fetched: a file
  // over its kind's cap is never downloaded and then refused, which is the whole point of a cap.
  const tooLarge = cap !== null && bytes !== null && bytes > cap;
  const current = read?.name === name ? read.read : null;
  const state: DocumentFrameState = tooLarge ? 'too-large' : current?.phase ?? 'loading';
  const blob = current?.phase === 'ready' ? current.blob : null;
  const failure = current?.phase === 'failed' ? current.message : null;
  // The registry memoizes one lazy component per kind, so this is the SAME component on every
  // render — never a fresh one that would remount the view and throw away what it drew.
  const View = documentViewFor(kind);
  const reading = (
    <div className="flex flex-1 items-center justify-center p-6">
      <Spinner label={`Reading ${name}…`} />
    </div>
  );

  // One load per name. A new name, a size that turns out to pass the cap, or unmounting aborts the
  // fetch in flight, so a slow file the reader has already left never lands as the one on screen.
  useEffect(() => {
    if (tooLarge) {
      return undefined;
    }
    const controller = new AbortController();
    void loadRef.current(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setRead({ name, read: { phase: 'ready', blob: result } });
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setRead({ name, read: { phase: 'failed', message: failureText(cause) } });
        }
      },
    );
    return () => controller.abort();
  }, [name, tooLarge]);

  /**
   * The frame's `failed` state, in whatever words the failure came with. A view reports through
   * the context and an unexpected throw arrives from the boundary; this is where both end up, so
   * the sentence a reader sees is written once. Held per name, so a view holding a stale callback
   * still fails the file it was drawn for.
   */
  const fail = useCallback(
    (cause: unknown) => setRead({ name, read: { phase: 'failed', message: failureText(cause) } }),
    [name],
  );
  const frame = useMemo<DocumentFrame>(
    () => ({ reportPdfPages: (count: number) => setPdfReport({ name, pages: count }), reportFailure: fail }),
    [fail, name],
  );

  return (
    <div
      data-document-preview={kind}
      data-state={state}
      data-pdf-pages={pdfPages ?? undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      {state === 'loading' && reading}

      {state === 'too-large' && (
        <div className="p-5">
          <EmptyState
            icon={FileDown}
            title="Too large to preview"
            message={`${formatBytes(bytes)} — previews stop at ${formatBytes(cap)}. Download it to open it here.`}
            actionLabel={onDownload ? 'Download' : undefined}
            onAction={onDownload}
          />
        </div>
      )}

      {state === 'failed' && (
        <div className="p-5">
          <EmptyState
            icon={FileX}
            title="Couldn't preview this file"
            message={failure ?? undefined}
            actionLabel={onDownload ? 'Download' : undefined}
            onAction={onDownload}
          />
        </div>
      )}

      {state === 'ready' && blob && (
        <DocumentFrameContext.Provider value={frame}>
          <ViewErrorBoundary onFailure={fail}>
            <Suspense fallback={reading}>
              <View kind={kind} name={name} blob={blob} />
            </Suspense>
          </ViewErrorBoundary>
        </DocumentFrameContext.Provider>
      )}
    </div>
  );
}
