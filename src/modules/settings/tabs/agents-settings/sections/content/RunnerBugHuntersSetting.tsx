import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Field, Input, SettingRow } from '@/shared/ui';

type HunterSettingProps = {
  /** The setting's name on the row's root, for a verify script. */
  name: string;
  icon: ReactNode;
  label: ReactNode;
  description: ReactNode;
  /** The dispatcher's sentence for the last change to this setting that it refused. */
  refusal: string | undefined;
  /** The control beside the row's words: a switch, a field, a dropdown. A list goes in `below` instead. */
  children?: ReactNode;
  /** What runs the row's full width under its words: a list. */
  below?: ReactNode;
};

/**
 * One setting of the bug hunters' section: the kit's row, anything that runs its full width under it, and the line a refusal is
 * said on. Used by `RunnerBugHuntersRow`, for each of its seven rows.
 *
 * THE REFUSAL IS THE LAST THING IN THE ROW AND RUNS ITS FULL WIDTH. On a phone that is directly under the control, which is where
 * the eye is when a value snaps back. It is not put inside the control's own 11rem column: the sentence is the dispatcher's, of
 * any length, and in that column a long one stands eight lines tall. Amber, with its mark, and `role="alert"` so it is spoken
 * when it arrives.
 */
export function HunterSetting({ name, icon, label, description, refusal, children = null, below }: HunterSettingProps) {
  const { t } = useTranslation('settings');
  const under = below !== undefined || refusal !== undefined;
  return (
    <div data-runner-bug-hunters={name} data-refused={refusal === undefined ? undefined : ''}>
      <SettingRow icon={icon} label={label} description={description} className={under ? 'pb-3' : undefined}>
        {children}
      </SettingRow>
      {under && (
        <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
          {below}
          {refusal !== undefined && (
            <div role="alert" data-runner-bug-hunters-refusal="" className="text-xs font-medium">
              <HunterWarning>{t('agents.bugHunters.notSaved', { sentence: refusal })}</HunterWarning>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The section's amber line: the warn tone's mark and its words, so the tone is never a colour alone. Used by `HunterSetting` for a
 * refusal, and by `RunnerBugHuntersRow` under the nightly switch while a night would find nothing to hunt.
 */
export function HunterWarning({ children }: { children: ReactNode }) {
  return (
    <p data-tone="warn" className="flex items-start gap-1.5 text-tone-ink">
      <span aria-hidden="true">▲</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

type HunterUnknownProps = {
  icon: ReactNode;
  /** The nightly switch's own label: the section is named by its first row while it has no other. */
  label: string;
  /** True once a read has failed; false while the first read is still out. */
  unreadable: boolean;
  /** Ask the dispatcher again. */
  onRetry: () => void;
};

/**
 * The whole section while no read has answered: one row, the switch's, saying in words that the settings are unknown (which is
 * not the same as off), its slot holding the one act that can be honoured, ask again. Seven rows each saying "Loading" would be
 * six too many. The retry is a square 44 px press under a finger. Used by `RunnerBugHuntersRow`.
 */
export function HunterUnknown({ icon, label, unreadable, onRetry }: HunterUnknownProps) {
  const { t } = useTranslation('settings');
  const retryLabel = t('buttons.retry', { ns: 'common' });
  return (
    <SettingRow
      data-runner-bug-hunters="unknown"
      icon={icon}
      label={label}
      description={unreadable ? t('agents.bugHunters.unreadable') : t('status.loading', { ns: 'common' })}
    >
      <Button
        variant="outline"
        size="sm"
        aria-label={retryLabel}
        title={retryLabel}
        className="finger:h-11 finger:w-11 finger:px-0"
        onClick={() => onRetry()}
      >
        <RefreshCw aria-hidden="true" />
        <span className="finger:hidden">{retryLabel}</span>
      </Button>
    </SettingRow>
  );
}

type HunterTypedFieldProps = {
  /** The field's id: its caption's `htmlFor`, and the handle a verify script reads the value by. Its row's sentence is `<id>-about`. */
  id: string;
  type: 'time' | 'number';
  /** The words over the field: a number's bounds, the clock a time is read by. */
  caption: string;
  /** The field's spoken name, when the caption alone names no setting ("15 to 600"). */
  ariaLabel?: string;
  /** A number's bounds and step. */
  min?: number;
  max?: number;
  step?: number;
  /** What the field draws: the operator's typing while a draft is open, else the saved value. */
  value: string;
  /** True while the last value typed here stands refused: the field wears the amber border, and its row says the sentence. */
  refused: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /** Every keystroke, with the field's whole text. */
  onType: (text: string) => void;
  /** The field was left: the moment its value is written. */
  onLeave: () => void;
};

/**
 * A typed setting of the bug hunters' section: the kit's field under its caption, the board rows' width (`w-44`), so every typed
 * field on the card ends on one edge. Used by `RunnerBugHuntersRow` for the start time, the minutes and the tickets.
 *
 * WRITTEN WHEN IT IS LEFT, and Enter leaves it, so a keyboard commits through the one door a click elsewhere uses. 44 px tall
 * under a finger: the kit's field is 36 px at every width, and this one is a press the phone makes. Never `disabled` while a write
 * is in flight (Chromium blurs a control the instant one lands, and the next value may already be on its way): `aria-busy` says
 * it instead.
 */
export function HunterTypedField({ id, type, caption, ariaLabel, min, max, step, value, refused, saving, onType, onLeave }: HunterTypedFieldProps) {
  return (
    <div aria-busy={saving} className="w-44">
      <Field label={caption} htmlFor={id}>
        <Input
          id={id}
          type={type}
          inputMode={type === 'number' ? 'numeric' : undefined}
          min={min}
          max={max}
          step={step}
          className="finger:h-11"
          invalid={refused}
          value={value}
          aria-label={ariaLabel}
          aria-describedby={`${id}-about`}
          onChange={(event) => onType(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          onBlur={() => onLeave()}
        />
      </Field>
    </div>
  );
}
