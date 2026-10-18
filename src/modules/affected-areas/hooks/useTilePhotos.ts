import { useState } from 'react';

import { useImageUrls } from '@/modules/affected-areas/hooks/useImageUrl';
import { GALLERY_MAX } from '@/modules/affected-areas/utils/tourModel';
import type { PanoEntry } from '@/shared/affected-areas-types';

type TilePhotos = {
  /** Each fetched tile photo's object URL by the sha of its pano's Ahead view; null where its bytes did not arrive. */
  photos: Record<string, string | null>;
  /** The gallery's "+N" opened the rest: from now on the hidden panos' photos are fetched too. */
  onOverflowOpen: () => void;
};

/** One sha per pano, the Ahead view's: the photo a gallery tile draws. A pano with no views cut adds none. */
const aheadShas = (panos: PanoEntry[]): string[] =>
  panos.flatMap((pano) => pano.views.filter((view) => view.face === 'ahead').map((view) => view.sha256));

/**
 * The photos of the tour screen's gallery tiles, fetched only for the tiles it draws.
 *
 * The gallery draws `GALLERY_MAX` tiles until its "+N" opens the rest, so a 45-pano tour fetches 24 photos, not 45, and
 * the other 21 only when a person asks for them. The two lists are two reads (`useImageUrls` twice): opening the rest
 * adds the second and leaves the first alone, so the tiles already drawn keep their photos instead of going blank to be
 * fetched again.
 *
 * Nothing is fetched unless the tour screen shows the tour (`panos` is null otherwise), and the opened state is forgotten
 * when it stops showing: the gallery, remounted on the way back, is collapsed again.
 *
 * Used by the affected-areas module's view root, for `TourScreen`'s gallery.
 */
export function useTilePhotos(tourId: string | null, panoId: string | null, panos: PanoEntry[] | null): TilePhotos {
  // The tour whose gallery has opened its rest; null when none has.
  const [openedTourId, setOpenedTourId] = useState<string | null>(null);
  // The open state belongs to the tour screen being on screen. Reset while rendering, from the props this render was
  // given (the pattern React documents for state that follows a prop), so the first frame back is already collapsed.
  const onTourScreen = tourId !== null && panoId === null;
  if (!onTourScreen && openedTourId !== null) setOpenedTourId(null);

  const listed = onTourScreen && panos !== null ? panos : [];
  const drawn = useImageUrls(aheadShas(listed.slice(0, GALLERY_MAX)));
  const rest = useImageUrls(openedTourId === tourId ? aheadShas(listed.slice(GALLERY_MAX)) : []);

  return { photos: { ...drawn, ...rest }, onOverflowOpen: () => setOpenedTourId(tourId) };
}
