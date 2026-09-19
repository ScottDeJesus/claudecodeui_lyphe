import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

import type { DocumentPreviewKind, DocumentViewProps, TextRenderingKind } from '@/shared/types';

/** Every kind the registry holds a row for: the five binary documents and the two rendered texts. */
type DocumentKind = DocumentPreviewKind | TextRenderingKind;

/** One kind of file this module previews: which names it answers to, how big it may be, and its view. */
type DocumentRow = {
  kind: DocumentKind;
  /** Lowercased, with the dot. A file is matched on its LAST extension only. */
  extensions: string[];
  /** Past this many bytes the file is never fetched: the frame says so and offers the download. */
  capBytes: number;
  /** The view's own chunk. Each library is reached from its view alone, so it loads with that view. */
  view: () => Promise<{ default: ComponentType<DocumentViewProps> }>;
};

const MIB = 1024 * 1024;

/**
 * THE table of this module. Every extension, cap and view lives in one row here and nowhere else,
 * so the file manager's routing asks these functions and never tests an extension itself — a new
 * format is one new row, and a pane that disagrees with the frame about a file is impossible.
 */
const DOCUMENT_ROWS: DocumentRow[] = [
  { kind: 'pdf', extensions: ['.pdf'], capBytes: 50 * MIB, view: () => import('@/modules/document-preview/PdfPreview').then((m) => ({ default: m.PdfPreview })) },
  { kind: 'word', extensions: ['.docx'], capBytes: 25 * MIB, view: () => import('@/modules/document-preview/WordPreview').then((m) => ({ default: m.WordPreview })) },
  { kind: 'sheet', extensions: ['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods'], capBytes: 25 * MIB, view: () => import('@/modules/document-preview/SheetPreview').then((m) => ({ default: m.SheetPreview })) },
  { kind: 'audio', extensions: ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac', '.opus'], capBytes: 200 * MIB, view: () => import('@/modules/document-preview/MediaPreview').then((m) => ({ default: m.MediaPreview })) },
  { kind: 'video', extensions: ['.mp4', '.webm', '.mov', '.m4v', '.ogv'], capBytes: 200 * MIB, view: () => import('@/modules/document-preview/MediaPreview').then((m) => ({ default: m.MediaPreview })) },
  { kind: 'markdown', extensions: ['.md', '.markdown', '.mdx'], capBytes: 2 * MIB, view: () => import('@/modules/document-preview/MarkdownRendered').then((m) => ({ default: m.MarkdownRendered })) },
  { kind: 'delimited', extensions: ['.csv', '.tsv'], capBytes: 10 * MIB, view: () => import('@/modules/document-preview/SheetPreview').then((m) => ({ default: m.SheetPreview })) },
];

/** The rows by extension, built once from the table above. */
const ROW_BY_EXTENSION = new Map<string, DocumentRow>(
  DOCUMENT_ROWS.flatMap((row) => row.extensions.map((extension) => [extension, row] as const)),
);

/** One lazy component per kind, so a remount never re-creates it and never re-suspends. */
const VIEW_BY_KIND = new Map<DocumentKind, LazyExoticComponent<ComponentType<DocumentViewProps>>>();

/** A rendered text kind rather than a binary document; the two text kinds keep their lines view. */
const isTextRendering = (kind: DocumentKind): kind is TextRenderingKind => kind === 'markdown' || kind === 'delimited';

/** The row whose extensions hold this path's last extension, or null. A dotfile has none. */
function rowFor(path: string): DocumentRow | null {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? ROW_BY_EXTENSION.get(name.slice(dot).toLowerCase()) ?? null : null;
}

/** The binary document this path previews as, or null when it is not one. */
export function documentKindFor(path: string): DocumentPreviewKind | null {
  const row = rowFor(path);
  return row && !isTextRendering(row.kind) ? row.kind : null;
}

/** The rendered view this text path has beside its lines, or null when it has none. */
export function textRenderingFor(path: string): TextRenderingKind | null {
  const row = rowFor(path);
  return row && isTextRendering(row.kind) ? row.kind : null;
}

/** The byte cap past which this path is not fetched for a preview, or null when no row matches. */
export function documentCapFor(path: string): number | null {
  return rowFor(path)?.capBytes ?? null;
}

/** The view that draws one kind, loaded on its first use and the same component every time after. */
export function documentViewFor(kind: DocumentKind): LazyExoticComponent<ComponentType<DocumentViewProps>> {
  let view = VIEW_BY_KIND.get(kind);
  if (!view) {
    view = lazy(rowOfKind(kind).view);
    VIEW_BY_KIND.set(kind, view);
  }
  return view;
}

/** The row of a kind. Every kind has exactly one, so a miss is a broken table, not a user's file. */
function rowOfKind(kind: DocumentKind): DocumentRow {
  const row = DOCUMENT_ROWS.find((candidate) => candidate.kind === kind);
  if (!row) {
    throw new Error(`No document row for kind ${kind}`);
  }
  return row;
}
