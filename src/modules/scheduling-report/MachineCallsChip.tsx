import { useTranslation } from 'react-i18next';

import { Chip } from '@/shared/ui';

type MachineCallsChipProps = {
  /** Machine calls are listed: the answer was asked for with them. */
  selected: boolean;
  onToggle: () => void;
};

/**
 * MACHINE CALLS: the toggle that also lists what a machine scheduled (a script, a check, another system through the
 * API). Off until asked for: a machine's call is in no figure of the view, so listing it is a choice.
 *
 * The Sessions list draws it among its chips, and a window in which nobody scheduled draws it alone, under the empty
 * state: with no list there are no chips, and a window that holds only machine calls would otherwise have no way to
 * show them.
 *
 * The chip changes home when its press is answered (a window that holds entries draws the list, and any other the empty
 * state), which unmounts the button that was pressed. The wrapper names the chip wherever it stands, so the root can
 * carry keyboard focus to it; `contents` leaves it out of the layout.
 *
 * Used by this module's `EntryList` and `SchedulingView`.
 */
export function MachineCallsChip({ selected, onToggle }: MachineCallsChipProps) {
  const { t } = useTranslation();
  return (
    <span className="contents" data-scheduling-machines-chip>
      <Chip size="sm" className="finger:min-h-11" selected={selected} onClick={onToggle} title={t('cerberus.scheduling.sessions.machinesTitle')}>
        {t('cerberus.scheduling.sessions.machines')}
      </Chip>
    </span>
  );
}
