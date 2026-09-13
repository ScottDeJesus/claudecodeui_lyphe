import type { ComponentPropsWithoutRef } from 'react';

import { previewKindOf } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { FileChip } from '@/modules/chat/transcript/shapes/InlineMarks';

type MarkdownImageProps = { node?: HastNode } & ComponentPropsWithoutRef<'img'>;

/**
 * The project file a markdown image's `src` names, or `null` when it names something else.
 *
 * Only a RELATIVE src with a picture's extension is a project file: `.verify/shots/a.png`,
 * `docs/diagram.svg`. A src with a scheme (`https:`, `data:`), a protocol-relative one (`//cdn/…`),
 * and a root-relative one (`/favicon.ico`) are URLs the browser loads itself — the last is served by
 * this app's own origin, and the baseline document pins it as a native `<img>`.
 */
const projectImagePath = (src: string | undefined): string | null => {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/#?\\]/.test(src)) return null;
  const encoded = src.split(/[?#]/)[0];
  // react-markdown percent-encodes a URL (`shots/café.png` arrives as `shots/caf%C3%A9.png`), and a
  // project path is a NAME on disk, so it is decoded — or kept as written when it is not valid encoding.
  let path = encoded;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    path = encoded;
  }
  return previewKindOf(path) === 'image' ? path : null;
};

/**
 * The `img` override, in both component maps. Used by `Markdown.tsx`.
 *
 * A markdown image whose src is a project file is drawn the way a code-span reference to that file
 * is — its chip, labelled with the author's alt text, previewing the picture under it — because the browser
 * would otherwise resolve the relative src against the current route and draw a broken image. Every
 * other image is react-markdown's own `<img>` with exactly the props it was given.
 */
export function MarkdownImage({ node: _node, ...props }: MarkdownImageProps) {
  const path = projectImagePath(props.src);
  if (!path) return <img {...props} />;
  return (
    <FileChip path={path} line={null} alt={props.alt}>
      {props.alt || path}
    </FileChip>
  );
}
