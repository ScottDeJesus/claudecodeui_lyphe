import { lazy } from 'react';

/**
 * The document-preview capability: the frame that draws a file's bytes as a PDF, a Word document,
 * a sheet, a media clip or a rendered text, and the registry that says what a file name is.
 *
 * THE CONTRACT, and the whole of it:
 *
 * - `DocumentPreview` takes `{ kind, name, bytes, load, onDownload }`. The caller owns the project
 *   and the path; this module owns neither, and holds no API. It gets the bytes only through
 *   `load(signal)` — a `Promise<Blob>` the caller resolves against whatever it fetches with — and
 *   every kind's view receives the same `{ kind, name, blob }`.
 * - The cap is checked BEFORE the load. A file whose `bytes` pass its kind's cap is never
 *   fetched, however cheap the request would be. The frame has exactly four states — `loading`,
 *   `ready`, `too-large`, `failed` — and carries them on its root as `data-state`, beside
 *   `data-document-preview` and, once pdf.js knows it, `data-pdf-pages`.
 * - `documentRegistry.ts` is the ONE home of every kind, extension, byte cap and view. Nothing
 *   else in this module tests an extension; the file manager asks `documentKindFor`,
 *   `textRenderingFor` and `documentCapFor` and lets those answer.
 * - Every view is a `lazy()` chunk of its own, fetched when a file of that kind opens. docx-preview
 *   and SheetJS are dynamic `import()`s inside their view's own effect. pdf.js is the exception and
 *   is still on demand: `PdfPreview` — itself a chunk no other file pulls in — imports pdf.js's
 *   library entry at its top, and imports its worker as a URL, a file the browser fetches only when
 *   pdf.js starts that worker. Nothing here is reachable from the Files tab's own chunk.
 *
 * What is deliberately NOT here: images and plain text (the file manager's own arms draw those),
 * `.pptx` and every office format with no library behind it, and the file editor, which is its own
 * capability (src/modules/file-editor). The registry's rows are the entire list of what previews
 * here — a new format is one new row, and nothing else.
 */

// Lazy: the frame loads when the first document opens, not with the Files tab, and each view it
// draws is a further chunk of its own — so a tab that never opens a PDF never fetches pdf.js.
export const DocumentPreview = lazy(() => import('@/modules/document-preview/DocumentPreview').then((m) => ({ default: m.DocumentPreview })));

export { documentKindFor, textRenderingFor, documentCapFor } from '@/modules/document-preview/documentRegistry';
