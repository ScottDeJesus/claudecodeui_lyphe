import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Switch } from '@/shared/ui';
import { cn } from '@/shared/utils';

type AutoDiagnosisSwitchProps = {
  /** Whether the check diagnoses on its own, as the check's read last answered. Drawn as handed, except while a press is out. */
  on: boolean;
  /** The press, with the position pressed. Settles once the write has landed or been refused (the provider toasts a refusal) and the check has been read again. */
  onChange: (on: boolean) => Promise<void>;
};

/**
 * "DIAGNOSE ON ITS OWN": the switch that lets Cerberus diagnose one check by itself once it has stayed red, with
 * what that means under it ("When it stays red 10 minutes, Cerberus reads it, read-only, and your phone's alert says
 * what it found."). It is composed like the catalog's auto-run switch beside its line, with the helper under the word.
 *
 * The switch carries the name; the word beside it is for the eye, and the two together are the press, a 44 px
 * catch under a finger, as the companion's Live is. The helper stands outside that press, so a tap on what it says
 * never flips the switch.
 *
 * While a press is out the switch shows the position pressed and takes no other press; once the press settles it
 * shows `on` as handed, so a refused write falls back on its own. A switch that turns disabled drops its focus to the
 * page (Chromium 145, measured), so a press made with the focus on the switch gets it back once the press settles.
 *
 * For the cerberus module's `SelectedCheck`, which draws it under the check sheet's action row.
 */
export function AutoDiagnosisSwitch({ on, onChange }: AutoDiagnosisSwitchProps) {
  const { t } = useTranslation();
  const label = t('cerberus.diagnosis.auto.label');
  const rowRef = useRef<HTMLDivElement>(null);
  // The position pressed while its press is out, or null when none is. Essential: `on` moves only once the write and
  // the check's read have settled, and until then the switch shows where it was pressed, not where it stood.
  const [pressed, setPressed] = useState<boolean | null>(null);
  // Whether the focus was on the switch when the press went out: only then does the focus come back to it.
  const pressedWithFocusRef = useRef(false);

  useEffect(() => {
    if (pressed !== null || !pressedWithFocusRef.current) return;
    pressedWithFocusRef.current = false;
    const row = rowRef.current;
    const active = row?.ownerDocument.activeElement ?? null;
    if (active === null || active === active.ownerDocument.body) row?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus();
  }, [pressed]);

  const press = async (next: boolean) => {
    const row = rowRef.current;
    pressedWithFocusRef.current = row !== null && row.contains(row.ownerDocument.activeElement);
    setPressed(next);
    try {
      await onChange(next);
    } finally {
      setPressed(null);
    }
  };

  return (
    <div ref={rowRef} className="flex flex-col">
      <label className={cn('flex w-fit max-w-full items-center gap-3 finger:min-h-11', pressed === null && 'cursor-pointer')}>
        <Switch checked={pressed ?? on} onChange={(next) => void press(next)} label={label} disabled={pressed !== null} />
        <span aria-hidden className="text-sm font-medium text-foreground">{label}</span>
      </label>
      {/* Under the word, past the switch's 52 px and the 12 px between them. */}
      <p className="text-pretty pl-16 text-[12.5px] text-muted-foreground">{t('cerberus.diagnosis.auto.helper')}</p>
    </div>
  );
}
