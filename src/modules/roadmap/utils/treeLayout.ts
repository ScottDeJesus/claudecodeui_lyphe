import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapFeatureWord,
  RoadmapMilestone,
} from '@/shared/roadmap-types';
import type { RoadmapDotState } from '@/shared/types';

// The roadmap tree's geometry, worked out once and drawn from. Pure and import-type-only (no React, no DOM,
// no i18n), so `npx --no-install tsx --tsconfig tsconfig.json` runs it on the store's own document.
// Everything is px at scale 1; every `y` is a text baseline or a centre in the drawing, and the goal's
// x is left to the tree, which centres it or holds it at its pane's visible centre. Read by the roadmap
// module's tree (`tree/`), which draws it, and by its panel (`panel/`), which reads `dots`.

/** One milestone's column: the width the tree grows by with every milestone. */
const COLUMN_WIDTH = 248;
/** The narrowest drawing: a one-milestone tree still sits centred under its goal in this. */
const MIN_WIDTH = 400;

const GOAL_RING_RADIUS = 12;
const GOAL_RING_Y = 16;
const GOAL_WRAP = 48;
/** The baselines of the goal's first and second line. */
const GOAL_BASELINES = [45, 66];
/** From the last goal baseline down to where the connectors start: below the label, never through it. */
const GOAL_LABEL_DROP = 7;

// Milestone offsets, each from the goal's bottom or from the milestone ring's centre as named.
const MILESTONE_EYEBROW_FROM_GOAL = 36;
const MILESTONE_RING_FROM_GOAL = 66;
const MILESTONE_RING_RADIUS = 22;
const MILESTONE_TITLE_WRAP = 30;
const MILESTONE_TITLE_FIRST_FROM_RING = 37;
const MILESTONE_TITLE_LINE_HEIGHT = 14;
const MILESTONE_LINE_FROM_RING = 68;
const SPINE_TOP_FROM_RING = 74;
const FIRST_ROW_TOP_FROM_RING = 82;
const SPINE_INSET = 14;

// Epic row.
const EPIC_RING_RADIUS = 17;
const EPIC_RING_FROM_SPINE = 28;
/** The gap between the tick's end and the epic's ring. */
const TICK_GAP = 5;
/** The gap between the epic's ring and its label. */
const LABEL_GAP = 9;
const EPIC_TITLE_WRAP = 26;
const EPIC_TITLE_LINE_HEIGHT = 13;
const EPIC_TITLE_FIRST_BASELINE = 10;
/** The gap between the title block and the first row of dots. */
const DOTS_GAP_BELOW_TITLE = 6;
const DOT_PITCH = 8;
const DOTS_PER_ROW = 14;
const FIRST_DOT_FROM_LABEL = 3;
/** What the epic's own line ("<word> · x of y shipped") takes under the rest of the block. */
const EPIC_LINE_ALLOWANCE = 14;
/** From the bottom of the text block up to the line's baseline. */
const EPIC_LINE_RISE = 3;
const MIN_ROW_HEIGHT = 38;
const ROW_GAP = 8;

/** Below a column that holds no epic, its end sits this far under the milestone's own line. */
const EMPTY_COLUMN_BELOW_LINE = 4;
const BOTTOM_MARGIN = 8;

/**
 * Where one dot sits and how it is painted: the feature it stands for, its centre and its state. Part of
 * the `TreeLayout` the roadmap module's tree draws and its panel receives (the panel's rows read the same
 * `state` from `TreeLayout.dots`).
 */
export type TreeDotSpot = { feature: RoadmapFeature; x: number; y: number; state: RoadmapDotState };

/**
 * One epic's row: its ring (`x`, `y`, `r`), where the tick from the spine stops (`tickTo`), the label's left
 * edge, its wrapped title (a baseline per line), its dots in feature order and the baseline of its own
 * line. Part of the `TreeLayout` the roadmap module's tree draws and its panel receives.
 */
export type TreeEpicSpot = {
  epic: RoadmapEpic;
  x: number;
  y: number;
  r: number;
  tickTo: number;
  labelX: number;
  titleLines: string[];
  titleBaselines: number[];
  dots: TreeDotSpot[];
  lineY: number;
};

/**
 * One milestone's column: `n` is its 1-based place in store order and (`x`, `y`, `r`) its ring, whose
 * `x` is the column's centre. The eyebrow, the wrapped title and the line each carry their baseline,
 * and `spine` is the vertical the epic rows hang from (`bottom` is the last row's centre, `top` when
 * there is no epic). Part of the `TreeLayout` the roadmap module's tree draws, and reads the current
 * column of, and its panel receives.
 */
