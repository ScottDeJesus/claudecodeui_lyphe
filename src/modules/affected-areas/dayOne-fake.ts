import type {
  DayOneArea, DayOneFloor, DayOneObject, DayOneRoom, Face, LayoutReadResult, LayoutStatus, PinLine, Region, RoomCheck, RoomSide, ScaleLine,
} from '@/shared/affected-areas-types';
import type { TourReaderProgress } from '@/shared/types';

/*
 * FAKE DAY-ONE DATA, for the scaffold's fixtures only: Clarence Tse's tour (6ad29b4c93d5140395dcaa76) as the day-one plan
 * would draw it, typed by the wire's mirror, so every state of `DayOneSketch` can be mounted and photographed before the
 * engine draws a plan. Nothing in the app imports this file; `.verify/affected-areas-day-one-scaffold.mjs` does.
 *
 * Modelled on the design's numbers: seven rooms at their sizes in feet, laid out with their doorways, the eight panos'
 * spots (the Dinning Room's second shot posed onto its root), and the kitchen's areas taken from its real regions
 * (`GET /tours/6ad29b4c93d5140395dcaa76/panos/6ad29b4c12f14e4d72c81901`, 2026-10-26; `sphere` left empty), one of them
 * credited to the Dinning Room. Rooms, things and spots are written in feet and put in the 0..1 drawing frame here, the
 * frame being the rooms' box plus 2 ft: in the app that is the engine's work, never the browser's. The drawing is a stand-in
 * for the engine's SVG: a picture with its own white ground, which reads the same in both themes as a photograph does.
 */

/** A rectangle in feet on the floor: `[x0, y0, x1, y1]`, y down. */
type Ft = [number, number, number, number];
/** A room in feet. `how` closes its four sides, left · right · front · back: m measured, p pinned, d at a door slab, o open. */
type RoomSpec = { key: string; name: string; at: Ft; ceiling: number | null; bands: number[]; how: string; pinned: boolean; checks?: RoomCheck[] };
type ThingSpec = { id: string; room: string; kind: string; label?: string; at: Ft; views?: number; pano: string; face: Face };
type AreaSpec = { room: string; at: Ft; views?: number; region: Region; pano: string; face: Face };
type FloorSpec = {
  floor: number | null; sha: string; rooms: RoomSpec[]; spots: [string, string, number, number, boolean][];
  openings: [DayOneRoom['roomKey'], string | null, 'door' | 'cased' | 'open_wall', number, number, number, number, boolean][];
  things: ThingSpec[]; areas: AreaSpec[]; scale: ScaleLine; pins: PinLine;
};

const MARGIN_FT = 2;
const KITCHEN = '6ad29b4c12f14e4d72c81901';
const LAUNDRY = '6ad29b4c8b48cc3fed32a4d0';
const ENTRY = '6ad29b4d93d5140395dcaa79';
const BATH = '6ad29b4d12f14e4d72c81904';
const DINING = '6ad29b4d93d5140395dcaa7b';
const DINING_2 = '6ad29b4d8b48cc3fed32a4d3';
const LIVING = '6ad29b4d12f14e4d72c81906';
const CLOSET = '6ad29b4e12f14e4d72c81907';

const MARKED_AT = '2026-10-23T19:13:48Z';

/** A region as the wire carries it, its polygon its box unless given. */
function region(regionId: string, ordinal: number, cls: string, label: string | null, box: number[], more: Partial<Region> = {}): Region {
  const [x0, y0, x1, y1] = box;
  return {
    regionId, source: 'model', ordinal, class: cls, effectiveClass: cls, label, basis: 'seen', evidence: null, confidence: 0.9,
    polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], box, sphere: [], areaFrac: (x1 - x0) * (y1 - y0), holdout: false,
    mark: null, standing: false, threshold: null, placement: null, ...more,
  };
}

const missed = (markId: string) => ({ markId, verdict: 'missed' as const, newClass: null, note: null, queue: 'browse' as const, markedBy: 'scott', markedAt: MARKED_AT });
const judged = (markId: string, verdict: 'confirm' | 'not_a_change') => ({ ...missed(markId), verdict });
const tape = 'blue tape strip on base of cabinet or appliance';

