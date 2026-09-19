import type { FilePreview, PreviewChoice, PreviewView } from '@/shared/types';
import { documentCapFor, documentKindFor, textRenderingFor } from '@/modules/document-preview';

/**
 * What the pane shows for one file, and the whole of it.
 *
 * The file manager's pane has three bodies — the editor, a document preview, the read-only arms —
 * and five rules decide between them. They live here and nowhere else: `PreviewPane` renders what
 * this answers and `PreviewHeader` offers Edit and the view toggle from the same answer, so the
 * header and the body cannot come apart (an Edit button over a builder-only arm, a view toggle on
 * a file with one view). A rule in the pane instead of here would be a second opinion about the
 * same file, which is how the two of them drift.
 *
 * The registry is asked what a file IS (`documentKindFor`, `textRenderingFor`, `documentCapFor`)
 * rather than this module testing an extension itself: `document-preview` owns the table, and a
 * new format is a row there, not a branch here.
 */
export function choosePreviewBody(input: {
  preview: FilePreview | null;
  path: string | null;
  editingThis: boolean;
  view: PreviewView;
}): PreviewChoice {
  const { preview, path, editingThis, view } = input;

  // 1. This file is the open edit session: the editor takes the pane whole, so there is nothing to
  //    press Edit on and nothing for a view toggle to switch.
  if (editingThis) {
    return { body: { kind: 'editor' }, canEdit: false, toggle: null };
  }

  // 2. No file selected, or its bytes not read yet: the arms own both the empty pane and the
  //    spinner, and nothing is offered until there is a file to offer it for.
  if (path === null || preview === null) {
    return { body: { kind: 'arms' }, canEdit: false, toggle: null };
  }

  // 3. A kind from the registry's table decides BEFORE the preview's own arm, so a file whose
  //    bytes the server would not call text — a PDF it sniffed, a sheet, a clip — still draws as
  //    the document it is. These are never edited here: the editor is a text editor.
  const document = documentKindFor(path);
  if (document !== null) {
    return { body: { kind: 'document', document }, canEdit: false, toggle: null };
  }

  // 4. A text file the registry gives a rendered view (Markdown, CSV/TSV) and whose bytes are
  //    inside its cap: the table or the rendered page when the reader asked for it, its lines
  //    otherwise, with Edit beside the toggle. The cap is checked here as well as in the frame so
  //    a file too big to draw offers its lines rather than a toggle onto a "Too large" card.
  const rendering = textRenderingFor(path);
  const cap = documentCapFor(path);
  if (rendering !== null && preview.kind === 'text' && cap !== null && (preview.bytes ?? Infinity) <= cap) {
    return {
      body: view === 'rendered' ? { kind: 'document', document: rendering } : { kind: 'arms' },
      canEdit: true,
      toggle: rendering === 'markdown'
        ? { renderedLabel: 'Rendered', sourceLabel: 'Source' }
        : { renderedLabel: 'Table', sourceLabel: 'Text' },
    };
  }

  // 5. Everything else: the arms, which is the lines view for a text file, the measured image for
  //    an image, and the download offer for anything else. Edit belongs to text alone.
  return { body: { kind: 'arms' }, canEdit: preview.kind === 'text', toggle: null };
}
