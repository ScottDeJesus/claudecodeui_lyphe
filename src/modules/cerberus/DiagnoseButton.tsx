import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { Button } from '@/shared/ui';

type DiagnoseButtonProps = {
  /** The node the check runs on, and the check's key (`<service>/<id>`): what the diagnosis is asked about. */
  node: string;
  checkKey: string;
  /** Its words at rest: "Diagnose" where the check has no diagnosis, "Diagnose again" where it has one. */
  label: string;
  /** The card has stopped needing you and is leaving: drawn as it was, taking no press. */
  disabled?: boolean;
  /**
   * The diagnosis has started (the fleet already holds it). The card opens the sheet on the check, which is where its steps
   * arrive; the sheet reads its own check again. The button stays busy until what this returns settles, so it never comes
   * back as an enabled "Diagnose" before the screen it sits on has heard that the diagnosis exists.
   */
  onStarted?: () => void | Promise<void>;
};

/**
 * "DIAGNOSE": asks for a read-only diagnosis of one check, and sends no model (center picks its own). The press
 * waits for center to take it, which is quick, and reads "Diagnosing…" for that wait, `aria-disabled` and never
 * `disabled`, so the focus stays on the button for the hand that pressed it, and for as long as `onStarted` takes
 * after it. A refusal (a diagnosis already going on the check) is the provider's toast and leaves the button as it was.
 *
 * For the cerberus module's `NeedsYouCard`, where a need with no diagnosis since it went bad offers it, and
 * `SelectedCheck`, the sheet's action row.
 */
export function DiagnoseButton({ node, checkKey, label, disabled = false, onStarted }: DiagnoseButtonProps) {
  const { t } = useTranslation();
  const { diagnose } = useCerberus();
  // Whether the press is out. Essential: center's answer is what turns the label to "Diagnosing…" and back, and
  // no other state on screen says a press is waiting. It ends after `onStarted`, not at center's answer: the sheet's
  // own read of the check brings the diagnosis a moment later, and until it has, an enabled "Diagnose" would take a second press.
  const [pressing, setPressing] = useState(false);

  const onPress = async () => {
    setPressing(true);
    try {
      if (await diagnose(node, checkKey)) await onStarted?.();
    } finally {
      setPressing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={disabled} busy={pressing} onClick={() => void onPress()}>
      {pressing ? t('cerberus.diagnosis.diagnosing') : label}
    </Button>
  );
}
