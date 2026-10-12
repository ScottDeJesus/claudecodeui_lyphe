import { cn } from '@/shared/utils';

type CheckboxProps = {
  checked: boolean;
  /** Called with the state the press asks for; the caller owns `checked`, as with `Switch`. */
  onChange: (next: boolean) => void;
  /** The visible words beside the box, and the control's accessible name. Already translated. */
  label: string;
  disabled?: boolean;
  /**
   * Size and flow on the `<label>`, the press target — never paint (verve/MANUAL.md, MAN-740 rule 2). The
   * Update wardens dialog grows it to its row's full height, so a whole row is one 44 px target.
   */
  className?: string;
};

/**
 * Verve's `forms/Checkbox` (`_ds_bundle.js`, components/forms/Checkbox.jsx): a 20px box that fills
 * with the accent and takes a ✓, with its words beside it. Used by the cerberus module's Update
 * wardens dialog, which lists the enrolled nodes whose warden is behind and lets the operator tick the
 * ones to update.
 *
 * Verve draws a `div` and a click handler; this keeps the draw and swaps the machinery for a real
 * `<input type="checkbox">`, so Tab reaches it, Space toggles it and a screen reader hears the label
 * with the checked state. The input is visually hidden and the box is its sibling: `.vv-checkbox*` in
 * verve/panels.css reads `:checked`, `:disabled` and `:focus-visible` off the input and paints the box
 * from them, so there is no second copy of the state in a class. The whole `<label>` is the target, so
 * the words toggle it too.
 */
export function Checkbox({ checked, onChange, label, disabled = false, className }: CheckboxProps) {
  return (
    // `relative` anchors the hidden input: an absolutely positioned input with no positioned ancestor
    // sits wherever the page's origin puts it, and focusing it would scroll there. `flex`, not
    // `inline-flex`, as Verve draws it: the row is the press target at the parent's full width and
    // carries no inline strut, whether the parent is a block or a flex column.
    <label className={cn('vv-checkbox relative flex items-center gap-2.5', className)}>
      <input
        type="checkbox"
        className="vv-checkbox__input sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="vv-checkbox__box flex h-5 w-5 shrink-0 items-center justify-center text-xs" aria-hidden>
        <span className="vv-checkbox__tick">✓</span>
      </span>
      <span className="vv-checkbox__label">{label}</span>
    </label>
  );
}
