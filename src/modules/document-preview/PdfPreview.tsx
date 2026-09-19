import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, RenderingCancelledException } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
// The linter resolves this specifier to pdf.js's worker bundle, which exports nothing: `?url` is
// Vite's, and what it hands back is that file's URL. Nothing else can see the default export.
// eslint-disable-next-line import/default
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { DocumentFrameContext } from '@/modules/document-preview/DocumentPreview';
import { Spinner } from '@/shared/ui';
import type { DocumentViewProps } from '@/shared/types';

// pdf.js draws on the main thread and parses in its worker, and this is where that worker lives.
// The URL import above is the one static pdf.js import outside this view's own chunk: the worker
// (1.27 MB) is fetched when a PDF is first opened, never with the Files tab and never for another
// kind of file.
GlobalWorkerOptions.workerSrc = workerUrl;

/** How close a page must come to the visible area to be drawn, in viewports. */
const DRAW_VIEWPORTS = 1;
/** How far a drawn page must leave the visible area to be released, in viewports. */
const RELEASE_VIEWPORTS = 3;
/** The sharpest backing store a page gets, so a 4× phone does not pay 16× the pixels for it. */
const MAX_PIXEL_RATIO = 3;

/** One page's placeholder: its number and the size of its viewport at scale 1, in PDF points. */
type PdfPageFrame = { number: number; width: number; height: number };

/** The document pdf.js opened, with every page's placeholder: one value, so nothing can draw one document's pages at another's sizes. */
type PdfOpened = { pdf: PDFDocumentProxy; pages: PdfPageFrame[] };

/**
 * A PDF, drawn as a column of pages that each fit the pane's width.
 *
 * Used by this module's DocumentPreview (through the registry) for a `.pdf` file.
 *
 * Every page has its placeholder from the start, sized from its own viewport, so the column is
 * its true height before a single page is drawn and the scrollbar never jumps. A page is drawn
 * only as it nears the visible area and released once it is far away, which is what lets a
 * 400-page file open on a phone. The label under each page is the reader's place in the file, and
 * the count goes up to the frame (`DocumentFrameContext`), whose root carries it as `data-pdf-pages`.
 */
