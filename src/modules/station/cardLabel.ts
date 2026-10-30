import type { RoadmapPicture } from '@/shared/roadmap-types';

/** What the stage calls a feature or an epic: its title in the roadmap picture, else its name. Consumed by `CardStage` (its roadmap dialogs and epic panel stage a card by it) and `NoteStage` (the plan card a note's ref opens). */
export function labelOf(picture: RoadmapPicture | null, name: string): string {
  if (picture === null) return name;
  for (const roadmap of picture.roadmaps) {
    for (const milestone of roadmap.milestones) {
      for (const epic of milestone.epics) {
        if (epic.name === name) return epic.title;
        const feature = epic.features.find((item) => item.name === name);
        if (feature) return feature.title;
      }
    }
  }
  return picture.unplaced.features.find((item) => item.name === name)?.title
    ?? picture.unplaced.epics.find((item) => item.name === name)?.title
    ?? name;
}