export type TreeMilestoneSpot = {
  milestone: RoadmapMilestone;
  n: number;
  x: number;
  y: number;
  r: number;
  eyebrowY: number;
  titleLines: string[];
  titleBaselines: number[];
  lineY: number;
  spine: { x: number; top: number; bottom: number };
  epics: TreeEpicSpot[];
};

/**
 * The whole drawing: its size, the goal's ring, label and the `bottom` its connectors start from, one
 * spot per milestone in store order, and `dots`, the state of every feature the roadmap places keyed by
 * feature name. Read by the roadmap module's tree, which draws it, and by its panel, whose feature rows
 * paint their dot from `dots` so the two cannot disagree.
 */
export type TreeLayout = {
  width: number;
  height: number;
  goal: { y: number; r: number; lines: string[]; baselines: number[]; bottom: number };
  milestones: TreeMilestoneSpot[];
  dots: Map<string, RoadmapDotState>;
};

/** The dot a feature's word paints when nothing blocks it (`blocked` and `shipped` are decided before this is read). */
const DOT_STATE_OF_WORD: Record<RoadmapFeatureWord, RoadmapDotState> = {
  shipped: 'shipped',
  'in flight': 'inFlight',
  designing: 'designing',
  proposed: 'proposed',
  idea: 'idea',
};

/** `text` cut to `limit` characters, the last of them "…", or `text` itself when it already fits. */
function cutToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  // A cut that would leave half of an emoji (a high surrogate) before the "…" steps back one unit.
  const lastKept = text.charCodeAt(limit - 2);
  const kept = lastKept >= 0xd800 && lastKept <= 0xdbff ? limit - 2 : limit - 1;
  return `${text.slice(0, kept)}…`;
}

/**
 * Wraps `text` into at most two lines of `limit` characters: words are packed greedily; when a third
 * line would start, the rest of the text folds into the second line, which is cut with its last
 * character "…". A single word longer than the limit is cut the same way.
 */
function wrapText(text: string, limit: number): string[] {
  const packed: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = current === '' ? word : `${current} ${word}`;
    if (current === '' || joined.length <= limit) {
      current = joined;
    } else {
      packed.push(current);
      current = word;
    }
  }
  if (current !== '') packed.push(current);

  const lines = packed.length > 2 ? [packed[0], packed.slice(1).join(' ')] : packed;
  return lines.map((line) => cutToLimit(line, limit));
}

/**
 * The state of one feature's dot. A shipped feature is done whatever stands above it; an unshipped one is
 * blocked when the nearest of its own, its epic's and its milestone's blocked reasons exists; any other
 * feature paints its word. Exported for `useRoadmapCard`, which hands an epic's panel the dots it draws off the stage.
 */
export function dotStateOf(feature: RoadmapFeature, epic: RoadmapEpic, milestone: RoadmapMilestone): RoadmapDotState {
  if (feature.word === 'shipped') return 'shipped';
  if ((feature.blocked ?? epic.blocked ?? milestone.blocked) !== null) return 'blocked';
  return DOT_STATE_OF_WORD[feature.word];
}

/** The goal's wrapped label and where it ends: the connectors start at `bottom`, 7 below the last baseline. */
function layoutGoal(goalText: string): TreeLayout['goal'] {
  const lines = wrapText(goalText, GOAL_WRAP);
  const baselines = GOAL_BASELINES.slice(0, lines.length);
  // A goal with no words still reserves its first line, so the connectors start in the same place.
  const lastBaseline = baselines[baselines.length - 1] ?? GOAL_BASELINES[0];
  return { y: GOAL_RING_Y, r: GOAL_RING_RADIUS, lines, baselines, bottom: lastBaseline + GOAL_LABEL_DROP };
}

