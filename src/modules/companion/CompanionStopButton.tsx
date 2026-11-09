import { Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { Button } from '@/shared/ui';

type CompanionStopButtonProps = {
  /** The companion's name as you set it, or the default while the picture loads: the press's spoken name, "Stop Kaylee's answer". */
  name: string;
  /** Stops the turn that runs; a refusal rejects with the server's sentence. */
  onInterrupt: () => Promise<void>;
};

/**
 * Stop: the one urgent press while a turn runs. Busy from the press until the turn has stopped or the stop is refused; a refusal
 * says so in a warn toast with the server's sentence. The caller draws it only while a turn runs (`picture.turnId`).
 *
 * The rule lives here once (MAN-9090): this module's `CompanionControls` draws it at the head of its line and in the panel's
 * title row, and the station's dock draws it beside the companion's core, where the controls themselves stand behind a press.
 */
export function CompanionStopButton({ name, onInterrupt }: CompanionStopButtonProps) {
  const { t } = useTranslation();
  const pushToast = useToast();
  // Stop is out: the button is busy until the turn has stopped or the stop is refused.
  const [stopping, setStopping] = useState(false);

  const stop = () => {
    setStopping(true);
    onInterrupt()
      .catch((error: unknown) => pushToast({ tone: 'warn', title: t('companion.stopRefused'), message: errorMessage(error) ?? undefined }))
      .finally(() => setStopping(false));
  };

  return (
    <Button variant="outline" size="sm" busy={stopping} onClick={stop} className="shrink-0 finger:h-11" aria-label={t('companion.stopHint', { name })}>
      <Square aria-hidden="true" className="fill-current" />
      {t('companion.stop')}
    </Button>
  );
}