// The kitchen pano's real regions (its Ahead and Floor views), as the reader marked them and the operator drew two.
const K = {
  leftWall: region('d1a8fb68-9f99-4541-b687-8ec5b71eb8aa', 1, 'tape_marked', 'lower left wall', [0, 0.965, 0.35, 1], { evidence: 'blue tape line above the floor', holdout: true, polygon: [[0, 0.975], [0.35, 0.965], [0.35, 1], [0, 1]] }),
  rightWall: region('f7b04405-7949-4fa5-a6b5-50a1c547f65e', 2, 'tape_marked', 'lower right wall', [0.77, 0.945, 0.88, 1], { evidence: 'blue tape line above the floor', polygon: [[0.77, 0.955], [0.88, 0.945], [0.88, 1], [0.77, 1]] }),
  dehu: region('85d105d0-cb35-4ecd-af5d-da8dc1fbddca', 1, 'drying_equipment', 'Dehumidifier', [0.538, 0.155, 0.695, 0.42], { evidence: 'blue dehumidifier unit on floor', confidence: 0.95 }),
  floorX1: region('0f0bc680-c491-4fc0-9128-2291914bf9d8', 2, 'tape_marked', 'Tape mark on floor', [0.08, 0.025, 0.155, 0.075], { evidence: 'blue tape X on floor tile' }),
  floorX2: region('dd2977b3-6c93-447e-86d2-bd6554806ef5', 3, 'tape_marked', 'Tape mark on floor', [0.425, 0.425, 0.5, 0.515], { evidence: 'blue tape X on floor tile' }),
  cabinet1: region('38fa7497-3730-4705-bd27-f151aedbf65a', 4, 'tape_marked', 'Tape on cabinet base', [0.84, 0.115, 0.87, 0.24], { evidence: tape }),
  cabinet2: region('6bab8152-139f-4801-a11a-bb990688d45c', 5, 'tape_marked', 'Tape on cabinet base', [0.885, 0.52, 0.915, 0.73], { evidence: tape }),
  fridge: region('a4ff33b1-e2a5-4f98-8f2a-dfec7d878b52', 6, 'tape_marked', 'Tape on appliance base', [0.185, 0.755, 0.21, 0.835], { evidence: 'blue tape strip on base of refrigerator' }),
  drawn1: region('487601c6-0aa3-4b5e-b4a9-f0fff73cd13b', 7, 'tape_marked', null, [0.68482, 0.787214, 0.833848, 0.820669], { source: 'human', confidence: null, standing: true, mark: missed('c959a09e-ad05-43d6-a2e9-be340cb59ec0') }),
  drawn2: region('f66c1f7b-8043-4927-929a-90061cf708e3', 8, 'tape_marked', null, [0.258011, 0.817627, 0.340129, 0.858179], { source: 'human', confidence: null, standing: true, mark: missed('a51fce58-d1e1-4a34-8516-e2e8c5b30741') }),
};