/** One epic's row, whose top edge is `rowTop`. `bottom` is the row's lower edge, which the column's end is read from. */
function layoutEpic(
  epic: RoadmapEpic,
  milestone: RoadmapMilestone,
  spineX: number,
  rowTop: number,
): { spot: TreeEpicSpot; bottom: number } {
  const titleLines = wrapText(epic.title, EPIC_TITLE_WRAP);
  const dotRows = Math.ceil(epic.features.length / DOTS_PER_ROW);
  const titleHeight = titleLines.length * EPIC_TITLE_LINE_HEIGHT;
  const block = titleHeight + (dotRows > 0 ? DOTS_GAP_BELOW_TITLE + dotRows * DOT_PITCH : 0) + EPIC_LINE_ALLOWANCE;
  const rowHeight = Math.max(MIN_ROW_HEIGHT, block);

  // The ring sits on the row's centre and the text block is centred on the ring, so a short block floats
  // in a 38-high row rather than hanging from its top.
  const centre = rowTop + rowHeight / 2;
  const blockTop = centre - block / 2;
  const x = spineX + EPIC_RING_FROM_SPINE;
  const labelX = x + EPIC_RING_RADIUS + LABEL_GAP;
  // A dot row is DOT_PITCH high and its centre is half of that below its top.
  const firstDotRowY = blockTop + titleHeight + DOTS_GAP_BELOW_TITLE + DOT_PITCH / 2;

  const spot: TreeEpicSpot = {
    epic,
    x,
    y: centre,
    r: EPIC_RING_RADIUS,
    tickTo: x - EPIC_RING_RADIUS - TICK_GAP,
    labelX,
    titleLines,
    titleBaselines: titleLines.map((_, index) => blockTop + EPIC_TITLE_FIRST_BASELINE + EPIC_TITLE_LINE_HEIGHT * index),
    dots: epic.features.map((feature, index) => ({
      feature,
      x: labelX + FIRST_DOT_FROM_LABEL + (index % DOTS_PER_ROW) * DOT_PITCH,
      y: firstDotRowY + Math.floor(index / DOTS_PER_ROW) * DOT_PITCH,
      state: dotStateOf(feature, epic, milestone),
    })),
    lineY: blockTop + block - EPIC_LINE_RISE,
  };
  return { spot, bottom: rowTop + rowHeight };
}

/** One milestone's column, whose left edge is `columnX`. `end` is where the column stops, before the drawing's bottom margin. */
function layoutMilestone(
  milestone: RoadmapMilestone,
  index: number,
  columnX: number,
  goalBottom: number,
): { spot: TreeMilestoneSpot; end: number } {
  const ringY = goalBottom + MILESTONE_RING_FROM_GOAL;
  const titleLines = wrapText(milestone.title, MILESTONE_TITLE_WRAP);
  const lineY = ringY + MILESTONE_LINE_FROM_RING;
  const spineX = columnX + SPINE_INSET;

  const epics: TreeEpicSpot[] = [];
  let rowTop = ringY + FIRST_ROW_TOP_FROM_RING;
  let end = lineY + EMPTY_COLUMN_BELOW_LINE;
  for (const epic of milestone.epics) {
    const { spot, bottom } = layoutEpic(epic, milestone, spineX, rowTop);
    epics.push(spot);
    rowTop = bottom + ROW_GAP;
    end = bottom;
  }

  const spineTop = ringY + SPINE_TOP_FROM_RING;
  const spot: TreeMilestoneSpot = {
    milestone,
    n: index + 1,
    x: columnX + COLUMN_WIDTH / 2,
    y: ringY,
    r: MILESTONE_RING_RADIUS,
    eyebrowY: goalBottom + MILESTONE_EYEBROW_FROM_GOAL,
    titleLines,
    titleBaselines: titleLines.map((_, line) => ringY + MILESTONE_TITLE_FIRST_FROM_RING + MILESTONE_TITLE_LINE_HEIGHT * line),
    lineY,
    spine: { x: spineX, top: spineTop, bottom: epics.length > 0 ? epics[epics.length - 1].y : spineTop },
    epics,
  };
  return { spot, end };
}

/**
 * Lays the roadmap out as a tree: the goal at the apex, one 248-wide column per milestone in store
 * order (centred in the drawing, so a lone milestone sits under its goal), and under each a spine of
 * epic rows with their feature dots. `goalText` is the label the goal draws, the roadmap's goal or its
 * "missing" words. Called by the roadmap module's face, whose tree draws the result and whose panel
 * reads `dots` from it.
 */
export function layoutTree(roadmap: Roadmap, goalText: string): TreeLayout {
  const width = Math.max(MIN_WIDTH, COLUMN_WIDTH * roadmap.milestones.length);
  const offset = (width - COLUMN_WIDTH * roadmap.milestones.length) / 2;
  const goal = layoutGoal(goalText);

  const columns = roadmap.milestones.map((milestone, index) =>
    layoutMilestone(milestone, index, offset + COLUMN_WIDTH * index, goal.bottom),
  );
  const milestones = columns.map((column) => column.spot);
  const dots = new Map<string, RoadmapDotState>();
  for (const dot of milestones.flatMap((spot) => spot.epics.flatMap((epic) => epic.dots))) {
    dots.set(dot.feature.name, dot.state);
  }

  return {
    width,
    height: Math.max(goal.bottom, ...columns.map((column) => column.end)) + BOTTOM_MARGIN,
    goal,
    milestones,
    dots,
  };
}
