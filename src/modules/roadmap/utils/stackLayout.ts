import type { RoadmapEpic, RoadmapFeature, RoadmapMilestone, RoadmapPicture } from '@/shared/roadmap-types';
import type { DispatcherPlan, RoadmapStackKind, RoadmapStackTier, RoadmapStackWall } from '@/shared/types';

// THE RING, laid out: ONE ring of WHAT IS IN FLIGHT, whichever roadmap or project it belongs to. Its walls are the
// plans the In flight board draws (the dispatcher's lane, less what the operator hid or dismissed), one wall each:
// what is finished and not yet dismissed, what is being built, and what is held (waiting for its Start or its turn,
// stopped, parked, or still being designed and cut, a word owed or not). Nothing the lane does not carry is on it:
// no idea, no proposal, nothing long shipped. The three kinds stand together, with a gap between one kind and the
// next. Nothing here draws: `utils/stackPainter` does, from what this returns.

const TAU = Math.PI * 2;

/** The gap between one kind's walls and the next's, in walls' widths. */
const KIND_GAP = 0.6;

/** The widest a wall stands, in radians: a ring with few features keeps them to a readable width and leaves the rest of its rim bare. */
const WIDEST_WALL = 0.5;

/** How tall a wall stands for each word, as a share of a full wall: an idea is a mark on the floor, a build a full frame. */
const FRAME_OF: Record<RoadmapFeature['word'], number> = { idea: 0.045, proposed: 0.24, designing: 0.46, 'in flight': 1, shipped: 1 };

/** A finished wall stands this much over the rest until it is dismissed. */
const FINISHED_RISE = 1.16;

/** A plan's place on the roadmaps: the feature it is, with the epic and the milestone it stands under. */
type Placed = { feature: RoadmapFeature; epic: RoadmapEpic; milestone: RoadmapMilestone };

/** The ring's key across pictures: there is one ring, and it belongs to no roadmap. */
const RING_NAME = 'in-flight';

/** Every feature of every roadmap, by name: what a plan is called, where it stands and its tasks, when a roadmap holds it. */
function placedByName(picture: RoadmapPicture | null): Map<string, Placed> {
  const index = new Map<string, Placed>();
  for (const roadmap of picture?.roadmaps ?? []) {
    for (const milestone of roadmap.milestones) {
      for (const epic of milestone.epics) {
        for (const feature of epic.features) index.set(feature.name, { feature, epic, milestone });
      }
    }
  }
  return index;
}

/** The last piece of a repository's path: what a plan no roadmap holds is filed under. */
const repoLabel = (repo: string): string => repo.split(/[\\/]/).filter(Boolean).pop() ?? '';

/**
 * A plan no roadmap holds, as the feature it would be: the roadmap's own words read off the dispatcher's
 * (`report_roadmap.feature_word`'s table, as far as a plan's status and state say it), so the painter and the reading
 * draw it by the one vocabulary.
 */
function featureOfPlan(plan: DispatcherPlan): RoadmapFeature {
  const { status } = plan;
  const word: RoadmapFeature['word'] = status === 'complete' ? 'shipped' : status === 'idle' || status === 'parked' ? 'designing' : 'in flight';
  const step: RoadmapFeature['step'] = status === 'complete' ? 'shipped'
    : status === 'gaps' ? 'gaps'
    : status === 'gap-needs-you' ? 'gap-needs-you'
    : status === 'live' ? 'building'
      : status === 'stalled' ? 'stalled'
        : status === 'paused' || (status === 'scheduled' && plan.launched) ? 'paused'
          : status === 'queued' || status === 'scheduled' ? 'queued'
            : status === 'parked' ? 'parked'
              : plan.state === 'questions' ? 'questions' : plan.state === 'loaded' ? 'accept' : plan.state === 'designed' ? 'cutting' : 'designing';
  return {
    name: plan.name,
    title: plan.name,
    goal: plan.goal,
    project: repoLabel(plan.repo),
    repo: plan.repo,
    position: 0,
    blocked: null,
    word,
    step,
    waiting_on_you: plan.asking === null ? null : plan.state === 'questions' ? 'questions' : 'accept',
    waits_on: plan.waits_on,
    tasks: plan.phases.map((phase) => ({ key: phase.key, title: phase.title, status: phase.status, done_at: phase.done_at })),
    created_at: plan.created_at,
    promoted_at: null,
    approved_at: plan.approved?.at ?? null,
    shipped_at: plan.completed_at,
    runtime_s: 0,
    cases: { total: 0, holding: 0, broken: 0, regressed: 0, not_run: 0, cant_run: 0 },
  };
}