const ROOMS: RoomSpec[] = [
  { key: 'kitchen||', name: 'Kitchen', at: [0, 10.6, 12.7, 19.9], ceiling: 8.0, bands: [0.1, 0.2, 0.1, 0.2], how: 'mmmm', pinned: true,
    checks: [{ source: 'sketch', widthFt: 12.7, lengthFt: 9.3, areaSf: 118.1, perimeterLf: 44.0 }, { source: 'drying_report', widthFt: null, lengthFt: null, areaSf: 118.6, perimeterLf: 44.2 }] },
  { key: 'laundry||', name: 'Laundry Room', at: [6.8, 19.9, 12.7, 25.7], ceiling: 8.0, bands: [0.1, 0.1, 0.1, 0.2], how: 'mmmd', pinned: true,
    checks: [{ source: 'sketch', widthFt: 5.9, lengthFt: 5.8, areaSf: 34.2, perimeterLf: 23.4 }, { source: 'drying_report', widthFt: null, lengthFt: null, areaSf: 34.5, perimeterLf: 23.4 }] },
  { key: 'entry||', name: 'Front Entry', at: [17.9, 7.4, 21.9, 10.6], ceiling: 7.9, bands: [0.2, 0.1, 0.1, 0.1], how: 'pmmm', pinned: true,
    checks: [{ source: 'drying_report', widthFt: null, lengthFt: null, areaSf: 12.7, perimeterLf: 14.4 }] },
  { key: 'bathroom||', name: 'Bathroom', at: [21.9, 7.6, 27.9, 10.6], ceiling: 8.0, bands: [0.1, 0.1, 0.1, 0.2], how: 'mmmd', pinned: true,
    checks: [{ source: 'sketch', widthFt: 6.0, lengthFt: 3.0, areaSf: 18.0, perimeterLf: 18.0 }, { source: 'drying_report', widthFt: null, lengthFt: null, areaSf: 18.0, perimeterLf: 18.0 }] },
  { key: 'dinning room||', name: 'Dinning Room', at: [12.7, 10.6, 27.7, 23.0], ceiling: 8.6, bands: [0.2, 0.4, 0.6, 0.3], how: 'mmmp', pinned: true,
    checks: [{ source: 'sketch', widthFt: 15.0, lengthFt: 12.4, areaSf: 186.0, perimeterLf: 54.8 }, { source: 'drying_report', widthFt: null, lengthFt: null, areaSf: 186.7, perimeterLf: 57.7 }] },
  { key: 'living_room||', name: 'Living Room', at: [0, 0, 17.9, 10.6], ceiling: 8.6, bands: [0.1, 0.9, 0.3, 0.2], how: 'mmmm', pinned: true,
    checks: [{ source: 'sketch', widthFt: 17.9, lengthFt: 10.6, areaSf: 189.7, perimeterLf: 57.0 }, { source: 'drying_report', widthFt: null, lengthFt: null, areaSf: 133.3, perimeterLf: 57.0 }] },
  { key: 'closet||', name: 'Closet', at: [30.9, 0, 37.0, 4.7], ceiling: null, bands: [0.1, 0.1, 0.1, 0], how: 'mmmo', pinned: false },
];

const SPOTS: FloorSpec['spots'] = [
  [KITCHEN, 'Kitchen', 5.4, 14.6, true], [LAUNDRY, 'Laundry Room', 9.9, 22.2, true], [ENTRY, 'Front Entry', 19.9, 9.1, true],
  [BATH, 'Bathroom', 24.6, 9.3, true], [DINING, 'Dinning Room', 20.6, 19.6, true], [DINING_2, 'Dinning Room', 15.6, 20.9, false],
  [LIVING, 'Living Room', 6.2, 6.0, true], [CLOSET, 'Closet', 33.9, 2.4, true],
];

const OPENINGS: FloorSpec['openings'] = [
  ['living_room||', 'kitchen||', 'cased', 2.4, 10.6, 8.6, 10.6, true], ['living_room||', 'dinning room||', 'open_wall', 12.7, 10.6, 17.9, 10.6, true],
  ['kitchen||', 'dinning room||', 'cased', 12.7, 12.2, 12.7, 16.0, true], ['living_room||', 'entry||', 'cased', 17.9, 7.8, 17.9, 10.4, true],
  ['entry||', null, 'door', 18.4, 7.4, 21.4, 7.4, false], ['entry||', 'bathroom||', 'door', 21.9, 7.9, 21.9, 10.3, true],
  ['kitchen||', 'laundry||', 'door', 8.0, 19.9, 10.5, 19.9, true], ['closet||', null, 'door', 32.0, 4.7, 34.4, 4.7, false],
];

