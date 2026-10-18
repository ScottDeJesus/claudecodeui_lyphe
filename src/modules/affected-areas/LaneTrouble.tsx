import { useTranslation } from 'react-i18next';

import type { AffectedAreasTrouble } from '@/shared/types';
import { Banner, Button } from '@/shared/ui';

type LaneTroubleProps = {
  trouble: AffectedAreasTrouble;
  /** What the read was of, which names a missing or failed one: the list, a tour, or a pano. */
  subject: 'tours' | 'tour' | 'pano';
  onRetry: () => void;
};

/** The three faults that are the lane's or shadow-connector's whatever was asked; each carries a second line. */
const LANE_FAULTS: readonly AffectedAreasTrouble[] = ['no_secret', 'unreachable', 'unreadable'];

/**
 * "shadow-connector can't be reached" with Try again: what a Tours screen draws where its read brought no
 * answer. One spelling for the view, the shape of Cerberus's own `UnreachableBanner` (a warn banner, the first
 * line medium, Try again 44 px tall below `md`), with this lane's own causes in its own words:
 * - the lane could not read shadow-connector's secret: nothing can be read until the env file holds it;
 * - shadow-connector did not answer in time, or answered what CloudCLI cannot read;
 * - the tour or pano is gone, or the read failed some other way, named by what was being read.
 *
 * Warn, not danger: nothing was refused by a person. The wrapper is an alert, heard when it mounts.
 *
 * Used by the affected-areas module's `TourPicker`, `TourScreen` and `PanoScreen`.
 */
export function LaneTrouble({ trouble, subject, onRetry }: LaneTroubleProps) {
  const { t } = useTranslation();
  const lane = LANE_FAULTS.includes(trouble);
  return (
    <div role="alert">
      <Banner
        tone="warn"
        action={(
          <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>
            {t('affectedAreas.trouble.retry')}
          </Button>
        )}
      >
        <p className="text-sm font-medium">
          {lane ? t(`affectedAreas.trouble.${trouble}`) : t(`affectedAreas.trouble.${trouble}`, { context: subject })}
        </p>
        {lane && <p className="mt-0.5 text-xs">{t(`affectedAreas.trouble.${trouble}Detail`)}</p>}
      </Banner>
    </div>
  );
}
