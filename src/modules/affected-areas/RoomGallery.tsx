import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { listedAreas, panoReadState, roomWords, spansFloors } from '@/modules/affected-areas/utils/tourModel';
import type { PanoEntry } from '@/shared/affected-areas-types';
import type { GalleryItem } from '@/shared/types';
import { Gallery } from '@/shared/ui';

type RoomGalleryProps = {
  /** The tour's panos, in the tour's own order. */
  panos: PanoEntry[];
  /** Each tile's photo, by the sha of its pano's Ahead view; a sha with no photo here draws the neutral tile. */
  photos: Record<string, string | null>;
  /** The gallery's accessible name: whose panos these are. */
  label: string;
  onOpenPano: (panoId: string) => void;
};

/**
 * The most tiles drawn before the last one collapses the rest into "+N": three rows at a desk, eight on a phone.
 * A forty-five pano tour opens on twenty-three and the count, and one press opens the rest in place.
 */
const GALLERY_MAX = 24;

/**
 * The tile's badge, the pano's state in two words: "3 areas" once all six faces are read and some stand, "2 found"
 * when the reader found some and none stands yet (no mark and no line set), "None found" when it found none, "Partly
 * read" while some faces are, "Not read" before any is. Areas are the ones standing: the same count the pano screen's
 * face strip carries.
 */
function tileBadge(pano: PanoEntry, t: TFunction): string {
  const state = panoReadState(pano);
  if (state !== 'read') return t(`affectedAreas.tour.tile.${state}`);
  const listed = pano.views.flatMap((view) => (view.read === null ? [] : [listedAreas(view.read)]));
  const areas = listed.reduce((sum, view) => sum + view.standing, 0);
  const found = listed.reduce((sum, view) => sum + view.found, 0);
  if (areas > 0) return t('affectedAreas.tour.tile.areas', { count: areas });
  return found > 0 ? t('affectedAreas.tour.tile.found', { count: found }) : t('affectedAreas.tour.tile.none');
}

/**
 * A TOUR'S PANOS as Verve's gallery: one square tile each, the photo its Ahead view, the tag its room (with the floor
 * when the tour spans floors, so two kitchens are told apart), the badge how far it is read and what was found. A pano
 * with no views cut has no photo, so its tile is the neutral one. Pressing a tile opens the pano.
 *
 * Used by the affected-areas module's `TourScreen`, which keys it by tour: the gallery's open overflow belongs to
 * one tour's set.
 */
export function RoomGallery({ panos, photos, label, onOpenPano }: RoomGalleryProps) {
  const { t } = useTranslation();
  const withFloor = spansFloors(panos);
  const items: GalleryItem[] = panos.map((pano) => {
    const ahead = pano.views.find((view) => view.face === 'ahead');
    return {
      id: pano.panoId,
      src: ahead === undefined ? null : photos[ahead.sha256] ?? null,
      tag: roomWords(pano.roomName, pano.floor, withFloor, t),
      badge: tileBadge(pano, t),
    };
  });
  return <Gallery items={items} max={GALLERY_MAX} label={label} onSelect={onOpenPano} />;
}
