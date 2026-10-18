import { useTranslation } from 'react-i18next';

import type { ToursScreenKey } from '@/shared/types';
import { SegmentedControl } from '@/shared/ui';

type ToursSwitchProps = {
  /** The screen the Tours view shows. */
  screen: ToursScreenKey;
  onScreen: (screen: ToursScreenKey) => void;
};

/**
 * TOURS · MARK · TABLES — the Tours view's own switch, above whichever screen it shows: the tours (picker, tour, pano),
 * the Mark screen walking a queue one area at a time, and the tables that say how right the reader is. Each screen
 * keeps its place while another shows, so a pano left open is still open on the way back from Mark.
 *
 * A row of its own at the view's top, left-aligned at the tray's own width (the view is a column, which would
 * otherwise stretch the tray across it), and outside the screen's entrance, so the switch never re-enters.
 *
 * Used by the affected-areas module's `AffectedAreasView`, at the top of the view.
 */
export function ToursSwitch({ screen, onScreen }: ToursSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-5 flex min-w-0">
      <SegmentedControl<ToursScreenKey>
        options={[
          { value: 'tours', label: t('affectedAreas.screens.tours') },
          { value: 'mark', label: t('affectedAreas.screens.mark') },
          { value: 'tables', label: t('affectedAreas.screens.tables') },
        ]}
        value={screen}
        onChange={onScreen}
        label={t('affectedAreas.screens.label')}
      />
    </div>
  );
}
