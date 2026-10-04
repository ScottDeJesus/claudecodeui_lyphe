import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ChatImage } from '@/shared/types';
import { Lightbox } from '@/shared/ui';

type ChatMessageImagesProps = {
  images: ChatImage[];
  projectId?: string | null;
  /** `end` for a user turn's right-aligned cards (default); `start` for a picture a tool returned, which sits under the assistant's call. */
  align?: 'start' | 'end';
};

/**
 * Resolves one chat image to a displayable src. Inline data URLs are used
 * directly; path-based attachments are fetched as blobs (a bare <img src>
 * cannot carry the auth header) — first from the global assets route
 * (`~/.cloudcli/assets`), then from the project files route as a fallback for
 * sessions recorded before attachments moved to the global store.
 */
function useChatImageSrc(image: ChatImage, projectId?: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(image.data || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.data) {
      setSrc(image.data);
      setFailed(false);
      return;
    }

    const imagePath = image.path;
    if (!imagePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    const filename = imagePath.split(/[\\/]/).pop() || '';
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const candidateRequests: Array<() => Promise<Response>> = [
      () => api.assets.image(filename, { signal: controller.signal }),
      ...(projectId
        ? [() => api.readFileBlob(projectId, imagePath, { signal: controller.signal })]
        : []),
    ];

    const load = async () => {
      setFailed(false);
      for (const requestCandidate of candidateRequests) {
        try {
          const response = await requestCandidate();
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
        }
      }
      setSrc(null);
      setFailed(true);
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.data, image.path, projectId]);

  return { src, failed };
}

/**
 * A picture in the shared full-screen viewer: fitted to the screen, then zoomable and pannable
 * (wheel, pinch, drag, double-click, the +/− buttons). Closes on backdrop click, close button, or Escape.
 *
 * Used by chat's ChatMessageImages and ComposerAttachment to expand a
 * thumbnail to full size, and by the chat's file previews (`shapes/FilePreview.tsx`), which pass
 * `square`: a screenshot's corners are content, and a rounded enlargement would clip them.
 */
export function ImageLightbox({ src, alt, square = false, onClose }: { src: string; alt: string; square?: boolean; onClose: () => void }) {
  return (
    <Lightbox label={alt} onClose={onClose}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={`block max-h-[90vh] max-w-[92vw] object-contain shadow-2xl ${square ? '' : 'rounded-lg'}`}
      />
    </Lightbox>
  );
}

function ChatMessageImage({ image, projectId }: { image: ChatImage; projectId?: string | null }) {
  const { src, failed } = useChatImageSrc(image, projectId);
  const [expanded, setExpanded] = useState(false);
  const alt = image.name || 'Attached image';

  if (failed) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-border/50 bg-muted px-2 text-center text-[10px] text-muted-foreground">
        {alt}
      </div>
    );
  }

  if (!src) {
    return <div className="h-28 w-28 animate-pulse rounded-xl border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Expand ${alt}`}
        className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={src}
          alt={alt}
          className="h-28 w-28 cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
        />
      </button>
      {expanded && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

/**
 * Image attachments for a user turn, rendered claude.ai-style: standalone
 * rounded square cards shown above the message bubble. Each thumbnail
 * expands to a fullscreen lightbox on click.
 *
 * Rendered by chat's MessageComponent for the images attached to a user turn, and by
 * ToolRenderer for the pictures a tool result carries.
 */
export default function ChatMessageImages({ images, projectId, align = 'end' }: ChatMessageImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      {images.map((image, index) => (
        <ChatMessageImage key={`${image.path || image.name || 'image'}-${index}`} image={image} projectId={projectId} />
      ))}
    </div>
  );
}
