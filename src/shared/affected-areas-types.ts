//----------------- AFFECTED AREAS CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the tour viewer in Cerberus's Tours tab: every shape `/api/affected-areas` puts
// on the wire or takes off it — the tour list and its detail, a pano's views and the regions a reader
// marked on them, the reader's press and its plan, the codebook, the operator's marks, the review
// queues and the proving numbers.
//
// The one home is shadow-connector's `core/affected_areas/wire.py` (/opt/shadow-connector), and this
// file follows it field for field: look THERE when a shape here seems wrong, and add a field there
// first. The two edit TOGETHER: a field renamed on one side and not the other is a screen that quietly
// stops reading. CloudCLI's lane forwards every body untouched, so there is no third copy.
//
// JSON is camelCase on every route; wire.py's `cls` is the key `class`, and it is a key here too.
// Every date and datetime is ISO text (`2026-10-13`, `2026-10-13T08:00:00Z`), every id is text, and
// a point is `[x, y]` and a box `[x0, y0, x1, y1]`, both in 0..1 of one view.
//
// A response field is always present: wire.py dumps a `None` as `null` and an unset list as `[]`.
// A field a later plan fills is typed now and reads `null` until that plan lands — `null` is "not
// judged", never "judged and found nothing". Those are the reader's (`read`, `regionsTotal`, ...)
// and the marks plan's (`mark`, `standing`, `threshold`, `holdout`, ...). A REQUEST field that wire.py
// defaults is optional here, because the client may leave it out.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.

// ---------------------------

//----------------- VOCABULARY ------------

/** The six faces a panorama is cut into, each one view. Read by the pano screen's face picker. */
export type Face = 'ahead' | 'right' | 'behind' | 'left' | 'ceiling' | 'floor';

/** How the reader came to mark a region: `seen` in the photo, `metered` by a reading, `ruled` by a rule. */
export type Basis = 'seen' | 'metered' | 'ruled';

/** Every judgment a `Mark` can carry: the three on a region and the two on a read's understanding, plus `missed`. */
export type Verdict =
  'confirm' | 'rename' | 'not_a_change' | 'missed' | 'understanding_right' | 'understanding_wrong';

/** The queue a mark was made in; `browse` is no queue — the operator walked there. */
export type MarkQueue = 'unsure' | 'random' | 'browse';

/** `[x, y]` in 0..1 of a view; the wire does not police the length. */
type Point = number[];

/** `[x0, y0, x1, y1]` in 0..1 of a view; the wire does not police the length. */
type Box = number[];

// ---------------------------

//----------------- THE TOUR: LIST, CONTEXT, ROOMS, PANOS ------------

/** One tour as the picker and the tour screen's header draw it: the job's name and address, and how far it has been read. */
export type TourSummary = {
  tourId: string;
  jobId: string | null;
  jobLabel: string | null;
  /** Tours view. DocuSketch's own name for the tour, `null` when blank. */
  tourName: string | null;
  address: string | null;
  capturedAt: string | null;
  panoCount: number;
  roomCount: number;
  viewsTotal: number;
  /** Reader. */
  viewsRead: number;
  /** Reader. */
  regionsTotal: number;
  /** Marks. */
  regionsStanding: number | null;
  /** Marks. */
  marksCount: number | null;
  /** Reader. */
  lastReadAt: string | null;
};

/** GET /tours. */
export type TourList = { tours: TourSummary[] };

/** What the reader is told about the tour's job; `sources` says which tables it came from. */
export type ContextSummary = {
  packetHash: string;
  builtAt: string;
  lossType: string | null;
  lossAccount: string | null;
  statedCause: string | null;
  waterCategory: number | null;
  waterClass: number | null;
  dateOfLoss: string | null;
  daysLossToTour: number | null;
  yearBuilt: number | null;
  carrier: string | null;
  propertyType: string | null;
  sources: string[];
};

/** One material's numbers inside a room's drying entry. */
export type MaterialEntry = {
  materialClass: string;
  firstReading: number | null;
  goal: number | null;
  unit: string | null;
  removed: boolean | null;
};

/** One room's numbers from the latest real drying report that names it. */
export type DryingEntry = {
  reportDate: string;
  affectedFloorSf: number | null;
  affectedWallSf: number | null;
  affectedCeilingSf: number | null;
  above18Inches: boolean | null;
  materials: MaterialEntry[];
};