export function PdfPreview({ name, blob }: DocumentViewProps) {
  // The document pdf.js opened, with its pages' placeholder sizes. One piece of state rather than
  // two, so the grid and the observers below can never be drawing one document at another's sizes.
  const [opened, setOpened] = useState<PdfOpened | null>(null);
  // The scroll container itself, held as state rather than a ref because the observers below can
  // only be built against the root they watch through — and they must be rebuilt if it changes.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const loadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  // Every page's canvas, by page number, as React attaches them.
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  // The renders in flight, so releasing a page can cancel its own drawing instead of letting it
  // land on a canvas that has just been cleared.
  const renders = useRef(new Map<number, RenderTask>());
  // The pages whose canvas holds their picture right now, so a page that is already drawn is not
  // drawn again every time it scrolls back into view.
  const drawn = useRef(new Set<number>());
  const frame = useContext(DocumentFrameContext);
  const pages = opened?.pages ?? [];
  // Reported once pdf.js knows it, and not on mount: before a document is open the count is a
  // placeholder zero, and the frame's root would carry `data-pdf-pages="0"` for a nineteen-page file
  // to anyone reading it while the fetch is still running.
  useEffect(() => {
    if (opened) {
      frame.reportPdfPages(opened.pages.length);
    }
  }, [frame, opened]);

  const scrollerRef = useCallback((element: HTMLDivElement | null) => setScroller(element), []);
  const canvasRef = useCallback(
    (pageNumber: number) => (canvas: HTMLCanvasElement | null) => {
      if (canvas) {
        canvases.current.set(pageNumber, canvas);
      } else {
        canvases.current.delete(pageNumber);
      }
    },
    [],
  );

  // Open the document once per blob: read every page's size so the column is its true height from
  // the first frame, and destroy pdf.js's own document when the reader moves on to another file.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        // pdf.js 6 dropped `isEvalSupported`: there is no eval path left in it to disable, so what
        // that option guarded against — running a file's own JavaScript — is the library's default.
        const task = getDocument({ data });
        loadingTask.current = task;
        const pdf = await task.promise;
        if (cancelled) return;
        const frames = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_page, index) => {
            const number = index + 1;
            const viewport = (await pdf.getPage(number)).getViewport({ scale: 1 });
            return { number, width: viewport.width, height: viewport.height };
          }),
        );
        if (!cancelled) {
          setOpened({ pdf, pages: frames });
        }
      } catch (cause) {
        // Reported, not thrown: a file pdf.js cannot read is an answer the frame draws, and a throw
        // from here would reach the browser's own error channel before it reached the boundary.
        if (!cancelled) {
          frame.reportFailure?.(cause);
        }
      }
    })();

    return () => {
      cancelled = true;
      const task = loadingTask.current;
      loadingTask.current = null;
      if (task) {
        void task.destroy();
      }
    };
  }, [blob, frame]);

  // Draw each page as it comes within a viewport of the scroll area, release it once it is more
  // than three away. This is the whole reason a 400-page file opens on a phone: what is on screen
  // is a canvas or two, never four hundred.
  useEffect(() => {
    if (!scroller || !opened) {
      return undefined;
    }
    const { pdf } = opened;
    // This document's own records, taken once: every page drawn or released below moves these, and
    // the cleanup must clear exactly the ones this effect's document filled.
    const inFlight = renders.current;
    const painted = drawn.current;
    let disposed = false;

    const draw = async (number: number, canvas: HTMLCanvasElement): Promise<void> => {
      if (disposed || painted.has(number) || inFlight.has(number) || canvas.clientWidth === 0) {
        return;
      }
      const page = await pdf.getPage(number);
      if (disposed) return;
      // The canvas's CSS width is the pane's width, so the page fits it; the backing store is that
      // many DEVICE pixels, which is what keeps the text sharp instead of blown up from 1×.
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const viewport = page.getViewport({ scale: (canvas.clientWidth / base.width) * ratio });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const task = page.render({ canvas, viewport });
      inFlight.set(number, task);
      try {
        await task.promise;
        painted.add(number);
      } catch (cause) {
        // A released page cancels its own render, and pdf.js reports that as this: the release path
        // working, not a page that failed to draw.
        if (!(cause instanceof RenderingCancelledException)) {
          console.error(`Page ${number} of ${name} did not draw`, cause);
        }
      } finally {
        inFlight.delete(number);
      }
    };

    const release = (number: number, canvas: HTMLCanvasElement) => {
      inFlight.get(number)?.cancel();
      inFlight.delete(number);
      painted.delete(number);
      // A zero-width canvas holds no bitmap at all: this is what gives the memory back.
      canvas.width = 0;
      canvas.height = 0;
    };

    const drawObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          void draw(Number(canvas.dataset.pdfPage), canvas);
        }
      },
      { root: scroller, rootMargin: `${DRAW_VIEWPORTS * 100}% 0px` },
    );

    const releaseObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          release(Number(canvas.dataset.pdfPage), canvas);
        }
      },
      { root: scroller, rootMargin: `${RELEASE_VIEWPORTS * 100}% 0px` },
    );

    for (const canvas of canvases.current.values()) {
      drawObserver.observe(canvas);
      releaseObserver.observe(canvas);
    }

    return () => {
      disposed = true;
      drawObserver.disconnect();
      releaseObserver.disconnect();
      for (const task of inFlight.values()) {
        task.cancel();
      }
      inFlight.clear();
      painted.clear();
    };
  }, [name, opened, scroller]);

  return (
    <div
      ref={scrollerRef}
      role="region"
      aria-label={name}
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto bg-muted/40"
    >
      {pages.length === 0 && (
        <div className="flex justify-center p-6">
          <Spinner label={`Opening ${name}…`} />
        </div>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-3 md:p-5">
        {pages.map((page) => (
          <figure key={page.number} className="flex flex-col gap-1.5">
            <div
              className="relative w-full overflow-hidden rounded-md bg-card shadow-sm ring-1 ring-border"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              <canvas
                ref={canvasRef(page.number)}
                data-pdf-page={page.number}
                role="img"
                aria-label={`Page ${page.number} of ${name}`}
                className="absolute inset-0 block size-full"
              />
            </div>
            <figcaption className="text-center text-xs tabular-nums text-ink-faint">
              Page {page.number.toLocaleString('en-US')} of {pages.length.toLocaleString('en-US')}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
