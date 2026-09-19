import { useCallback, useContext, useEffect, useState } from 'react';

import type { DocumentViewProps } from '@/shared/types';
import { DocumentFrameContext } from '@/modules/document-preview/DocumentPreview';

/**
 * A Word document, drawn page by page the way Word lays it out.
 *
 * Used by this module's DocumentPreview (through the registry) for a `.docx` file.
 *
 * The renderer writes its pages into `body` and its stylesheet into `style`; this component owns
 * only the ground they sit on. The renderer's own wrapper paints a grey slab, so the scroll
 * container re-grounds it — transparent behind, a Verve shadow and radius on each page, which stays
 * paper-white with the document's own ink in both themes. A page keeps its real width, so a pane
 * narrower than the page (every phone) scrolls sideways rather than squeezing the text into a
 * column the document was never set in.
 */
export function WordPreview({ name, blob }: DocumentViewProps) {
  // The two elements docx-preview writes into: the pages, and the stylesheet it builds from the
  // document's own fonts, margins and page sizes. State rather than refs because the render can
  // only start once both are on the page, and each is emptied again when the reader moves on.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<HTMLStyleElement | null>(null);
  const frame = useContext(DocumentFrameContext);

  const styleRef = useCallback((element: HTMLStyleElement | null) => setStyle(element), []);
  const bodyRef = useCallback((element: HTMLDivElement | null) => setBody(element), []);

  // One render per blob, into the two elements this component owns. docx-preview is imported here,
  // so the 350 KB library is fetched when a Word file is opened and never with the Files tab.
  useEffect(() => {
    if (!body || !style) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        await renderAsync(blob, body, style, {
          inWrapper: true,
          useBase64URL: true,
          ignoreLastRenderedPageBreak: true,
        });
      } catch (cause) {
        // Reported, not thrown: a file the renderer cannot read is an answer the frame draws, and a
        // throw from here would reach the browser's own error channel before it reached the boundary.
        if (!cancelled) {
          frame.reportFailure?.(cause);
        }
      }
    })();

    return () => {
      cancelled = true;
      // The pages and the stylesheet are this file's; the next file must not inherit either.
      body.replaceChildren();
      style.replaceChildren();
    };
  }, [blob, body, frame, style]);

  return (
    <div
      role="region"
      aria-label={name}
      tabIndex={0}
      className="min-h-0 flex-1 overflow-auto bg-muted/40 [&_.docx-wrapper>section.docx]:rounded-md [&_.docx-wrapper>section.docx]:shadow-md [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-3 md:[&_.docx-wrapper]:p-5"
    >
      <style ref={styleRef} />
      <div ref={bodyRef} className="w-max min-w-full">
        {/* docx-preview renders the document's pages into this element. */}
      </div>
    </div>
  );
}
