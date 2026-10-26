//----------------- AFFECTED AREAS DAY-ONE CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the day-one sketch in the Tours tab: the room-layout read of a panorama's views,
// the plan drawn from those reads (rooms, where the camera stood, doorways, fixtures and contents, the
// affected areas, the scale and the pins), and where a region lands on that plan.
//
// The one home is shadow-connector's `core/affected_areas/wire_layout.py` (/opt/shadow-connector), and
// this file follows it field for field: look THERE when a shape here seems wrong, and add a field there
// first. The two edit TOGETHER. `affected-areas-types.ts` re-exports every type here by name — import
// them from THERE, as the rest of the tour viewer does — and carries the four fields that reach into this
// file: `ViewEntry.layout`, `Region.placement`, `TourDetail.layout` and `TourDetail.dayOne`.
//
// JSON is camelCase on every route; wire_layout.py's `cls` is the key `class`, and it is a key here too.
// Every date is ISO text (`2026-10-26T08:00:00Z`) and every id is text.
//
// THE FRAME. `x`, `y`, `rect`, `outline`, `footprint`, `a` and `b` are 0..1 of the floor's DRAWING
// frame, y down: the bounding box of the floor's rooms plus a 2 ft margin, drawn by the plan
// (`DayOneFloor.drawingSha` names the drawing). A point is `[x, y]` and a rect `[x0, y0, x1, y1]`. The
// browser lays a marker on the drawing by percent and computes no position of its own; sizes are in the
// unit the field's name says (`Ft`, `In`, `Sf`, `Lf`), never in frame units.
//
// A response field is always present: wire_layout.py dumps a `None` as `null` and an unset list as `[]`.
// A field a later seam fills is typed now and reads `null` until that seam lands — `null` is "not
// judged", never "judged and found nothing".
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.

import type { Budget, Face, Region } from '@/shared/affected-areas-types';

// ---------------------------

//----------------- VOCABULARY ------------

/** `[x, y]` in 0..1 of the floor's drawing frame; the wire does not police the length. */
type Point = number[];

/** `[x0, y0, x1, y1]` in 0..1 of the floor's drawing frame; the wire does not police the length. */
type Box = number[];

// ---------------------------

//----------------- THE LAYOUT READ: A VIEW'S STATE, A PRESS, THE TOUR'S STATUS ------------

/**
 * Whether a view has a layout read, and under which contract. An unread view is `unread` (the rest
 * `null`), not absent.
 */
export type LayoutViewState = {
  status: 'unread' | 'read';
  readId: string | null;
  contractVersion: string | null;
  model: string | null;
  readAt: string | null;
  /**
   * True when the shown read is under today's layout contract hash and the pinned layout model, decided
   * in the engine as `ReadState.current` is for the reader's reads. `null` on an unread view.
   */
  current: boolean | null;
};

/**
 * Where the tour's layout stands, for the screen and the routes alike. `status` is one of:
 * - `none`: no view of the tour has a layout read.
 * - `partial`: the plan in force is drawn from today's inputs and some panos have no layout read.
 * - `built`: the plan in force is drawn from today's inputs and every pano is read.
 * - `stale`: the plan in force was drawn from other inputs than today's (a newer layout read, a moved
 *   tilt, a changed shot group), or a tour that has layout reads has no plan in force yet (a run that
 *   ended before its rebuild); a rebuild from what is stored, with no model, brings it up to date.
 * - `unavailable`: reads exist and no plan could be drawn (DocuSketch unreadable, or no room measurable)
 *   — a rebuild was tried and drew nothing.
 *
 * `stale` wins over `partial`: a plan drawn from other inputs is `stale` whether or not panos are missing
 * reads, since the rebuild comes first. `panosTotal` counts the tour's panos known to the engine;
 * `panosRead` counts the panos whose six views each have a shown layout read; `contractVersions` the
 * layout contract versions of the reads the plan in force was drawn from.
 */
export type LayoutStatus = {
  status: 'none' | 'partial' | 'built' | 'stale' | 'unavailable';
  panosRead: number;
  panosTotal: number;
  builtAt: string | null;
  contractVersions: string[];
};

/** POST /tours/{tourId}/panos/{panoId}/layout, the press: what a read of the pano did or would do. */
export type LayoutReadResult = {
  status: 'read' | 'cached' | 'planned' | 'partial' | 'refused';
  reason: string | null;
  viewsToRead: number;
  viewsRead: number;
  viewsCached: number;
  viewsFailed: number;
  budget: Budget;
  layout: LayoutStatus | null;
};

// ---------------------------

//----------------- THE PLAN'S SCALE AND PINS ------------

/** One known-size thing in the pictures that put the camera's height to the test. */
export type ScaleSource = {
  kind: 'door_slab' | 'tile' | 'appliance';
  /** The camera height this source alone gives. */
  cameraIn: number;
  /** How far that height could be off. */
  bandIn: number;
};

/**
 * The camera's height the plan is drawn at, and what it was checked against. The preset (the stand's
 * stated height) stands only as `unverified`, and the plan says so.
 */
