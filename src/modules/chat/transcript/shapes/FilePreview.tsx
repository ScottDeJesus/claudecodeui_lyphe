import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import { ImageLightbox } from '@/modules/chat/transcript/ChatMessageImages';
import { TRANSCRIPT_GREW_EVENT } from '@/modules/chat/transcript/transcriptGrew';
import type { PreviewKind } from '@/modules/chat/transcript/shapes/detect';

type FilePreviewFrameProps = {
  /** The reference's path. */
  path: string;
  kind: PreviewKind;
  /** The loaded bytes' source, from `useFilePreview`. */
  url: string;
  /** What the file is, when the author said so (`![alt](path)`); the path otherwise. */
  alt?: string;
};

/** A preview grew its row after it painted: say so, so a chat left at its bottom re-pins (`transcriptGrew.ts`). */
const announceGrowth = (event: SyntheticEvent<HTMLElement>) =>
  event.currentTarget.dispatchEvent(new CustomEvent(TRANSCRIPT_GREW_EVENT, { bubbles: true }));

/**
 * The preview under a file chip: the picture itself, or the PDF in the browser's own viewer.
 *
 * Used by `FileChip` alone, which draws it while its reference's preview is loaded and unfolded, and
 * which carries the file's open button beside the chip — nothing is ever drawn over the preview.
 *
 * **Square corners, a hairline border, and nothing on top, on purpose.** A screenshot's corners and
 * edges are content: a rounded frame would clip them and a control in a corner would cover one, and a
 * reader checking a render needs to see the whole shot. The lightbox a click opens is square too.
 *
 * A picture is a button that opens it full size. A PDF is an `iframe` of its bytes as wide as the
 * reply and at most 32rem or 60% of the viewport tall, so it never fills a small window.
 */
export function FilePreviewFrame({ path, kind, url, alt }: FilePreviewFrameProps) {
  const [expanded, setExpanded] = useState(false);
  const label = alt || path;

  return (
    <span data-shape="file-preview" data-kind={kind} data-path={path} data-collapsed="false" className="not-prose mt-1.5 block">
      {kind === 'image' ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          onClick={() => setExpanded(true)}
          className="inline-block max-w-full cursor-zoom-in border border-border/70 bg-card align-top focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* `my-0`: the transcript's prose container gives every `img` a 2em margin, which would be
              drawn as a blank band above and below the picture inside this border. */}
          <img src={url} alt={label} onLoad={announceGrowth} className="my-0 block max-h-80 max-w-full object-contain" />
        </button>
      ) : (
        <iframe
          src={url}
          title={label}
          onLoad={announceGrowth}
          className="block h-[min(32rem,60vh)] w-full border border-border/70 bg-card"
        />
      )}
      {expanded ? <ImageLightbox src={url} alt={label} square onClose={() => setExpanded(false)} /> : null}
    </span>
  );
}
