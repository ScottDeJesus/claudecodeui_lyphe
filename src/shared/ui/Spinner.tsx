type SpinnerProps = {
  size?: number;
  /** Says what is being waited for. A ring alone tells the reader only that time is passing. */
  label?: string;
};

/**
 * The house busy indicator: a ring that turns and drifts between accent and garnish.
 * Used by the file manager (Phase 8) while a directory listing or preview is in flight and
 * by the accounts module (Phase 13) while the account loads.
 *
 * `role="status"` makes this a polite live region, so `label` is announced when the ring
 * appears — which is the point of passing one. The screen that owns the work still announces
 * its RESULT; this only says that something is under way.
 */
export function Spinner({ size = 44, label }: SpinnerProps) {
  return (
    <div className="vv-spinner inline-flex flex-col items-center gap-3.5" role="status" aria-busy="true">
      <span className="vv-spinner__ring block" style={{ width: size, height: size }} />
      {label && <span className="vv-spinner__label">{label}</span>}
    </div>
  );
}
