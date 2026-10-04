import { useContext, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { Select } from '@/shared/ui';

/**
 * Which roadmap is on screen, chosen from the roadmaps by their titles, with the way to make a new one
 * at the foot of the list — the kanban board switcher's own shape: a reader who opens this list looking
 * for a roadmap that is not there finds how to start it where their hand already is. The choice is the
 * server-backed `roadmapSelected`, so the phone and the desk show the same roadmap.
 *
 * Used by `RoadmapHeader`, over the goal on the face, and by `RoadmapWidgetBody`, the chat gutter's roadmap
 * widget — `sm` in both, the dense trigger that sits beside a 36px button.
 */
export function RoadmapPicker({ size }: { size: 'md' | 'sm' }) {
  const { t } = useTranslation();
  const { roadmaps, selected, select } = useRoadmap();
  const { openDialog } = useContext(RoadmapFaceContext);
  // The Select's own box, to find its trigger in.
  const rootRef = useRef<HTMLDivElement>(null);

  // The Select takes its action button away in the very commit that mounts the dialog, so the dialog would
  // record the page body as the place to give focus back to. The trigger takes focus first, and Escape on
  // the dialog lands the keyboard back on the picker.
  const openNewRoadmap = () => {
    rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="listbox"]')?.focus();
    openDialog({ dialog: 'add', kind: 'roadmap', parent: null });
  };

  return (
    <div ref={rootRef}>
      <Select
        options={roadmaps.map((roadmap) => ({ value: roadmap.name, label: roadmap.title }))}
        value={selected?.name ?? ''}
        onChange={select}
        placeholder={t('roadmap.picker.none')}
        ariaLabel={t('roadmap.picker.label')}
        size={size}
        action={{
          label: t('roadmap.picker.new'),
          onSelect: openNewRoadmap,
        }}
      />
    </div>
  );
}
