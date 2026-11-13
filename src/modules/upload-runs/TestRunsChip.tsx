import { useTranslation } from 'react-i18next';

import { Chip } from '@/shared/ui';

type TestRunsChipProps = {
  /** Test runs are listed: the answer was asked for with them. */
  selected: boolean;
  onToggle: () => void;
};

/**
 * TEST RUNS: the toggle that also lists dry runs, which are off until asked for since a dry run is not an upload.
 *
 * The Runs list draws it among its chips, and a window in which no upload ran draws it alone, under the empty state:
 * with no list there are no chips, and a window that holds only test runs (a new account's first ones) would otherwise
 * have no way to show them.
 *
 * The chip changes home when its press is answered (a window that holds runs draws the list, and any other the empty
 * state), which unmounts the button that was pressed. The wrapper names the chip wherever it stands, so `UploadsView` can
 * carry keyboard focus to it; `contents` leaves it out of the layout.
 *
 * Used by this module's `RunList` and `UploadsView`.
 */
export function TestRunsChip({ selected, onToggle }: TestRunsChipProps) {
  const { t } = useTranslation();
  return (
    <span className="contents" data-uploads-tests-chip>
      <Chip size="sm" className="finger:min-h-11" selected={selected} onClick={onToggle} title={t('cerberus.uploads.runs.testsTitle')}>
        {t('cerberus.uploads.runs.tests')}
      </Chip>
    </span>
  );
}