/** One room of a tour, with the panos taken in it. A nameless pano is a room with no name (key `unknown||`). */
export type RoomEntry = {
  roomKey: string;
  roomName: string | null;
  floor: number | null;
  panoIds: string[];
  capturedAt: string | null;
  demoBeforeTour: boolean | null;
  docusketchAffected: boolean;
  drying: DryingEntry | null;
  /** Marks. */
  regionsStanding: number | null;
  /** Marks. The marked areas call this room affected on some floor; `regionsStanding` counts older damage too. */
  markedAreasAffected: boolean | null;
  /** Photos. The room's verdict from the tour's photos: what the Tours view reads in place of `markedAreasAffected`. */
  photosAffected: boolean | null;
};

/** One operator judgment. Marks. */
export type Mark = {
  markId: string;
  verdict: Verdict;
  newClass: string | null;
  note: string | null;
  queue: MarkQueue | null;
  /** Display only; the channel it came through is never on the wire. */
  markedBy: string | null;
  markedAt: string;
};

/**
 * Whether a view has been read, and under which contract. A view with no read is `unread`
 * (`regionsCount` 0, the rest `null`), not absent: the reader fills it for every kept view.
 */
export type ReadState = {
  status: 'unread' | 'read';
  readId: string | null;
  model: string | null;
  contractVersion: string | null;
  readAt: string | null;
  contextHash: string | null;
  /** Today's room packet differs from the one the read was fed. */
  contextChanged: boolean | null;
  /** Tours view. True when this read is under today's contract and the profile's pinned model; `null` on an unread view. */
  current: boolean | null;
  regionsCount: number;
  /** Marks. */
  standingCount: number | null;
  /** Marks. The newest understanding mark on this read. */
  understandingMark: Mark | null;
};

/** One face of a pano, cut to a still; `sha256` names the image `GET /images/{sha}` answers. */
export type ViewEntry = {
  sha256: string;
  face: Face;
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
  width: number;
  height: number;
  /** Reader. */
  read: ReadState | null;
};

/** One panorama of a tour. `live` is false when DocuSketch could not be asked and the pano is known from stored rows only. */
export type PanoEntry = {
  panoId: string;
  roomName: string | null;
  roomKey: string | null;
  floor: number | null;
  capturedAt: string | null;
  /** `null`: DocuSketch did not say. */
  docusketchAffected: boolean | null;
  live: boolean;
  views: ViewEntry[];
};

/** GET /tours/{tourId}. */
export type TourDetail = {
  tour: TourSummary;
  context: ContextSummary;
  rooms: RoomEntry[];
  panos: PanoEntry[];
};

/** POST /tours/{tourId}/panos/{panoId}/views. */
export type ViewsResult = {
  status: 'ok' | 'refused';
  reason: string | null;
  views: ViewEntry[];
};

// ---------------------------

//----------------- A PANO: WHAT THE READER SAW, AND THE PATCHES IT MARKED ------------

/** One surface the reader described in a view. */
export type SurfaceEntry = {
  surface: string;
  material: string | null;
  condition: string | null;
};

/** One fixture the reader named in a view. */
export type FixtureEntry = {
  fixture: string;
  note: string | null;
};

/** Whether the view shows a water source, and what. */
export type SourceSeen = {
  seen: boolean;
  what: string | null;
};

/** The reader's account of the whole view, apart from its regions. Reader. */
export type Understanding = {
  summary: string | null;
  surfaces: SurfaceEntry[];
  fixtures: FixtureEntry[];
  source: SourceSeen | null;
  contents: string[];
  construction: string | null;
  couldNotSee: string[];
};

/**
 * A marked patch of one view. `sphere` is derived from `polygon` in the view's own frame and never
 * stored; it is empty until a region exists.
 */
export type Region = {
  regionId: string;
  source: 'model' | 'human';
  /** The badge number on its view. */
  ordinal: number;
  class: string;
  /** Marks. The kind the area counts as, a rename applied. */
  effectiveClass: string | null;
  label: string | null;
  basis: Basis;
  evidence: string | null;
  confidence: number | null;
  polygon: Point[];
  box: Box;
  /** `[yawDeg, pitchDeg]` per polygon vertex. */
  sphere: Point[];
  areaFrac: number;
  /** Marks: set aside to measure the model, never shown to tune it. */
  holdout: boolean | null;
  /** Marks: the newest judgment. */
  mark: Mark | null;
  /** Marks: whether the system currently believes it. */
  standing: boolean | null;
  /** Marks: the line the operator set for this kind on this read's model and contract, or `null` when none is set. */
  threshold: number | null;
};

/** A view with what the reader made of it. Reader. */
export type ViewDetail = ViewEntry & {
  understanding: Understanding | null;
  regions: Region[];
};

/** GET /tours/{tourId}/panos/{panoId}. */
export type PanoDetail = {
  tourId: string;
  panoId: string;
  roomName: string | null;
  roomKey: string | null;
  floor: number | null;
  capturedAt: string | null;
  views: ViewDetail[];
};

