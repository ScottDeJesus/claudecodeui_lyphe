import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapMilestone } from '@/shared/roadmap-types';
import type { RoadmapStackKind, RoadmapStackTier, RoadmapStackWall } from '@/shared/types';

// THE RING, laid out: ONE ring, holding only the features that are finished and not yet dismissed, the ones being
// built, and the ones that can be started (held for their Start, cut and waiting on Accept, or still being cut).
// Ideas, proposals, designs still being worked out, and everything set aside are not on it; nor are milestones or
// epics. Each feature is a wall; the three kinds stand together, with a gap between one kind and the next. Nothing
// here draws: `utils/stackPainter` does, from what this returns.

const TAU = Math.PI * 2;

/** The gap between one kind's walls and the next's, in walls' widths. */
const KIND_GAP = 0.6;

/** The widest a wall stands, in radians: a ring with few features keeps them to a readable width and leaves the rest of its rim bare. */
const WIDEST_WALL = 0.5;

/** How tall a wall stands for each word, as a share of a full wall: an idea is a mark on the floor, a build a full frame. */
const FRAME_OF: Record<RoadmapFeature['word'], number> = { idea: 0.045, proposed: 0.24, designing: 0.46, 'in flight': 1, shipped: 1 };

/** A wall that shipped while the operator was away stands this much over the rest until he opens it. */
const UNSEEN_RISE = 1.16;

/** One feature as its wall: its height from its word, its fill from its tasks, its tone from what holds it back or what it owes. */
function wallOf(
  feature: RoadmapFeature,
  epic: RoadmapEpic,
  milestone: RoadmapMilestone,
  kind: RoadmapStackKind,
  unseen: boolean,
): Omit<RoadmapStackWall, 'at' | 'width'> {
  const shipped = feature.word === 'shipped';
  const done = feature.tasks.filter((task) => task.status === 'done').length;
  // The nearest reason: its own, its epic's or its milestone's. A shipped feature is never blocked.
  const blocked = shipped ? null : feature.blocked ?? epic.blocked ?? milestone.blocked;
  const stalled = feature.step === 'stalled';
  const owed = feature.waiting_on_you !== null;
  const fresh = shipped && unseen;
  return {
    feature,
    epic,
    milestone,
    kind,
    frame: shipped ? (fresh ? UNSEEN_RISE : 1) : FRAME_OF[feature.word],
    fill: shipped ? 1 : feature.word === 'in flight' && feature.tasks.length > 0 ? done / feature.tasks.length : 0,
    tone: blocked !== null || stalled ? 'danger' : owed ? 'warn' : null,
    unseen: fresh,
    attention: owed ? 3 : fresh ? 2 : stalled ? 1 : 0,
  };
}

/** Which of the ring's three kinds a feature is, or `null` for one the ring does not hold. `finished` says whether a shipped feature still stands (`utils/ringFinished`). */
export function ringKindOf(feature: RoadmapFeature, finished: (feature: RoadmapFeature) => boolean): RoadmapStackKind | null {
  if (feature.word === 'shipped') return finished(feature) ? 'finished' : null;
  if (feature.word === 'in flight') return feature.step === 'queued' ? 'ready' : 'building';
  // A design is on the ring once it is being cut: the cut landing is what makes it startable.
  return feature.step === 'accept' || feature.step === 'cutting' ? 'ready' : null;
}

/** The order the kinds stand in, round the ring: what is finished, then what is being built, then what can be started. */
const KINDS: readonly RoadmapStackKind[] = ['finished', 'building', 'ready'];

/**
 * The roadmap's features as the one ring. `finished` says which shipped features still stand; `unseen` names the
 * ones that shipped since the operator last looked and that he has not opened since: their walls stand over the rest.
 *
 * The walls keep a readable width (`WIDEST_WALL`) and leave the rest of the rim bare. A roadmap with nothing to
 * show is a ring with no wall.
 *
 * Used by `stack/StackOf`, once per picture, for the ring it hands to `RoadmapStack`.
 */
export function layoutStack(roadmap: Roadmap, finished: (feature: RoadmapFeature) => boolean, unseen: ReadonlySet<string>): RoadmapStackTier[] {
  const held = roadmap.milestones.flatMap((milestone) => milestone.epics.flatMap((epic) => epic.features.map((feature) => (
    { feature, epic, milestone, kind: ringKindOf(feature, finished) }
  ))));
  // Laid out first in walls' widths, then scaled to the ring once the whole run is known.
  let cursor = 0;
  const placed: { wall: Omit<RoadmapStackWall, 'at' | 'width'>; unit: number }[] = [];
  for (const kind of KINDS) {
    const walls = held.filter((item) => item.kind === kind);
    if (walls.length === 0) continue;
    if (placed.length > 0) cursor += KIND_GAP;
    for (const { feature, epic, milestone } of walls) {
      placed.push({ wall: wallOf(feature, epic, milestone, kind, unseen.has(feature.name)), unit: cursor + 0.5 });
      cursor += 1;
    }
  }
  // The gap that closes the ring, between the last kind and the first.
  const round = cursor + (placed.length > 0 ? KIND_GAP : 0);
  const scale = round === 0 ? 0 : Math.min(TAU / round, WIDEST_WALL);
  return [{
    name: roadmap.name,
    walls: placed.map(({ wall, unit }) => ({ ...wall, at: unit * scale, width: scale })),
    span: cursor * scale,
  }];
}
