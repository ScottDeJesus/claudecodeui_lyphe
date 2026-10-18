import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

type PhotoFillProps = {
  src: string | null;
  /** The photo's name for assistive tech; empty when the caller names it some other way (a tile's tag). */
  alt: string;
  /** `fill` stretches to the box exactly (a box that already has the photo's aspect); `cover` crops to it. */
  fit: 'fill' | 'cover';
};

/**
 * Used by `RegionImage` and `Gallery`, the two library pieces that put a photo in a box: the photo filling
 * its positioned parent, or Verve's neutral tile when `src` is null or the photo fails to load. One piece
 * so both draw the broken-image case the same way — Verve's rule is "never a blank cell or a
 * broken-image glyph" — and a failure is remembered per `src`, so a new photo in the same slot gets its own try.
 */
export function PhotoFill({ src, alt, fit }: PhotoFillProps) {
  const { t } = useTranslation('common');
  // The src that last failed to load. Kept as the src itself rather than a boolean: a boolean would need an
  // effect to reset it when the photo changes, and this way a new src is simply not the one that failed.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src === null || failedSrc === src) {
    // Named only when the caller gave a name; a nameless tile is decoration beside a tag that names it.
    const naming = alt === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt };
    return (
      <div {...naming} className="vv-gallery__fallback absolute inset-0 flex items-center justify-center">
        <span aria-hidden="true">{t('media.photo')}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      // A dragged photo would take the press away from a region, a tile or the Lightbox's pan.
      draggable={false}
      onError={() => setFailedSrc(src)}
      className={cn('absolute inset-0 h-full w-full', fit === 'fill' ? 'object-fill' : 'object-cover')}
    />
  );
}