const THINGS: ThingSpec[] = [
  { id: 'fake-range', room: 'kitchen||', kind: 'range', at: [0, 13.0, 2.2, 15.5], pano: KITCHEN, face: 'left' },
  { id: 'fake-fridge', room: 'kitchen||', kind: 'refrigerator', at: [0, 16.9, 2.5, 19.9], views: 2, pano: KITCHEN, face: 'behind' },
  { id: 'fake-dishwasher', room: 'kitchen||', kind: 'dishwasher', at: [7.6, 17.9, 9.6, 19.9], pano: KITCHEN, face: 'right' },
  { id: 'fake-washer', room: 'laundry||', kind: 'washer', at: [6.8, 23.4, 9.05, 25.7], pano: LAUNDRY, face: 'ahead' },
  { id: 'fake-dryer', room: 'laundry||', kind: 'dryer', at: [9.25, 23.4, 11.5, 25.7], pano: LAUNDRY, face: 'ahead' },
  { id: 'fake-toilet', room: 'bathroom||', kind: 'toilet', at: [25.9, 7.6, 27.6, 9.9], pano: BATH, face: 'right' },
  { id: 'fake-vanity', room: 'bathroom||', kind: 'vanity', at: [22.0, 7.6, 24.5, 9.35], pano: BATH, face: 'left' },
  { id: 'fake-table', room: 'dinning room||', kind: 'contents', label: 'dining table', at: [17.4, 14.6, 23.0, 18.0], views: 2, pano: DINING, face: 'ahead' },
  { id: 'fake-sofa', room: 'living_room||', kind: 'contents', label: 'sofa', at: [1.0, 0.4, 8.0, 3.2], pano: LIVING, face: 'behind' },
  { id: 'fake-shelf', room: 'living_room||', kind: 'contents', label: 'bookshelf', at: [14.5, 0, 17.5, 1.2], pano: LIVING, face: 'right' },
];

const AREAS: AreaSpec[] = [
  { room: 'kitchen||', at: [0, 11.0, 0.35, 12.8], region: K.leftWall, pano: KITCHEN, face: 'ahead' },
  { room: 'kitchen||', at: [7.6, 12.0, 9.2, 13.6], views: 2, region: K.dehu, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [3.2, 18.6, 4.0, 19.4], region: K.floorX1, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [5.0, 15.6, 5.8, 16.4], region: K.floorX2, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [9.8, 19.55, 12.2, 19.9], views: 2, region: K.cabinet1, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [12.35, 16.6, 12.7, 19.4], region: K.cabinet2, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [2.5, 17.1, 2.85, 19.6], region: K.fridge, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [4.4, 19.55, 7.4, 19.9], region: K.drawn1, pano: KITCHEN, face: 'floor' },
  { room: 'kitchen||', at: [0, 15.7, 0.35, 16.8], region: K.drawn2, pano: KITCHEN, face: 'floor' },
  { room: 'laundry||', at: [6.8, 20.8, 7.15, 23.0], region: region('fake-laundry-wall', 1, 'tape_marked', 'lower left wall', [0, 0.9, 0.4, 1]), pano: LAUNDRY, face: 'left' },
  { room: 'laundry||', at: [10.9, 19.9, 12.7, 20.25], views: 2, region: region('fake-laundry-door', 2, 'wet_material', 'drywall by the door', [0.6, 0.85, 0.9, 1]), pano: LAUNDRY, face: 'behind' },
  { room: 'entry||', at: [19.0, 7.4, 21.9, 7.75], region: region('fake-entry-cut', 1, 'removed_material', 'baseboard pulled', [0.1, 0.9, 0.7, 1], { mark: judged('fake-mark-entry', 'confirm'), standing: true }), pano: ENTRY, face: 'right' },
  { room: 'dinning room||', at: [12.7, 16.4, 13.05, 18.2], views: 2, region: K.rightWall, pano: KITCHEN, face: 'ahead' },
  { room: 'dinning room||', at: [23.8, 20.2, 27.0, 22.8], region: region('fake-dining-stain', 1, 'water_stain', 'stain on the carpet', [0.2, 0.6, 0.6, 0.95], { threshold: 0.95 }), pano: DINING, face: 'floor' },
  { room: 'living_room||', at: [0, 4.0, 0.35, 9.4], region: region('fake-living-wall', 1, 'tape_marked', 'lower wall', [0, 0.92, 0.5, 1]), pano: LIVING, face: 'left' },
  { room: 'living_room||', at: [10.0, 0, 13.8, 0.35], region: region('fake-living-shadow', 2, 'water_stain', 'shadow under the window', [0.3, 0.4, 0.6, 0.6], { mark: judged('fake-mark-living', 'not_a_change') }), pano: LIVING, face: 'behind' },
];

