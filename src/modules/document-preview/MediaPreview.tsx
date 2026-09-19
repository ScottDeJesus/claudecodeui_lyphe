import { useEffect, useState } from 'react';

import type { DocumentViewProps } from '@/shared/types';

/**
 * An audio or video file, played with the browser's own controls.
 *
 * Used by this module's DocumentPreview (through the registry) for both the `audio` and the
 * `video` kinds — one element each, and nothing else differs between them.
 *
 * Audio is a control bar centred in the pane, with the file's name above it so the bar is never
 * anonymous; video fits the pane's width and keeps its own proportions. Both play from the bytes
 * already loaded, so seeking never asks the server again.
 */
export function MediaPreview({ kind, name, blob }: DocumentViewProps) {
  // The bytes as a URL the browser's own player can take. It exists only once the browser has made
  // one, and it is revoked the moment this view stops pointing at it — so a reader who opens ten
  // clips holds one of them, not ten.
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (kind === 'audio') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
        <div className="max-w-full truncate text-sm font-medium">{name}</div>
        <audio controls src={src} aria-label={name} className="w-full max-w-md" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
      <video controls playsInline src={src} aria-label={name} className="block max-h-full w-full rounded-md" />
    </div>
  );
}
