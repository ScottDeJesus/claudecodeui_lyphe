import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_ROADMAP_VIEW } from '@/modules/roadmap/fake'; // FILL: fake — import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { Select } from '@/shared/ui';

/**
 * Which roadmap is on screen, chosen from the roadmaps by their titles, with the way to make a new one
 * at the foot of the list — the kanban board switcher's own shape: a reader who opens this list looking
 * for a roadmap that is not there finds how to start it where their hand already is. The choice is the
 * server-backed `roadmapSelected`, so the phone and the desk show the same roadmap.
 *
 * Used by `RoadmapHeader`, over the goal on the face, and by the chat gutter's roadmap widget through the
 * module's barrel — `sm` in both, the dense trigger that sits beside a 36px button.
 */
export function RoadmapPicker({ size }: { size: 'md' | 'sm' }) {
  const { t } = useTranslation();
  const { roadmaps, selected, select } = useContext(FAKE_ROADMAP_VIEW); // FILL: roadmap — useRoadmap(): the picture's roadmaps, the one on screen, and select(name), which writes roadmapSelected whole
  // FILL: dialogs — the dialog host's opener (RoadmapPath provides it): New roadmap… opens ItemDialog adding a roadmap

  return (
    <Select
      options={roadmaps.map((roadmap) => ({ value: roadmap.name, label: roadmap.title }))}
      value={selected?.name ?? ''}
      onChange={select}
      placeholder={t('roadmap.picker.none')}
      ariaLabel={t('roadmap.picker.label')}
      size={size}
      action={{
        label: t('roadmap.picker.new'),
        onSelect: () => {}, // FILL: onNew — ItemDialog adding a roadmap (kind roadmap), through the dialog host's opener
      }}
    />
  );
}
