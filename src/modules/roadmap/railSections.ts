import type { Roadmap, RoadmapFeature } from '@/shared/roadmap-types';

/**
 * What a roadmap wants from the operator and what is moving, in the four sections the rail draws, each
 * in path order (milestone, then epic, then feature, as the store orders them): `waiting` is every
 * feature that holds the operator's Accept or his answers, `inFlight` what is being built, `next` the
 * proposed features that come after, and `blocked` the unfinished features something is holding back.
 *
 * A feature is blocked by its own reason or by the epic's or the milestone's above it — the nearest one
 * wins — and the row it comes back in carries THAT reason as its `blocked`, in every section, so a row
 * never says less than why it is held. A shipped feature is not listed as blocked: it is done, whatever
 * stands above it. (The standing line's own "blocked" count does count it — the dispatcher's
 * `report_roadmap.py` counts each feature once for any reason above it — so the two can differ by the
 * shipped features of a blocked epic or milestone.)
 *
 * A feature can sit in two sections — an in-flight feature that is paused behind a blocked epic is both —
 * and each section is a view of the same picture, not a partition of it. Pure: the picture in, the
 * sections out. Used by `RoadmapRail` and by the chat gutter's roadmap widget, which draws the very same
 * four sections.
 */
export function railSections(roadmap: Roadmap) {
  const placed = roadmap.milestones.flatMap((milestone) => milestone.epics.flatMap((epic) => epic.features.map((feature): RoadmapFeature => {
    const blocked = feature.blocked ?? epic.blocked ?? milestone.blocked;
    return blocked === feature.blocked ? feature : { ...feature, blocked };
  })));
  return {
    waiting: placed.filter((feature) => feature.waiting_on_you !== null),
    inFlight: placed.filter((feature) => feature.word === 'in flight'),
    next: placed.filter((feature) => feature.word === 'proposed'),
    blocked: placed.filter((feature) => feature.blocked !== null && feature.word !== 'shipped'),
  };
}
