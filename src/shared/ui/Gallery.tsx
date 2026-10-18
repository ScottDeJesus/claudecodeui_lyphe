import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GalleryItem } from '@/shared/types';
import { PhotoFill } from '@/shared/ui/PhotoFill';

type GalleryProps = {
  items: GalleryItem[];
  selectedId?: string | null;
  /** Called with a tile's id when it is pressed. Omit it and the tiles are pictures, not buttons. */
  onSelect?: (id: string) => void;
  /** The most tiles drawn. Past it the final tile collapses the rest into "+N"; omit it to draw every item. */
  max?: number;
  /** The list's accessible name (the tiles carry their tags; nothing names the group but this). */
  label: string;
};

/**
 * Used by the affected-areas module for a tour's panos (Verve §10 Media): every tile carries its tag, the
 * final tile collapses the overflow into a count, and the grey tile is the broken-image fallback.
 *
 * With `max` set and more items than that, the first `max - 1` draw as tiles and the final slot stands for
 * the rest — the photo of the first item it hides, under a scrim and "+N" with N counting that item too.
 * Pressing it opens the whole set in place, so a collapsed photo is never out of reach; a selected item that
 * the collapse would hide opens it as well, because a selection the reader cannot see is a lie about the screen.
 * Either way the set STAYS open: a later press on a visible tile moves the selection and the grid does not
 * snap back under the pointer.
 */
export function Gallery({ items, selectedId = null, onSelect, max, label }: GalleryProps) {
  const { t } = useTranslation('common');
  // Whether the whole set is open: the reader pressed the overflow tile, or a selection the collapse would hide
  // forced it. The gallery owns it because the tile must lead somewhere with no help from the caller, who may know
  // nothing of the collapse, and because it is latched — derived from the selection alone, a press on a visible tile
  // after a forced opening would collapse the grid again. A caller that shows a different set gives the gallery a new `key`.
  const [opened, setOpened] = useState(false);

  const slots = max === undefined ? items.length : Math.max(1, Math.floor(max));
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  // The latch is set while rendering, from the props this render was given (the pattern React documents for state that
  // follows a prop): an effect would draw one frame of the collapsed grid with its chosen tile missing.
  if (!opened && items.length > slots && selectedIndex >= slots - 1) setOpened(true);
  const collapsed = items.length > slots && !opened;
  const shown = collapsed ? items.slice(0, slots) : items;
  const hiddenCount = items.length - (slots - 1);

  return (
    <ul aria-label={label} className="vv-gallery">
      {shown.map((item, index) => {
        const overflow = collapsed && index === slots - 1;
        const selected = item.id === selectedId;
        const tile = (
          <>
            <PhotoFill src={item.src} alt="" fit="cover" />
            {overflow ? (
              <>
                <span aria-hidden="true" className="vv-gallery__more absolute inset-0 flex items-center justify-center">
                  +{hiddenCount}
                </span>
                <span className="sr-only">{t('media.showMore', { remaining: hiddenCount })}</span>
              </>
            ) : null}
            <span className="vv-gallery__tag absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate">{item.tag}</span>
            {item.badge ? <span className="vv-gallery__badge absolute right-1.5 top-1.5">{item.badge}</span> : null}
          </>
        );
        // The entrance is a stagger by position, capped so a long set does not take seconds to settle.
        const entrance = { animationDelay: `${Math.min(index, 8) * 50}ms` };

        return (
          <li key={item.id} className="min-w-0">
            {overflow || onSelect ? (
              <button
                type="button"
                style={entrance}
                aria-current={!overflow && selected ? 'true' : undefined}
                onClick={overflow ? () => setOpened(true) : () => onSelect?.(item.id)}
                className="vv-gallery__tile"
              >
                {tile}
              </button>
            ) : (
              <div style={entrance} className="vv-gallery__tile">
                {tile}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
