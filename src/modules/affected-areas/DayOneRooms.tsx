import type { TFunction } from 'i18next';
import { Fragment, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { band, feet, numberedItems } from '@/modules/affected-areas/utils/dayOneModel';
import { capitalized, listWords, roomWords } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, DayOneFloor, DayOneRoom, Face, RoomSide } from '@/shared/affected-areas-types';
import { Badge, Card } from '@/shared/ui';

type DayOneRoomsProps = {
  /** The floor shown: its rooms in the plan's order, and everything laid on them. */
  floor: DayOneFloor;
  /** The kinds' labels; null until the codebook answers. */
  codebook: Codebook | null;
  /** An area or an object pressed in a room: its photo's pano opened at its face, with its region chosen when it has one. */
  onOpenPanoAt: (panoId: string, face: Face, regionId: string | null) => void;
};

/** How a side was closed, in the order the line says them: the measured first, the open last. */
const SOURCES: RoomSide['source'][] = ['measured', 'pinned', 'door_slab', 'open'];

/** The three kinds of thing a room holds, in the order its rows draw them. */
const GROUPS = ['area', 'fixture', 'contents'] as const;

/** "12.7 × 9.3 ft", or what is known of a room a side of which is open: "6.1 ft wide · length not closed". */
function sizeWords(room: DayOneRoom, t: TFunction): string {
  if (room.widthFt !== null && room.lengthFt !== null) return t('affectedAreas.dayOne.rooms.size', { width: feet(room.widthFt), length: feet(room.lengthFt) });
  if (room.widthFt !== null) return t('affectedAreas.dayOne.rooms.widthOnly', { width: feet(room.widthFt) });
  if (room.lengthFt !== null) return t('affectedAreas.dayOne.rooms.lengthOnly', { length: feet(room.lengthFt) });
  return t('affectedAreas.dayOne.rooms.noSize');
}

/** "186.0 sf · 54.8 ft around · ceiling 8.6 ft"; a ceiling no ray reached is said to be unmeasured, never left out. */
function measureWords(room: DayOneRoom, t: TFunction): string {
  return capitalized([
    room.areaSf === null ? null : t('affectedAreas.dayOne.rooms.area', { sf: feet(room.areaSf) }),
    room.perimeterLf === null ? null : t('affectedAreas.dayOne.rooms.perimeter', { ft: feet(room.perimeterLf) }),
    room.ceilingFt === null ? t('affectedAreas.dayOne.rooms.noCeiling') : t('affectedAreas.dayOne.rooms.ceiling', { ft: feet(room.ceilingFt) }),
  ].filter((part) => part !== null).join(' · '));
}

/**
 * Each side's source with its band, the sides closed alike said together: "All four sides measured, within 0.2 ft", or
 * "Left, right and front measured, within 0.4 ft · back open: no wall reached". A group's band is its widest: how far the
 * least sure of its sides could be off. An open side is always said (R-FORGE-1: a band is carried, never hidden).
 */
function sideWords(room: DayOneRoom, t: TFunction): string {
  const groups = SOURCES.map((source) => {
    const sides = room.sides.filter((side) => side.source === source);
    if (sides.length === 0) return null;
    const bands = sides.map((side) => side.bandFt).filter((value) => value !== null);
    const within = bands.length > 0 && source !== 'open' ? { band: band(Math.max(...bands)) } : null;
    if (source === 'measured' && sides.length === 4) return t(within === null ? 'affectedAreas.dayOne.sides.all' : 'affectedAreas.dayOne.sides.allWithin', within ?? {});
    const names = listWords(sides.map((side) => t(`affectedAreas.dayOne.sides.name.${side.side}`)), t);
    return t(`affectedAreas.dayOne.sides.${source}${within === null ? '' : 'Within'}`, { sides: names, ...within });
  }).filter((part) => part !== null);
  return capitalized(groups.join(' · '));
}

/** The room beside the job's own sketch and the first drying report ("Sketch 15.0 × 12.4 ft · First report 186.7 sf, 57.7 ft"); display only. */
function checkWords(room: DayOneRoom, t: TFunction): string {
  const parts = room.checks.map((check) => {
    if (check.source === 'sketch') {
      if (check.widthFt !== null && check.lengthFt !== null) return t('affectedAreas.dayOne.checks.sketch', { width: feet(check.widthFt), length: feet(check.lengthFt) });
      return check.areaSf === null ? null : t('affectedAreas.dayOne.checks.sketchArea', { sf: feet(check.areaSf) });
    }
    const measures = [check.areaSf === null ? null : `${feet(check.areaSf)} sf`, check.perimeterLf === null ? null : `${feet(check.perimeterLf)} ft`].filter((part) => part !== null);
    return measures.length === 0 ? null : t('affectedAreas.dayOne.checks.report', { measures: measures.join(', ') });
  }).filter((part) => part !== null);
  return parts.length === 0 ? t('affectedAreas.dayOne.checks.none') : parts.join(' · ');
}