const r1 = (value: number) => Math.round(value * 10) / 10;
const r4 = (value: number) => Math.round(value * 10000) / 10000;
const SIDES = ['left', 'right', 'front', 'back'] as const;
const HOW: Record<string, RoomSide['source']> = { m: 'measured', p: 'pinned', d: 'door_slab', o: 'open' };

/** One floor of the plan from feet: the frame is the rooms' box plus the margin, and every point is put in it. */
function buildFloor(spec: FloorSpec): { floor: DayOneFloor; svg: string } {
  const x0 = Math.min(...spec.rooms.map((room) => room.at[0])) - MARGIN_FT;
  const y0 = Math.min(...spec.rooms.map((room) => room.at[1])) - MARGIN_FT;
  const widthFt = r1(Math.max(...spec.rooms.map((room) => room.at[2])) + MARGIN_FT - x0);
  const lengthFt = r1(Math.max(...spec.rooms.map((room) => room.at[3])) + MARGIN_FT - y0);
  const pt = (x: number, y: number) => [r4((x - x0) / widthFt), r4((y - y0) / lengthFt)];
  const corners = ([a, b, c, d]: Ft) => [pt(a, b), pt(c, b), pt(c, d), pt(a, d)];
  const keys = new Set(spec.rooms.map((room) => room.key));
  const rooms = spec.rooms.map((room): DayOneRoom => {
    const [a, b, c, d] = room.at;
    const width = r1(c - a);
    const length = r1(d - b);
    // Each side's distance is the wall's from where the room's own camera stood (its root spot), as the room is measured.
    const root = spec.spots.find((spot) => spot[1] === room.name && spot[4]) ?? [null, null, (a + c) / 2, (b + d) / 2, true];
    const reach = [root[2] - a, c - root[2], root[3] - b, d - root[3]];
    const sides = SIDES.map((side, index): RoomSide => {
      const source = HOW[room.how[index]];
      return { side, ft: source === 'open' ? null : r1(reach[index]), bandFt: source === 'open' ? null : room.bands[index], source };
    });
    const open = room.how.includes('o');
    return {
      roomKey: room.key, roomName: room.name, floor: spec.floor, panoIds: spec.spots.filter((spot) => spot[1] === room.name).map((spot) => spot[0]),
      rect: open ? null : [...pt(a, b), ...pt(c, d)], outline: corners(room.at), widthFt: width, lengthFt: open ? null : length,
      areaSf: open ? null : r1(width * length), perimeterLf: open ? null : r1(2 * (width + length)), ceilingFt: room.ceiling,
      rectangular: !open, determined: !open, pinned: room.pinned, sides, checks: room.checks ?? [],
    };
  });
  const order = spec.rooms.map((room) => room.key);
  const areas = spec.areas.filter((area) => keys.has(area.room)).sort((a, b) => order.indexOf(a.room) - order.indexOf(b.room)).map((area, index): DayOneArea => ({
    areaId: `area-${area.region.regionId}`, number: index + 1, class: area.region.effectiveClass ?? area.region.class, roomKey: area.room,
    footprint: corners(area.at), standing: area.region.standing, views: area.views ?? 1, region: area.region,
    photo: { panoId: area.pano, face: area.face, regionId: area.region.regionId, ordinal: area.region.ordinal },
  }));
  const objects = spec.things.filter((thing) => keys.has(thing.room)).map((thing): DayOneObject => ({
    objectId: thing.id, kind: thing.kind, label: thing.label ?? null, roomKey: thing.room, footprint: corners(thing.at), views: thing.views ?? 1,
    photo: { panoId: thing.pano, face: thing.face, regionId: null, ordinal: null },
  }));
  const spots = spec.spots.filter((spot) => rooms.some((room) => room.panoIds.includes(spot[0])))
    .map(([panoId, roomName, x, y, root]) => ({ panoId, roomName, x: pt(x, y)[0], y: pt(x, y)[1], headingDeg: 90, root }));
  const openings = spec.openings.filter((open) => keys.has(open[0])).map(([from, to, kind, ax, ay, bx, by, pinned]) => ({
    kind, fromRoomKey: from, toRoomKey: to !== null && keys.has(to) ? to : null, a: pt(ax, ay), b: pt(bx, by), widthIn: r1(Math.hypot(bx - ax, by - ay) * 12), pinned: pinned && (to === null || keys.has(to)),
  }));
  const floor: DayOneFloor = { floor: spec.floor, drawingSha: spec.sha, widthFt, lengthFt, rooms, spots, openings, objects, areas, scale: spec.scale, pins: spec.pins };
  return { floor, svg: drawingOf(spec, x0, y0, widthFt, lengthFt, keys) };
}