/** Which of the ring's three kinds a plan is: by the dispatcher's own status word, the one its card's presses turn on. */
export function ringKindOf(plan: DispatcherPlan): RoadmapStackKind {
  if (plan.status === 'complete') return 'finished';
  return plan.status === 'live' || plan.status === 'stalled' ? 'building' : 'held';
}

/** One plan as its wall: its height from its word, its fill from its tasks, its tone from what holds it back or what it owes. */
function wallOf(plan: DispatcherPlan, placed: Placed | null): Omit<RoadmapStackWall, 'at' | 'width'> {
  const feature = placed?.feature ?? featureOfPlan(plan);
  const kind = ringKindOf(plan);
  const finished = kind === 'finished';
  const done = feature.tasks.filter((task) => task.status === 'done').length;
  // The nearest reason: its own, its epic's or its milestone's. A finished feature is never blocked.
  const blocked = finished ? null : feature.blocked ?? placed?.epic.blocked ?? placed?.milestone.blocked ?? null;
  const stalled = plan.status === 'stalled';
  const owed = !finished && (plan.asking !== null || feature.waiting_on_you !== null);
  return {
    feature,
    epic: placed?.epic ?? null,
    milestone: placed?.milestone ?? null,
    plan,
    kind,
    frame: finished ? FINISHED_RISE : FRAME_OF[feature.word],
    fill: finished ? 1 : feature.word === 'in flight' && feature.tasks.length > 0 ? done / feature.tasks.length : 0,
    tone: blocked !== null || stalled ? 'danger' : owed ? 'warn' : null,
    // Finished is said in the positive colour, standing over the rest, for as long as it is on the ring: until its Dismiss.
    unseen: finished,
    attention: owed ? 3 : finished ? 2 : stalled ? 1 : 0,
  };
}

/** The order the kinds stand in, round the ring: what is finished, then what is being built, then what is held. */
const KINDS: readonly RoadmapStackKind[] = ['finished', 'building', 'held'];

/**
 * What is in flight as the one ring: a wall for each plan the In flight board draws (`plans`, the lane's drawn plans
 * in the lane's order), each read with the roadmap feature it is where a roadmap holds one (`picture`, every roadmap:
 * the ring follows no choice of roadmap or project).
 *
 * The walls keep a readable width (`WIDEST_WALL`) and leave the rest of the rim bare. With nothing in flight it is a
 * ring with no wall.
 *
 * Used by `stack/StackOf`, once per picture, for the ring it hands to `RoadmapStack`.
 */
export function layoutStack(plans: readonly DispatcherPlan[], picture: RoadmapPicture | null): RoadmapStackTier[] {
  const index = placedByName(picture);
  // Laid out first in walls' widths, then scaled to the ring once the whole run is known.
  let cursor = 0;
  const placed: { wall: Omit<RoadmapStackWall, 'at' | 'width'>; unit: number }[] = [];
  for (const kind of KINDS) {
    const walls = plans.filter((plan) => ringKindOf(plan) === kind);
    if (walls.length === 0) continue;
    if (placed.length > 0) cursor += KIND_GAP;
    for (const plan of walls) {
      placed.push({ wall: wallOf(plan, index.get(plan.name) ?? null), unit: cursor + 0.5 });
      cursor += 1;
    }
  }
  // The gap that closes the ring, between the last kind and the first.
  const round = cursor + (placed.length > 0 ? KIND_GAP : 0);
  const scale = round === 0 ? 0 : Math.min(TAU / round, WIDEST_WALL);
  return [{
    name: RING_NAME,
    walls: placed.map(({ wall, unit }) => ({ ...wall, at: unit * scale, width: scale })),
    span: cursor * scale,
  }];
}
