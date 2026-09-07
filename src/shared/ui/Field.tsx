import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type FieldProps = {
  label: string;
  /** The id of the control this label names. Omit only when the control is not focusable. */
  htmlFor?: string;
  helper?: string;
  error?: string;
  /** The control cannot be changed from here — the label dims to say so before it is tried. */
  locked?: boolean;
  children: ReactNode;
};

/**
 * The label / control / message stack every form row in the app repeats by hand today.
 * Used by settings (Phase 4) for the git, API and agent forms and by the accounts module
 * (Phase 13); both need the same three-part row and the same amber error line.
 *
 * An error replaces the helper rather than stacking under it: two lines of guidance where
 * one of them is now wrong is how a reader ends up following the wrong one. It carries
 * `role="alert"` so it is announced when it appears — an `aria-invalid` input tells a screen
 * reader THAT the value is rejected, never why.
 *
 * The helper is announced a different way, because it is not an event: it takes the id
 * `<htmlFor>-helper`, and the control inside points `aria-describedby` at that same id (see
 * `AuthInputField`). Both sides derive it from the one `htmlFor` this component already takes,
 * so they cannot drift apart — and with no `htmlFor` they degrade to `undefined` together.
 */
export function Field({ label, htmlFor, helper, error, locked = false, children }: FieldProps) {
  return (
    <div className={cn('vv-field flex flex-col gap-1.5', locked && 'vv-field--locked')}>
      <label className="vv-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="vv-field__error flex items-center gap-1.5" role="alert">
          {error}
        </span>
      ) : helper ? (
        // Named after the control it describes, so the control can point `aria-describedby`
        // at it. Without that the helper is visible and silent: the reader who most needs
        // "at least 6 characters" is the one who never sees it.
        <span className="vv-field__helper" id={htmlFor ? `${htmlFor}-helper` : undefined}>{helper}</span>
      ) : null}
    </div>
  );
}