export type ScaleLine = {
  cameraIn: number;
  presetIn: number;
  verdict: 'verified' | 'one_source' | 'unverified';
  sources: ScaleSource[];
};

/** A ring of rooms joined through doorways, and how far the ring fails to close. */
export type PinLoop = {
  /** Room keys. */
  rooms: string[];
  closureFt: number;
};

/** How the rooms were joined into one plan: through doorways and openings seen from both sides. */
export type PinLine = {
  /** Groups of rooms joined together; one is a single connected plan. */
  components: number;
  /** Room keys joined to nothing. */
  unpinnedRooms: string[];
  loops: PinLoop[];
};

// ---------------------------

//----------------- THE PLAN'S ROOMS, SPOTS, OPENINGS, OBJECTS, AREAS ------------

/** One side of a room's rectangle, with where its length came from. */
export type RoomSide = {
  side: 'left' | 'right' | 'front' | 'back';
  ft: number | null;
  /** Carried, never hidden: how far `ft` could be off. */
  bandFt: number | null;
  source: 'measured' | 'pinned' | 'door_slab' | 'open';
};

/** What a source that is not the plan says of the same room, shown beside it and read by no producer. */
export type RoomCheck = {
  source: 'sketch' | 'drying_report';
  widthFt: number | null;
  lengthFt: number | null;
  areaSf: number | null;
  perimeterLf: number | null;
};

/** One room of the plan. `rect` is its regularized rectangle and `outline` the floor it was read as. */
export type DayOneRoom = {
  roomKey: string;
  /** A nameless pano's room has no name (`RoomEntry.roomName`). */
  roomName: string | null;
  floor: number | null;
  panoIds: string[];
  rect: Box | null;
  outline: Point[];
  widthFt: number | null;
  lengthFt: number | null;
  areaSf: number | null;
  perimeterLf: number | null;
  ceilingFt: number | null;
  rectangular: boolean;
  /** Every side has a length. */
  determined: boolean;
  /** Joined to another room through a doorway. */
  pinned: boolean;
  sides: RoomSide[];
  checks: RoomCheck[];
};

/** Where a pano's camera stood. `root` is the pano its room was measured from; the others are extra shots posed onto it. */
export type DayOneSpot = {
  panoId: string;
  roomName: string | null;
  x: number;
  y: number;
  headingDeg: number;
  root: boolean;
};

/** A door, a cased opening or an open wall between two rooms (or a room and outside), as a line from `a` to `b`. */
export type DayOneOpening = {
  kind: 'door' | 'cased' | 'open_wall';
  fromRoomKey: string;
  /** `null`: outside, or a room the plan does not have. */
  toRoomKey: string | null;
  a: Point;
  b: Point;
  widthIn: number | null;
  /** Seen from both sides. */
  pinned: boolean;
};

/** The view that shows an area or an object best, and the region to choose there. */
export type AreaPhoto = {
  panoId: string;
  face: Face;
  /** `null` for an object: it has a layout read, not a region. */
  regionId: string | null;
  ordinal: number | null;
};

/** A fixture or a piece of contents the layout read found, on the plan. */
export type DayOneObject = {
  objectId: string;
  /** The codebook's fixtures, and `contents`. */
  kind: string;
  label: string | null;
  roomKey: string | null;
  footprint: Point[];
  /** How many photos see it. */
  views: number;
  photo: AreaPhoto;
};

/** An affected area on the plan: the photos' regions that are one patch of the room, counted once. */
export type DayOneArea = {
  areaId: string;
  number: number;
  class: string;
  /** The room it is credited to. */
  roomKey: string | null;
  footprint: Point[];
  standing: boolean | null;
  /** How many photos see it. */
  views: number;
  photo: AreaPhoto;
  /** The region `photo` chooses, whole. */
  region: Region;
};

/** One floor's plan: its drawing, its rooms and everything laid on them. */
export type DayOneFloor = {
  floor: number | null;
  /** Names `GET /layout-drawings/{sha256}`, the floor's SVG. */
  drawingSha: string;
  /** The drawing frame's width and length. */
  widthFt: number;
  lengthFt: number;
  rooms: DayOneRoom[];
  spots: DayOneSpot[];
  openings: DayOneOpening[];
  objects: DayOneObject[];
  areas: DayOneArea[];
  scale: ScaleLine;
  pins: PinLine;
};

/** POST /tours/{tourId}/layout/plan: the plan rebuilt from what is stored, with no model. */
export type LayoutPlanResult = {
  layout: LayoutStatus;
  dayOne: DayOneFloor[];
};

// ---------------------------

//----------------- A REGION'S PLACE ON THE PLAN ------------

/**
 * Where a region lands on the plan. `areaId` is the area it is counted in, `views` how many photos see
 * that area; `roomKey` is the room it is credited to, which need not be its photo's.
 */
export type Placement = {
  roomKey: string | null;
  roomName: string | null;
  floor: number | null;
  surface: 'floor' | 'wall' | 'ceiling' | 'outside';
  x: number;
  y: number;
  areaId: string;
  views: number;
};
