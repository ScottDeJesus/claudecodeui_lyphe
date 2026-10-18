import { useTranslation } from 'react-i18next';

import type { RegionLayer } from '@/shared/types';
import { SegmentedControl } from '@/shared/ui';

type LayerSwitchProps = {
  /** What the photo draws now; the pano screen starts on `all`. */
  layer: RegionLayer;
  onLayer: (layer: RegionLayer) => void;
};

/**
 * STANDING · ALL — what the pano's photo draws. All, the default, is every area the reader marked and every one drawn
 * by hand: the operator is judging what the model proposed, and hiding the unsure ones would hide the ones that most
 * need his eye. Standing is what the system currently believes: only the areas whose wire `standing` flag is true, so
 * an area marked not a change, and one below its kind's threshold unmarked, leave the photo. The flag is the engine's
 * one function; the screen filters by it and never works it out.
 *
 * The list beside the photo keeps every area either way, so a set-aside one can still be chosen and judged.
 *
 * Used by the affected-areas module's `PanoScreen`, at the start of the face photo's tool row (`MissedDraw`'s `tools`).
 */
export function LayerSwitch({ layer, onLayer }: LayerSwitchProps) {
  const { t } = useTranslation();
  return (
    <SegmentedControl<RegionLayer>
      options={[
        { value: 'standing', label: t('affectedAreas.layer.standing') },
        { value: 'all', label: t('affectedAreas.layer.all') },
      ]}
      value={layer}
      onChange={onLayer}
      label={t('affectedAreas.layer.label')}
    />
  );
}
