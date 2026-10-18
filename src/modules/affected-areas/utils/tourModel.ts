import type { TFunction } from 'i18next';

import type { Codebook, Face, PanoEntry, Region, TourSummary, ViewDetail, ViewEntry } from '@/shared/affected-areas-types';
import { formatRelativeTime, formatShortDate } from '@/shared/utils';

/*
 * THE TOURS VIEW'S PURE MODEL: what the screens read off the wire before they draw it — the six faces in their
 * order, how far a pano or a tour is read, and the names a person reads in place of ids (INV-76). Nothing here
 * fetches, holds state or draws.
 */

/** A pano's six faces, in the order the face strip offers them. The reader cuts every pano into these six. */
export const FACES: readonly Face[] = ['ahead', 'right', 'behind', 'left', 'ceiling', 'floor'];

/** How far something is read: nothing yet, some of it, or all of it. */
type ReadExtent = 'unread' | 'partly' | 'read';

/**
 * How far one pano is read: `read` once all six faces carry a read, `unread` while none does (a pano with no
 * views cut included), `partly` between. Read by the gallery's badge.
 */
export function panoReadState(pano: PanoEntry): ReadExtent {
  const read = pano.views.filter((view) => view.read?.status === 'read').length;
  if (read === 0) return 'unread';
  return read >= FACES.length ? 'read' : 'partly';
}

/**
 * How far a whole tour is read, against the six views EVERY pano has (as shadow-connector's own tour plan counts
 * them), not against the views cut so far: a tour whose cut views are all read but which still has panos never cut
 * is `partly`, never `read`. Read by the picker's rows and the tour screen's header.
 */
export function tourReadState(tour: TourSummary): ReadExtent {
  if (tour.viewsRead === 0) return 'unread';
  return tour.viewsRead >= tour.panoCount * FACES.length ? 'read' : 'partly';
}

/**
 * What Read the rest would still read on a tour: its panos with a face not read yet (a pano never cut included) and
 * those panos' unread views, six for a pano never cut. The press says both before it spends — "45 panos · 270 views
 * not read yet" — because a walk of a whole tour buys every one of them. Read by the view root.
 */
export function tourUnread(panos: PanoEntry[]): { panos: number; views: number } {
  const unread = panos
    .map((pano) => FACES.length - pano.views.filter((view) => view.read?.status === 'read').length)
    .filter((views) => views > 0);
  return { panos: unread.length, views: unread.reduce((sum, views) => sum + views, 0) };
}

/**
 * The tour's name as a person reads it: the job's, else its address, else a sentence saying it has neither.
 * Never its id (INV-76). Read by the picker's rows, the tour screen's title and the pano screen's way back.
 */
export function tourName(tour: TourSummary, t: TFunction): string {
  return tour.jobLabel ?? tour.address ?? t('affectedAreas.tour.unnamed');
}

/**
 * One line of what a tour holds and how far it is read: "Captured Oct 12 · 12 panos · 42 of 42 cut views read · 5 panos
 * not cut · 26 areas found · last read 2h ago", or "45 panos · none cut yet"; "12 panos in 5 rooms" when `withRooms`
 * (the tour screen, which has the room to). The views are counted against those cut, as the operator worded it, and
 * the panos never cut are named beside them, so a tour whose cut views are all read never reads as done. A pano is cut
 * whole, six views at once (`viewsTotal` counts whole cuts only). Areas are the ones standing once marks exist, else
 * every one the reader marked. Read by the picker's rows and the tour screen's header.
 */
export function tourFacts(tour: TourSummary, t: TFunction, withRooms: boolean): string {
  const captured = formatShortDate(tour.capturedAt);
  const panos = t('affectedAreas.tour.panos', { count: tour.panoCount });
  const uncut = Math.max(0, tour.panoCount - Math.round(tour.viewsTotal / FACES.length));
  const areas = tour.regionsStanding ?? tour.regionsTotal;
  return [
    captured === null ? null : t('affectedAreas.tour.captured', { date: captured }),
    withRooms ? t('affectedAreas.tour.inRooms', { panos, rooms: t('affectedAreas.tour.rooms', { count: tour.roomCount }) }) : panos,
    tour.viewsTotal === 0 ? t('affectedAreas.tour.noneCut') : t('affectedAreas.tour.views', { read: tour.viewsRead, cut: tour.viewsTotal }),
    tour.viewsTotal > 0 && uncut > 0 ? t('affectedAreas.tour.uncut', { count: uncut }) : null,
    tour.viewsRead > 0 && areas > 0 ? t('affectedAreas.tour.areas', { count: areas }) : null,
    tour.lastReadAt === null ? null : t('affectedAreas.tour.lastRead', { when: formatRelativeTime(tour.lastReadAt) }),
  ].filter((part) => part !== null).join(' · ');
}

