type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name, for a switch whose visible label sits in a neighbouring cell. */
  label?: string;
  disabled?: boolean;
};

/**
 * The house on/off control: a 52×30 track whose knob slides with a spring.
 * Used by settings (Phase 4) for every appearance and agent toggle and by the sidebar
 * (Phase 5) for its footer settings row — the app hand-rolls a `role="switch"` button in
 * several places today and this is the one shape they converge on.
 *
 * The knob moves with `transform`, never `left`: a transformed knob is composited and never
 * reflows the row it sits in.
 */
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="vv-switch inline-block shrink-0"
    >
      <span className="vv-switch__knob block" />
    </button>
  );
}
