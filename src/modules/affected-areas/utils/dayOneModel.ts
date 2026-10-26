import type { TFunction } from 'i18next';

import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import { capitalized, kindName, spoken } from '@/modules/affected-areas/utils/tourModel';
import type { AreaPhoto, Codebook, DayOneFloor, DayOneObject } from '@/shared/affected-areas-types';
import type { RegionShape } from '@/shared/types';

/*
 * THE DAY-ONE SKETCH'S PURE MODEL: what the drawing and the room list both read off one floor of the plan — every area,
 * fixture and piece of contents with the number it wears on the drawing, its name in words and its look — and how a
 * length is written. Nothing here fetches, holds state, draws, or places anything: every position is the engine's, in
 * 0..1 of the floor's drawing (the browser computes none).
 */

/** One thing laid on the plan that a reader finds by its number: an affected area, a fixture or a piece of contents. */
type SketchItem = {
  /** The area's or the object's id: its outline's id on the drawing, and how a press on it is found. */
  id: string;
  /** The number it wears on the drawing and in the room list (`numberedItems`). */
  number: number;
  group: 'area' | 'fixture' | 'contents';
  /** What it is: the codebook's label for an area's kind, a fixture's name, or a piece of contents' own words. */
  name: string;
  /** The room the plan credits it to; null when the plan names none. */
  roomKey: string | null;
  /** How many photos see it; above 1 the list says "Seen in {n} photos". */
  views: number;
  /** The view that shows it best: a press opens that pano at that face, with its region chosen when it has one. */
  photo: AreaPhoto;
  /** Its outline as `RegionImage` draws it: an area in its look, a fixture or contents in the neutral tone and light wash. */
  shape: RegionShape;
};

/** Lengths in feet are said to the tenth the plan measures them to: "12.7", "8.0". */
const FEET = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A band in feet: "0.2", and a band under a tenth to its hundredth ("0.04") rather than rounded to a claim of none. */
const BAND = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** Inches as a camera height is said: "62.4", and a whole number bare ("63"). */
const INCHES = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** A length in feet, to the tenth. Read by `DayOnePlan` (a loop's closure) and `DayOneRooms` (sizes, checks, ceilings). */
export function feet(value: number): string {
  return FEET.format(value);
}

/** A side's error band in feet. Read by `DayOneRooms`. */
export function band(value: number): string {
  return BAND.format(value);
}

/** A height in inches. Read by `DayOnePlan`'s scale line. */
export function inches(value: number): string {
  return INCHES.format(value);
}

/**
 * The `[x0, y0, x1, y1]` box around a footprint, which `RegionImage` needs for its badge's corner and its stacking. The
 * footprint is the engine's; its box is only where the number sits. A footprint with no usable point has an empty box at
 * the frame's corner, and `RegionImage` draws no outline for it.
 */
function boxOf(footprint: number[][]): number[] {
  const usable = footprint.filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (usable.length === 0) return [0, 0, 0, 0];
  const xs = usable.map((point) => point[0]);
  const ys = usable.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * An object in words: a piece of contents by the layout read's own label ("Dining table"), else "Contents"; a fixture by
 * its kind ("Refrigerator", "Water heater"), and an `other` fixture by its label when it has one. A kind with no words of
 * its own yet is spoken from its key, never shown as the key (INV-76).
 */
function objectName(object: DayOneObject, t: TFunction): string {
  const label = object.label === null || object.label.trim() === '' ? null : capitalized(object.label.trim());
  if (object.kind === 'contents' || object.kind === 'other') return label ?? t(`affectedAreas.dayOne.kinds.${object.kind}`);
  return t(`affectedAreas.dayOne.kinds.${object.kind}`, { defaultValue: capitalized(spoken(object.kind)) });
}

/**
 * Every area, fixture and piece of contents on one floor, each with its number. An area wears the engine's own number
 * (`DayOneArea.number`, counted from 1 per floor in the plan's room order). The wire numbers no object, and a number on
 * the drawing must meet its row in the list beside it (words never sit on the drawing), so the objects are counted on
 * after the floor's last area, in the order the wire lists them: one sequence, no two things numbered alike. The order
 * returned is the drawing's tab order: the areas by number, then the objects.
 *
 * An area is drawn in the look of the member a person stands behind (`area.region`, through `REGION_LOOK`), so the plan
 * and the pano screen draw one area alike; a fixture or contents is drawn in the neutral tone with the light wash, so the
 * room's things read as furniture beside the damage. Read by `DayOnePlan` (the outlines) and `DayOneRooms` (the rows).
 */
export function numberedItems(floor: DayOneFloor, codebook: Codebook | null, t: TFunction): SketchItem[] {
  const areas = [...floor.areas].sort((a, b) => a.number - b.number).map((area): SketchItem => {
    const look = REGION_LOOK[regionState(area.region)];
    const name = kindName(area.class, codebook);
    return {
      id: area.areaId, number: area.number, group: 'area', name, roomKey: area.roomKey, views: area.views, photo: area.photo,
      shape: { id: area.areaId, ordinal: area.number, polygon: area.footprint, box: boxOf(area.footprint), tone: look.tone, edge: look.edge, wash: look.wash, label: name },
    };
  });
  const lastArea = areas.reduce((last, area) => Math.max(last, area.number), 0);
  const objects = floor.objects.map((object, index): SketchItem => {
    const number = lastArea + index + 1;
    const name = objectName(object, t);
    return {
      id: object.objectId, number, group: object.kind === 'contents' ? 'contents' : 'fixture', name, roomKey: object.roomKey, views: object.views, photo: object.photo,
      shape: { id: object.objectId, ordinal: number, polygon: object.footprint, box: boxOf(object.footprint), tone: 'neutral', edge: 'solid', wash: 'light', label: name },
    };
  });
  return [...areas, ...objects];
}