/**
 * A pano's room in words: "Kitchen", or "F2 · Kitchen" when `withFloor` (a tour that spans floors, where the room's
 * name alone would not say which kitchen). The floor comes first and short because a gallery tag is a hundred pixels
 * wide: a long room name loses its tail, never its floor. A pano with no room is "Unnamed room". Read by the
 * gallery's tags, the tour's room list and the pano screen's title (the last two name the floor in words of their
 * own, so pass no `withFloor`).
 */
export function roomWords(roomName: string | null, floor: number | null, withFloor: boolean, t: TFunction): string {
  const room = roomName ?? t('affectedAreas.tour.unnamedRoom');
  return withFloor && floor !== null ? t('affectedAreas.tour.roomOnFloor', { room, floor }) : room;
}

/** Whether a tour's panos stand on more than one floor, so a room's words must name its floor. */
export function spansFloors(panos: PanoEntry[]): boolean {
  return new Set(panos.map((pano) => pano.floor).filter((floor) => floor !== null)).size > 1;
}

/**
 * A wire key as words: `engineered_wood` reads "engineered wood", `RESIDENTIAL` reads "residential". The key is
 * data (a codebook material, a surface, a drying class), so it is spoken as it is and never translated.
 */
export function spoken(key: string): string {
  return key.replace(/_/g, ' ').toLowerCase();
}

/** "DocuSketch", "DocuSketch and the job", "DocuSketch, the job and drying reports": a list said as English says it. */
export function listWords(items: string[], t: TFunction): string {
  if (items.length < 2) return items.join('');
  return t('affectedAreas.list', { rest: items.slice(0, -1).join(', '), last: items[items.length - 1] });
}

/** The same words opening a sentence: "Engineered wood". */
export function capitalized(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A kind as a person reads it: the codebook's label ("Material removed"), or its key spoken ("Removed material") until
 * the codebook answers — never the key itself (INV-76). Read by the marking pieces: `MarkPresses`, `MarkBar`,
 * `FacePhoto` and `MarkQueue`.
 */
export function kindName(cls: string, codebook: Codebook | null): string {
  return codebook?.classes.find((kind) => kind.key === cls)?.label ?? capitalized(spoken(cls));
}

/**
 * The kind an area counts as: the one the operator renamed it to when its newest mark is a rename, else the one the
 * reader gave it. It is shadow-connector's `effective_class` read off the mark the wire carries, because the wire's
 * `class` stays the reader's after a rename. Read by `MarkPresses` and `MarkBar`.
 */
export function countedKind(region: Region): string {
  return region.mark?.verdict === 'rename' && region.mark.newClass !== null ? region.mark.newClass : region.class;
}

/**
 * A face's areas and the regions set aside on it; undefined while the face is unread. Once the pano has answered, both
 * are counted off its regions, so together they are every outline drawn: set aside is `standing === false` (unsure, or
 * marked not a change) and the areas are the rest, as the engine's own count holds them. Before it answers, the
 * tour's listing gives the areas alone (standing once marks exist, else every one the reader marked). Read by the
 * pano screen's face strip and caption.
 */
export function faceCounts(view: ViewEntry | ViewDetail | undefined): { areas: number; setAside: number } | undefined {
  const read = view?.read;
  if (view === undefined || read?.status !== 'read') return undefined;
  if ('regions' in view) {
    const setAside = view.regions.filter((region) => region.standing === false).length;
    return { areas: view.regions.length - setAside, setAside };
  }
  return { areas: read.standingCount ?? read.regionsCount, setAside: 0 };
}
