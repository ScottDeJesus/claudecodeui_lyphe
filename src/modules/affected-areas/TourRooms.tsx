import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { roomWords } from '@/modules/affected-areas/utils/tourModel';
import type { RoomEntry } from '@/shared/affected-areas-types';
import { Card } from '@/shared/ui';
import { cn } from '@/shared/utils';

type TourRoomsProps = {
  /** The tour's rooms as the lane answers them (`TourDetail.rooms`): one per room key, in DocuSketch's walk order. */
  rooms: RoomEntry[];
};

/**
 * Who calls a room affected, in words: DocuSketch's sketch, the tour's photos, both, or nobody (null). The sketch
 * stays an authority and the photos are a second, so a room says which of them speaks (MAN-3035).
 *
 * The photos speak through `photosAffected` alone, never `regionsStanding`: that count takes in older damage,
 * which never makes a room affected. A null there is "not judged", so it calls nothing affected.
 */
function authorityWords(room: RoomEntry, t: TFunction): string | null {
  const photos = room.photosAffected === true;
  if (room.docusketchAffected && photos) return t('affectedAreas.rooms.affectedBoth');
  if (room.docusketchAffected) return t('affectedAreas.rooms.affectedDocusketch');
  if (photos) return t('affectedAreas.rooms.affectedPhotos');
  return null;
}

/**
 * THE TOUR'S ROOMS: one row per room, in the order DocuSketch walked them, saying which rooms are affected and on
 * whose word.
 *
 * Each row reads as the room's name (never its key, INV-76; "Unnamed room" for a nameless one), its floor ("Floor 2",
 * nothing when the room's panos disagree on it), and under them who calls it affected: "Affected per DocuSketch",
 * "Affected per the photos", or "Affected per DocuSketch and the photos". A room nobody calls affected carries
 * no words.
 *
 * The words are the signal. The dot that leads an affected row is there so the eye finds the affected rooms in a long
 * list. It is warn for all three authorities, Verve's calm amber, the tone the pano screen gives a wet reading, so
 * colour says "affected" and the words say who said so. A row is not a control: it opens nothing, and nothing about it
 * suggests that it does.
 *
 * The rows tile into as many 260 px columns as the panel holds: one on a phone and in a narrow panel, two at 1024,
 * three at 1280, four from about 1440. A forty-room commercial tour runs 497 px tall at 1440 and 684 px at 1280, and
 * about two screens (1,731 px) in one column; the median tour has five rooms. The title stands inside the card, as on
 * every titled card of this module. It has no count: the header's room count is DocuSketch's own and runs higher
 * wherever two names share one room key ("Office2 / Office1" is one row here), so a second number would disagree
 * with the first.
 *
 * Used by the affected-areas module's `TourScreen`, between the context card and the gallery.
 */
export function TourRooms({ rooms }: TourRoomsProps) {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col overflow-hidden">
      <h3 id={headingId} className="px-4 pb-2 pt-4 text-xs uppercase tracking-[0.14em] text-ink-faint">{t('affectedAreas.rooms.title')}</h3>
      {rooms.length === 0 ? (
        <p className="px-4 pb-4 text-[13.5px] text-muted-foreground">{t('affectedAreas.rooms.empty')}</p>
      ) : (
        // Each row draws its hairline under itself, so a row of tiles reads as one line across. The list runs a pixel
        // past the card's clipped bottom edge, which hides the last row's hairline: a short last row leaves no line
        // stopping part way, and the card's own edge closes the list.
        <ul aria-labelledby={headingId} className="m-0 -mb-px grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] border-t border-border p-0">
          {rooms.map((room) => {
            const words = authorityWords(room, t);
            return (
              <li
                key={`${room.roomKey}:${room.floor ?? 'none'}`}
                data-tone={words === null ? undefined : 'warn'}
                className="flex min-w-0 items-start gap-2.5 border-b border-border px-4 py-2.5"
              >
                {/* The dot's column is kept on every row, so the names stand in one line down the list. */}
                <span aria-hidden="true" className={cn('mt-1.5 size-2 flex-none rounded-full', words !== null && 'bg-tone-dot')} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{roomWords(room.roomName, null, false, t)}</span>
                    {room.floor !== null && (
                      <span className="text-xs text-muted-foreground">{t('affectedAreas.rooms.floor', { floor: room.floor })}</span>
                    )}
                  </span>
                  {/* Balanced, so the longest line breaks between its authorities, never strands "areas" alone. */}
                  {words !== null && <span className="text-balance text-[12.5px] text-tone-ink">{words}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
