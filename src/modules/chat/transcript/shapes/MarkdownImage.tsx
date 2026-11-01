import type { ComponentPropsWithoutRef } from 'react';

import { previewKindOf } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { FileChip } from '@/modules/chat/transcript/shapes/InlineMarks';
import { useOutsideImage } from '@/modules/chat/transcript/transcriptPictures';

type MarkdownImageProps = { node?: HastNode } & ComponentPropsWithoutRef<'img'>;

/**
 * The file path a markdown image's `src` names, with the query and fragment cut and percent-encoding undone, or
 * `null` when that path does not end in a picture's extension. react-markdown percent-encodes a URL
 * (`shots/café.png` arrives as `shots/caf%C3%A9.png`), and a path is a NAME on disk, so it is decoded — or
 * kept as written when it is not valid encoding.
 */
const pictureFilePath = (src: string): string | null => {
  const encoded = src.split(/[?#]/)[0];
  let path = encoded;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    path = encoded;
  }
  return previewKindOf(path) === 'image' ? path : null;
};

/**
 * The project file a markdown image's `src` names, or `null` when it names something else.
 *
 * Only a RELATIVE src with a picture's extension is a project file: `.verify/shots/a.png`,
 * `docs/diagram.svg`. A src with a scheme (`https:`, `data:`) and a protocol-relative one (`//cdn/…`)
 * are URLs the browser loads itself, and a root-relative one is `rootedImagePath`'s.
 */
const projectImagePath = (src: string | undefined): string | null => {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/#?\\]/.test(src)) return null;
  return pictureFilePath(src);
};

/**
 * The absolute path a ROOT-RELATIVE markdown image's `src` names (`/tmp/shot.png`), or `null`.
 *
 * In a chat that is a path on the machine the agent works on far more often than an address on this app's
 * origin, and the browser would resolve it against the app and draw whatever page the app answers with:
 * a broken image. `MarkdownImage` decides below which it is.
 */
const rootedImagePath = (src: string | undefined): string | null =>
  src && /^\/(?![/\\])/.test(src) ? pictureFilePath(src) : null;

/** One segment, `/favicon.ico`, `/logo-64.png`: the address of an asset this app serves from its root, not a path somewhere on a disk. */
const APP_ROOT_ASSET = /^\/[^/]+$/;

/**
 * The `img` override, in both component maps. Used by `Markdown.tsx`.
 *
 * A markdown image whose src is a project file is drawn the way a code-span reference to that file
 * is — its chip, labelled with the author's alt text, previewing the picture under it — because the browser
 * would otherwise resolve the relative src against the current route and draw a broken image.
 *
 * **A root-relative src in a chat transcript** (`![shot](/tmp/shot.png)`) is a path on this machine, and is drawn
 * the same way, when the chat can say what it is (`useOutsideImage`): a file under the project or the workspace
 * (the file tree serves it), a copy of the picture from a `Read` of exactly that path in this chat, or a path
 * outside both — which gets the chip with a muted "image outside the project" line and no request. A src of
 * one segment (`/favicon.ico`) is an asset the app serves from its own root, so it and every src outside a chat
 * (the baseline document's `/favicon.ico`) stay react-markdown's own `<img>` with exactly the props it was given,
 * and so does every other image.
 */
export function MarkdownImage({ node: _node, ...props }: MarkdownImageProps) {
  const path = projectImagePath(props.src);
  const rootedPath = rootedImagePath(props.src);
  const outside = useOutsideImage(rootedPath);
  const onThisMachine = rootedPath !== null && (outside.local || (outside.refused && !APP_ROOT_ASSET.test(rootedPath)));
  const chipPath = path ?? (onThisMachine ? rootedPath : null);
  if (!chipPath) return <img {...props} />;
  return (
    <FileChip path={chipPath} line={null} alt={props.alt}>
      {props.alt || chipPath}
    </FileChip>
  );
}
