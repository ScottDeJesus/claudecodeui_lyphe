import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapMilestone } from '@/shared/roadmap-types';
import type { RoadmapStackEpic, RoadmapStackTier, RoadmapStackWall } from '@/shared/types';

// THE ROADMAP AS A STACK, laid out. Each milestone is a ring; each of its features a wall on that ring, in the
// order the roadmap keeps them, its epics' walls together with a gap between one epic and the next. Nothing
// here draws: `utils/stackPainter` does, from what this returns.

const TAU = Math.PI * 2;

/** The gap between one epic's walls and the next's, in walls' widths. */
const EPIC_GAP = 0.4;

/** The widest a wall stands on a ring that is not yet reached, in radians: the rest of its rim stays bare, room for what is not thought of yet. */
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
  unit: number,
  unseen: boolean,
): Omit<RoadmapStackWall, 'at' | 'width'> & { unit: number } {
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
    unit,
    frame: shipped ? (fresh ? UNSEEN_RISE : 1) : FRAME_OF[feature.word],
    fill: shipped ? 1 : feature.word === 'in flight' && feature.tasks.length > 0 ? done / feature.tasks.length : 0,
    tone: blocked !== null || stalled ? 'danger' : owed ? 'warn' : null,
    unseen: fresh,
    attention: owed ? 3 : fresh ? 2 : stalled ? 1 : 0,
  };
}

/**
 * The roadmap's milestones as the stack's rings. `unseen` names the features that shipped since the operator last
 * looked and that he has not opened since: their walls stand over the rest.
 *
 * A reached milestone fills its ring. One that is not keeps its walls to a readable width (`WIDEST_WALL`) and
 * leaves the rest of the rim bare. An epic with no feature yet still has a place on the ring, one wall wide, so
 * its thread is there to be pressed.
 *
 * Used by `RoadmapStackFace`, once per picture, for the stack it hands to `RoadmapStack`.
 */
export function layoutStack(roadmap: Roadmap, unseen: ReadonlySet<string>): RoadmapStackTier[] {
  return roadmap.milestones.map((milestone, index) => {
    // Laid out first in walls' widths (`unit`), then scaled to the ring once the whole run is known.
    let cursor = 0;
    const epicRuns = milestone.epics.map((epic) => {
      const from = cursor;
      const walls = epic.features.map((feature) => {
        const wall = wallOf(feature, epic, milestone, cursor + 0.5, unseen.has(feature.name));
        cursor += 1;
        return wall;
      });
      if (walls.length === 0) cursor += 1;
      const run = { epic, from, to: cursor, walls };
      cursor += EPIC_GAP;
      return run;
    });

    const scale = cursor === 0 ? 0 : milestone.word === 'reached' ? TAU / cursor : Math.min(TAU / cursor, WIDEST_WALL);
    const epics: RoadmapStackEpic[] = epicRuns.map((run) => ({
      epic: run.epic,
      from: run.from * scale,
      to: run.to * scale,
      walls: run.walls.map(({ unit, ...wall }) => ({ ...wall, at: unit * scale, width: scale })),
    }));

    return { milestone, n: index + 1, epics, walls: epics.flatMap((epic) => epic.walls), span: cursor * scale };
  });
}

/** The ring a visit opens on: the roadmap's current milestone, else the first not yet reached, else the last. */
export function arrivalTier(roadmap: Roadmap, tiers: readonly RoadmapStackTier[]): number {
  const current = tiers.findIndex((tier) => tier.milestone.name === roadmap.current);
  if (current >= 0) return current;
  const open = tiers.findIndex((tier) => tier.milestone.word !== 'reached');
  return open >= 0 ? open : Math.max(0, tiers.length - 1);
}