// ---------------------------

//----------------- THE READER'S PRESS, PLAN AND CODEBOOK ------------

/** What a read may still spend: the fleet-wide and the per-tour counts against their caps. */
export type Budget = {
  fleetUsed: number | null;
  fleetCap: number;
  tourUsed: number | null;
  tourCap: number;
};

/**
 * POST /tours/{tourId}/panos/{panoId}/read. Both fields are spoken: `armed` and `force` each buy reads,
 * and spend is never silent. Strict booleans — `"yes"`, `"on"` and `1` are a 422, not an armed press.
 */
export type ReadRequest = { armed: boolean; force: boolean };

/** The answer to a press; `pano` is the pano as it stands after the read. */
export type ReadResult = {
  status: 'read' | 'cached' | 'planned' | 'partial' | 'refused';
  reason: string | null;
  viewsToRead: number;
  viewsRead: number;
  viewsCached: number;
  viewsFailed: number;
  budget: Budget;
  pano: PanoDetail | null;
};

/** POST /tours/{tourId}/read: what a read of the whole tour would do, bought nothing. `panos` is a count. */
export type TourPlan = {
  tourId: string;
  panos: number;
  viewsTotal: number;
  viewsCut: number;
  viewsRead: number;
  viewsToRead: number;
  budget: Budget;
};

/** One class of the codebook, with the sentence that defines it. */
export type ClassEntry = {
  key: string;
  group: string;
  label: string;
  definition: string;
};

/** GET /codebook: the classes a region may carry, and the contract the reader read them under. */
export type Codebook = {
  codebookVersion: string;
  contractVersion: string;
  contractHash: string;
  model: string;
  classes: ClassEntry[];
  materials: string[];
  fixtures: string[];
};

// ---------------------------

//----------------- MARKS AND THE QUEUES ------------

/** POST /regions/{regionId}/marks: a judgment on a region. */
export type MarkRequest = {
  verdict: 'confirm' | 'rename' | 'not_a_change';
  newClass?: string | null;
  note?: string | null;
  queue?: MarkQueue | null;
};

/** POST /images/{sha}/regions: a patch the model did not mark; the box becomes a human region. */
export type MissedRequest = {
  class: string;
  box: Box;
  note?: string | null;
  queue?: MarkQueue | null;
};

/** POST /reads/{readId}/marks: the operator's judgment of a read's understanding. */
export type UnderstandingMarkRequest = {
  verdict: 'understanding_right' | 'understanding_wrong';
  note?: string | null;
};

/** The answer to POST /reads/{readId}/marks. */
export type UnderstandingMarkResult = { readId: string; mark: Mark };

/** The marks routes' 403, 404 and 422 body: `error` is a reason code, `detail` a sentence. */
export type Refusal = { error: string; detail: string };

/** One region waiting to be judged, with the view and pano it sits on. */
export type QueueItem = {
  tourId: string;
  panoId: string;
  roomName: string | null;
  jobLabel: string | null;
  view: ViewEntry;
  region: Region;
};

/** GET /queue. */
export type Queue = {
  mode: 'unsure' | 'random';
  items: QueueItem[];
  remaining: number;
};

// ---------------------------

//----------------- PROVING: WHERE EACH CLASS'S LINE SHOULD SIT ------------

/** A class the operator renamed a region to, and how often. */
export type RenamedTo = { class: string; n: number };

/** The unbiased sample behind a class's numbers: regions drawn at random, then judged. */
export type RandomSlice = {
  n: number;
  right: number;
  wrongClass: number;
  wrong: number;
  /** Of `n`, the regions at or above the class's line: the count `precisionAt` is over. */
  nAt: number;
  precisionAt: number | null;
  coverageAt: number | null;
};

/** What the class would score with its line at `t`. */
export type SweepPoint = {
  t: number;
  n: number;
  precision: number | null;
  coverage: number | null;
};

/** One class's numbers: the line in force, the random slice behind it, and the sweep of lines it could take. */
export type ProvingClass = {
  class: string;
  label: string;
  group: string;
  threshold: number;
  thresholdSetAt: string | null;
  isDefault: boolean;
  randomSlice: RandomSlice;
  sweep: SweepPoint[];
  nearLine: number;
  missed: number;
  renamedTo: RenamedTo[];
  notes: string[];
};

/** How many reads the operator judged, and how many of those were right. */
export type UnderstandingTally = { n: number; right: number };

/** GET /proving. */
export type Proving = {
  model: string;
  contractVersion: string;
  contractHash: string;
  understanding: UnderstandingTally;
  classes: ProvingClass[];
};

/** PUT /thresholds/{class}: move one class's line. */
export type ThresholdRequest = { threshold: number; note?: string | null };