/** The stand-in drawing: rooms, walls, door gaps, names and a 10 ft scale bar, in feet, on its own white ground. */
function drawingOf(spec: FloorSpec, x0: number, y0: number, w: number, l: number, keys: Set<string>): string {
  const s = (value: number) => r1(value * 100) / 100;
  const rooms = spec.rooms.map(({ at: [a, b, c, d], name, how }) => {
    const [x, y, rw, rh] = [s(a - x0), s(b - y0), s(c - a), s(d - b)];
    const walls = how[3] === 'o'
      ? `<path d="M${x} ${y + rh}V${y}H${x + rw}V${y + rh}" fill="none" stroke="#2b2f36" stroke-width="0.32"/><path d="M${x} ${y + rh}H${x + rw}" stroke="#2b2f36" stroke-width="0.16" stroke-dasharray="0.5 0.4"/>`
      : `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="none" stroke="#2b2f36" stroke-width="0.32"/>`;
    return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="#eef0f3"/>${walls}<text x="${s(x + rw / 2)}" y="${s(y + rh / 2)}" font-size="${rw < 7 ? 0.62 : 0.85}" text-anchor="middle" dominant-baseline="middle" fill="#4a5160" font-family="Inter, Arial, sans-serif">${name}</text>`;
  }).join('');
  const gaps = spec.openings.filter((open) => keys.has(open[0])).map(([, , kind, ax, ay, bx, by]) => (
    `<line x1="${s(ax - x0)}" y1="${s(ay - y0)}" x2="${s(bx - x0)}" y2="${s(by - y0)}" stroke="#ffffff" stroke-width="0.5"/>${kind === 'door' ? `<line x1="${s(ax - x0)}" y1="${s(ay - y0)}" x2="${s(bx - x0)}" y2="${s(by - y0)}" stroke="#8a919e" stroke-width="0.08"/>` : ''}`
  )).join('');
  const bar = `<g transform="translate(${s(MARGIN_FT * 0.5)} ${s(l - MARGIN_FT * 0.45)})"><path d="M0 0H10M0 -0.3V0.3M5 -0.2V0.2M10 -0.3V0.3" stroke="#2b2f36" stroke-width="0.1"/><text x="10.4" y="0.25" font-size="0.6" fill="#4a5160" font-family="Inter, Arial, sans-serif">10 ft</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${l}" preserveAspectRatio="none"><rect width="${w}" height="${l}" fill="#ffffff"/>${rooms}${gaps}${bar}</svg>`;
}

const VERIFIED: ScaleLine = { cameraIn: 62.4, presetIn: 63, verdict: 'verified', sources: [{ kind: 'door_slab', cameraIn: 62.1, bandIn: 0.9 }, { kind: 'door_slab', cameraIn: 62.9, bandIn: 1.1 }, { kind: 'tile', cameraIn: 62.3, bandIn: 0.6 }] };
const TILE_ONLY: ScaleLine = { cameraIn: 62.8, presetIn: 63, verdict: 'one_source', sources: [{ kind: 'tile', cameraIn: 62.8, bandIn: 0.7 }] };
const UNVERIFIED: ScaleLine = { cameraIn: 63, presetIn: 63, verdict: 'unverified', sources: [] };
const LOOP = { rooms: ['living_room||', 'kitchen||', 'dinning room||'], closureFt: 0.4 };

const BUILT = buildFloor({ floor: 1, sha: 'fake-floor-1-built', rooms: ROOMS, spots: SPOTS, openings: OPENINGS, things: THINGS, areas: AREAS, scale: VERIFIED, pins: { components: 2, unpinnedRooms: ['closet||'], loops: [LOOP] } });
const only = (keys: string[]) => ROOMS.filter((room) => keys.includes(room.key));
const PARTIAL = buildFloor({ floor: 1, sha: 'fake-floor-1-cal0', rooms: only(['kitchen||', 'laundry||', 'dinning room||', 'living_room||']), spots: SPOTS, openings: OPENINGS, things: THINGS, areas: AREAS, scale: TILE_ONLY, pins: { components: 1, unpinnedRooms: [], loops: [LOOP] } });
const EARLY = buildFloor({ floor: 1, sha: 'fake-floor-1-early', rooms: only(['kitchen||', 'laundry||']), spots: SPOTS, openings: OPENINGS, things: THINGS, areas: AREAS, scale: TILE_ONLY, pins: { components: 1, unpinnedRooms: [], loops: [] } });
const UPSTAIRS = buildFloor({
  floor: 2, sha: 'fake-floor-2', scale: UNVERIFIED, pins: { components: 1, unpinnedRooms: [], loops: [] },
  rooms: [
    { key: 'primary_bedroom||', name: 'Primary Bedroom', at: [0, 0, 14.0, 12.0], ceiling: 8.0, bands: [0.2, 0.3, 0.2, 0.4], how: 'mmmm', pinned: true },
    { key: 'hall_bath||', name: 'Hall Bath', at: [14.0, 4.0, 22.0, 9.0], ceiling: 8.0, bands: [0.1, 0.1, 0.1, 0.1], how: 'mmmm', pinned: true },
  ],
  spots: [['fake-pano-bedroom', 'Primary Bedroom', 7.0, 6.0, true], ['fake-pano-bath', 'Hall Bath', 18.0, 6.5, true]],
  openings: [['primary_bedroom||', 'hall_bath||', 'door', 14.0, 5.0, 14.0, 7.5, true]],
  things: [
    { id: 'fake-tub', room: 'hall_bath||', kind: 'tub', at: [16.9, 4.0, 22.0, 6.5], pano: 'fake-pano-bath', face: 'right' },
    { id: 'fake-toilet-2', room: 'hall_bath||', kind: 'toilet', at: [19.9, 6.7, 22.0, 9.0], pano: 'fake-pano-bath', face: 'behind' },
    { id: 'fake-vanity-2', room: 'hall_bath||', kind: 'vanity', at: [14.5, 7.25, 17.0, 9.0], pano: 'fake-pano-bath', face: 'left' },
    { id: 'fake-bed', room: 'primary_bedroom||', kind: 'contents', label: 'bed', at: [3.0, 0, 9.5, 6.8], pano: 'fake-pano-bedroom', face: 'ahead' },
  ],
  areas: [{ room: 'hall_bath||', at: [16.9, 6.5, 19.5, 6.85], region: region('fake-bath-tub', 1, 'water_stain', 'tub apron', [0.3, 0.7, 0.7, 0.9]), pano: 'fake-pano-bath', face: 'right' }],
});

/** Every floor's drawing as a URL an `<img>` loads, by its sha: what the fill's tokened fetch hands the section. */
export const FAKE_DRAWINGS: Record<string, string> = Object.fromEntries(
  [BUILT, PARTIAL, EARLY, UPSTAIRS].map(({ floor, svg }) => [floor.drawingSha, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`]),
);

const status = (s: LayoutStatus['status'], panosRead: number, contractVersions: string[], builtAt: string | null = '2026-10-26T17:40:00Z'): LayoutStatus => ({ status: s, panosRead, panosTotal: 8, builtAt, contractVersions });
const budget = (tourUsed: number, fleetUsed: number) => ({ fleetUsed, fleetCap: 900, tourUsed, tourCap: 360 });
const planned = (tourUsed: number, fleetUsed: number): LayoutReadResult => ({ status: 'planned', reason: null, viewsToRead: 6, viewsRead: 0, viewsCached: 0, viewsFailed: 0, budget: budget(tourUsed, fleetUsed), layout: null });
const refused = (reason: string, tourUsed = 0, fleetUsed = 12): LayoutReadResult => ({ ...planned(tourUsed, fleetUsed), status: 'refused', reason, viewsToRead: 0 });
const IDLE: TourReaderProgress = { running: false, index: 0, total: 0, lastRefusal: null, skipped: 0 };

/** One state of the section as its props would carry it. */
type FakeState = {
  floors: DayOneFloor[]; layout: LayoutStatus | null; rebuilding: boolean; dryRun: LayoutReadResult | null;
  walk: TourReaderProgress; unreadPanos: number; unreadViews: number; drawings: Record<string, string | null>;
};
const state = (patch: Partial<FakeState>): FakeState => ({ floors: [], layout: null, rebuilding: false, dryRun: null, walk: IDLE, unreadPanos: 0, unreadViews: 0, drawings: FAKE_DRAWINGS, ...patch });

/**
 * Every state the scaffold draws, by name: what the fixture mounts. `partial` is Clarence's plan from the five stored
 * calibration outlines (layout.cal0); `built` is the eight panos read under layout.v1.
 */
export const FAKE_DAY_ONE: Record<string, FakeState> = {
  none: state({ layout: status('none', 0, [], null), dryRun: planned(0, 12), unreadPanos: 8, unreadViews: 48 }),
  partial: state({ floors: [PARTIAL.floor], layout: status('partial', 5, ['layout.cal0']), dryRun: planned(30, 42), unreadPanos: 3, unreadViews: 18 }),
  built: state({ floors: [BUILT.floor], layout: status('built', 8, ['layout.v1']) }),
  stale: state({ floors: [BUILT.floor], layout: status('stale', 8, ['layout.v1'], '2026-10-24T15:05:00Z'), rebuilding: true }),
  unavailable: state({ layout: status('unavailable', 2, ['layout.v1'], null), dryRun: planned(12, 54), unreadPanos: 6, unreadViews: 36 }),
  loading: state({ floors: [BUILT.floor], layout: status('built', 8, ['layout.v1']), drawings: {} }),
  walking: state({ floors: [EARLY.floor], layout: status('partial', 2, ['layout.v1']), dryRun: planned(0, 12), walk: { running: true, index: 3, total: 8, lastRefusal: null, skipped: 0 }, unreadPanos: 6, unreadViews: 36 }),
  refusal: state({ floors: [PARTIAL.floor], layout: status('partial', 5, ['layout.cal0']), dryRun: planned(354, 402), walk: { running: false, index: 2, total: 3, lastRefusal: 'budget', skipped: 0 }, unreadPanos: 2, unreadViews: 12 }),
  switchedOff: state({ layout: status('none', 0, [], null), dryRun: refused('flag_off'), unreadPanos: 8, unreadViews: 48 }),
  budgetSpent: state({ floors: [PARTIAL.floor], layout: status('partial', 5, ['layout.cal0']), dryRun: refused('budget', 360, 418), unreadPanos: 3, unreadViews: 18 }),
  noKey: state({ layout: status('none', 0, [], null), dryRun: refused('no_key'), unreadPanos: 8, unreadViews: 48 }),
  geminiOff: state({ layout: status('none', 0, [], null), dryRun: refused('gemini_off'), unreadPanos: 8, unreadViews: 48 }),
  floors: state({ floors: [BUILT.floor, UPSTAIRS.floor], layout: status('built', 8, ['layout.v1']) }),
};