/**
 * THE ROOMS ON THE SKETCH, one block per room of the shown floor in the plan's order, beside the drawing (under it on a
 * phone). Each block reads:
 * 1. the room's name (never its key, INV-76) and its size on the plan ("12.7 × 9.3 ft"; a room with an open side says
 *    what is known and that the rest is not closed);
 * 2. its area, its perimeter and its ceiling, a ceiling no ray reached said to be unmeasured;
 * 3. its sides: how each was closed (measured, from the next room through a doorway, at the door frame the camera stood
 *    in) with its band, and each open side;
 * 4. on a floor of several rooms, a room pinned to none, in the warn tone: where it sits on the drawing is not measured
 *    against the rest; a room that is no rectangle says so;
 * 5. the same room in the job's own sketch and the first drying report, for the reader to grade the plan by;
 * 6. what lies in it, by kind: its areas, its fixtures, its contents, each kind's numbers the ones the drawing wears, in
 *    their look's tone; an area no longer only proposed says where it stands in the operator's judgment ("Not a change",
 *    "Confirmed", "Drawn by hand", "Unsure"), so a set-aside area never reads as damage by its colour alone; a thing several
 *    photos see says "Seen in {n} photos". A number is a press: it opens that thing's photo at its face, its region chosen.
 *
 * Used by the affected-areas module's `DayOneSketch`, in the column beside `DayOnePlan`.
 */
export function DayOneRooms({ floor, codebook, onOpenPanoAt }: DayOneRoomsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const items = numberedItems(floor, codebook, t);
  const several = floor.rooms.length > 1;

  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col overflow-hidden" data-day-one-rooms="">
      {/* A part of the "Day-one sketch" section (its `h3`), so one level under it. */}
      <h4 id={headingId} className="px-4 pb-2 pt-4 text-xs uppercase tracking-[0.14em] text-ink-faint">{t('affectedAreas.dayOne.rooms.title')}</h4>
      <ul aria-labelledby={headingId} className="m-0 list-none divide-y divide-border border-t border-border p-0">
        {floor.rooms.map((room) => {
          const held = items.filter((item) => item.roomKey === room.roomKey);
          const open = room.sides.some((side) => side.source === 'open');
          return (
            <li key={room.roomKey} data-day-one-room={room.roomKey} className="flex min-w-0 flex-col gap-1 px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{roomWords(room.roomName, null, false, t)}</span>
                <span className="text-[13px] text-foreground">{sizeWords(room, t)}</span>
              </div>
              <p className="text-[12.5px] text-muted-foreground">{measureWords(room, t)}</p>
              <p className="text-[12.5px] text-muted-foreground">{sideWords(room, t)}</p>
              {several && !room.pinned && (
                <p data-tone="warn" className="flex items-start gap-2 text-[12.5px] text-tone-ink">
                  <span aria-hidden="true" className="mt-1.5 size-2 flex-none rounded-full bg-tone-dot" />
                  {t('affectedAreas.dayOne.rooms.unpinned')}
                </p>
              )}
              {!room.rectangular && !open && <p className="text-[12.5px] text-muted-foreground">{t('affectedAreas.dayOne.rooms.notRectangle')}</p>}
              <p className="text-[12.5px] text-muted-foreground">{checkWords(room, t)}</p>

              {held.length === 0 ? (
                <p className="pt-1 text-[12.5px] text-muted-foreground">{t('affectedAreas.dayOne.rooms.nothing')}</p>
              ) : (
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 pt-1.5">
                  {GROUPS.map((group) => {
                    const ofGroup = held.filter((item) => item.group === group);
                    if (ofGroup.length === 0) return null;
                    const kinds = [...new Set(ofGroup.map((item) => item.name))];
                    return (
                      <Fragment key={group}>
                        <dt className="text-xs text-muted-foreground">{t(`affectedAreas.dayOne.rooms.groups.${group}`)}</dt>
                        {/* An area's kind can run long ("Marked with blue tape"), so each takes its own line; a fixture's
                            or a piece of contents' is a word or two, and they flow on together. */}
                        <dd className={group === 'area' ? 'm-0 flex min-w-0 flex-col gap-1' : 'm-0 flex min-w-0 flex-wrap gap-x-3 gap-y-1'}>
                          {kinds.map((kind) => (
                            <div key={kind} className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
                              <span className="mr-0.5 text-[13px] text-foreground">{kind}</span>
                              {ofGroup.filter((item) => item.name === kind).map((item) => {
                                const seen = item.views > 1 ? t('affectedAreas.dayOne.seenIn', { count: item.views }) : null;
                                // Its judgment first (where it stands), then how many photos see it: said and named alike.
                                const notes = [item.judgment, seen].filter((part) => part !== null).join(' · ');
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    aria-label={[`${item.number}. ${item.name}`, notes].filter((part) => part !== '').join(' · ')}
                                    data-day-one-item={item.id}
                                    onClick={() => onOpenPanoAt(item.photo.panoId, item.photo.face, item.photo.regionId)}
                                    className="inline-flex min-h-8 items-center gap-1 rounded-md px-1 hover:bg-background max-md:min-h-11"
                                  >
                                    <Badge as="span" tone={item.shape.tone} className="min-w-[26px] flex-none justify-center border-tone-dot px-1.5 font-bold tabular-nums">
                                      {item.number}
                                    </Badge>
                                    {notes !== '' && <span className="text-xs text-muted-foreground">{notes}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </dd>
                      </Fragment>
                    );
                  })}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
