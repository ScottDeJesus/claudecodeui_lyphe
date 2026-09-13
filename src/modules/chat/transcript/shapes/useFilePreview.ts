import { useContext, useEffect, useId, useState } from 'react';

import { usePaletteOps } from '@/modules/command-palette';
import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { previewKindOf } from '@/modules/chat/transcript/shapes/detect';
import type { PreviewKind } from '@/modules/chat/transcript/shapes/detect';
import { PreviewScopeContext } from '@/modules/chat/transcript/shapes/previewScope';
import { useShapeCollapse, useShapeInteractive } from '@/modules/chat/transcript/shapes/useShapeCollapse';

export type FilePreviewState = {
  /** The loaded preview, or `null` — not a previewable file, not loaded yet, unreadable, or in an export. */
  preview: { kind: PreviewKind; url: string } | null;
  /** Folded by the reader through the chip. Expanded until they fold it, and always in an export. */
  collapsed: boolean;
  toggle: () => void;
};

/** A content type without its parameters: `image/svg+xml; charset=utf-8` is `image/svg+xml`. */
const essenceOf = (type: string): string => type.split(';')[0].trim().toLowerCase();

/** What each kind accepts from the server's content type: a file NAMED `.png` that is not one draws nothing. */
const ACCEPTS: Record<PreviewKind, (type: string) => boolean> = {
  image: (type) => essenceOf(type).startsWith('image/'),
  pdf: (type) => essenceOf(type) === 'application/pdf',
};

/**
 * Can this browser show a PDF inside a frame, pages and all? A phone's browser mostly cannot: Android
 * Chrome offers a download instead, every time the row mounts, and iOS Safari reports a viewer yet
 * draws only a still first page. `navigator.pdfViewerEnabled` is the browser's own answer, and a fine
 * pointer is what tells a desktop from a phone that answers yes; anywhere else the chip opens the file
 * as any other chip does.
 */
const canShowPdf = (): boolean =>
  typeof navigator !== 'undefined'
  && navigator.pdfViewerEnabled === true
  && typeof matchMedia === 'function'
  && matchMedia('(pointer: fine)').matches;

/**
 * The source a preview is given for its bytes.
 *
 * An SVG is a DOCUMENT as well as a picture: opened in a tab of its own, a `blob:` URL runs it in
 * this app's origin, where a script inside it could read the session token. A `data:` URL cannot be
 * opened as a top-level page, so an SVG is handed over as one; every other file is a `blob:` URL,
 * cheaper for large bytes and revoked when the preview unmounts.
 */
const sourceOf = (blob: Blob): Promise<string> =>
  essenceOf(blob.type) === 'image/svg+xml'
    ? new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      })
    : Promise.resolve(URL.createObjectURL(blob));

/**
 * A file reference's preview — a picture or a PDF drawn under its chip — and the fold the chip
 * toggles. Used by `FileChip` alone.
 *
 * The bytes come through the workspace's `readFileReference`, which resolves the path the way a chip
 * click does and reads it with the session's own credentials (a bare `src` cannot carry the auth
 * header, and the path is not a URL this app serves), shared within the reply that names the file
 * (`PreviewScopeContext`). `enabled` is the chip's own say — false where chips are suppressed. Nothing
 * loads in an export (its static render runs no effect), in a reply still streaming, or for a PDF in
 * a browser that cannot show one.
 *
 * It answers `null` until the bytes arrive and when they never do: the chip already names the file,
 * so a missing, unreadable, oversized or mistyped file costs the reader nothing but the preview, and
 * the chip goes on opening the file as it always did.
 *
 * The fold is the shapes' own (`useShapeCollapse`), keyed on the reply and the path, so it survives
 * the row unmounting and a remount does not spring a folded preview open.
 */
export function useFilePreview(path: string, enabled: boolean): FilePreviewState {
  const { readFileReference } = usePaletteOps();
  const interactive = useShapeInteractive();
  const mountScope = useId();
  const provided = useContext(PreviewScopeContext);
  // A row with a scope shares its reads and keeps its fold by it. One without shares nothing: its read
  // is not kept (`readFileReference` with `null`), and its fold lives as long as this mount.
  const scope = typeof provided === 'string' ? provided : null;
  const foldScope = scope ?? `mount:${mountScope}`;
  const kind = previewKindOf(path);
  const active = enabled && interactive && provided !== false && kind !== null && (kind !== 'pdf' || canShowPdf());
  const { collapsed, toggle } = useShapeCollapse(shapeKey('file-preview', `${foldScope}\n${path}`));
  // Tagged with the path it was read for, so a reference that changes under a streaming reply never
  // shows the previous file's preview for the frames before the new one arrives.
  const [loaded, setLoaded] = useState<{ path: string; kind: PreviewKind; url: string } | null>(null);

  useEffect(() => {
    if (!active || kind === null) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    void readFileReference(path, scope)
      .then(async (blob) => {
        if (cancelled || !blob || !ACCEPTS[kind](blob.type)) return;
        const url = await sourceOf(blob);
        if (url.startsWith('blob:')) {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrl = url;
        }
        if (!cancelled) setLoaded({ path, kind, url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [active, kind, path, readFileReference, scope]);

  return {
    preview: active && loaded?.path === path ? { kind: loaded.kind, url: loaded.url } : null,
    collapsed,
    toggle,
  };
}
