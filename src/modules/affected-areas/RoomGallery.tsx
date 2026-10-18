import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { panoReadState, roomWords, spansFloors } from '@/modules/affected-areas/utils/tourModel';
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
 * The tile's badge, the pano's state in two words: "3 areas" (or "None found") once all six faces are read, "Partly
 * read" while some are, "Not read" before any is. Areas are the ones standing once marks exist, else every one the
 * reader marked: the same count the pano screen's face strip carries.
 */
function tileBadge(pano: PanoEntry, t: TFunction): string {
  const state = panoReadState(pano);
  if (state !== 'read') return t(`affectedAreas.tour.tile.${state}`);
  const areas = pano.views.reduce((sum, view) => sum + (view.read?.standingCount ?? view.read?.regionsCount ?? 0), 0);
  return areas === 0 ? t('affectedAreas.tour.tile.none') : t('affectedAreas.tour.tile.areas', { count: areas });
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
