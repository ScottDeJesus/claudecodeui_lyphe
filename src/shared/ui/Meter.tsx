import { cn } from '@/shared/utils';

type MeterProps = {
  /** `null` means the number is genuinely unknown — never 0, which reads as "none used". */
  percent: number | null;
  tone?: 'accent' | 'warn';
  label: string;
  /**
   * The accessible name, when the visible label is not it. The inline register abbreviates —
   * "5h" beside a 4px bar — and "5h" read aloud names no window anyone knows.
   */
  ariaLabel?: string;
  /** The figure as the reader should see it: "42% used", "$4.20 of $25.00". */
  value: string;
  sub?: string;
  /**
   * `stacked` is the full block — label and figure over the bar, with room for `sub`.
   * `inline` is the one-line form for tight chrome (the sidebar's account row): label, track and
   * figure on a single baseline, no `sub`.
   */
  variant?: 'stacked' | 'inline';
};

/**
 * A labelled horizontal bar with its figure and a line of context under it.
 * Used by the accounts module (Phase 13) for the usage windows on the signed-in account, by the
 * file manager for an upload in flight, and by TaskMaster's task card for its subtask progress;
 * all three need the same bar and the same treatment of a figure nobody has yet.
 *
 * The fill scales with `transform`, never `width`, so the bar animates without laying the
 * row out again on every frame. An unknown percent draws no fill at all and shows an
 * em-dash — a bar at zero would claim something the app does not know.
 */
export function Meter({ percent, tone = 'accent', label, ariaLabel, value, sub, variant = 'stacked' }: MeterProps) {
  const known = percent !== null;
  const clamped = known ? Math.min(100, Math.max(0, percent)) : 0;

  // One track, spelled once, so the two registers can never drift on how a fill is drawn or on
  // what an unknown percent looks like.
  const track = (
    <span className="vv-meter__track block">
      {known && <span className="vv-meter__fill block" style={{ transform: `scaleX(${clamped / 100})` }} />}
    </span>
  );

  const aria = {
    role: 'meter' as const,
    'aria-label': ariaLabel ?? label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    ...(known ? { 'aria-valuenow': clamped } : {}),
    'aria-valuetext': known ? value : 'unknown',
  };

  // `sub` is deliberately dropped in the inline register rather than wrapped under the bar: this
  // form exists for a row that has one line to spare, and a second line would defeat it. The
  // caller that needs context passes `stacked`.
  if (variant === 'inline') {
    return (
      <div
        className={cn('vv-meter vv-meter--inline flex min-w-0 items-center gap-1.5', tone === 'warn' && 'vv-meter--warn')}
        {...aria}
      >
        <span className="vv-meter__label">{label}</span>
        {track}
        <span className="vv-meter__value">{known ? value : '—'}</span>
      </div>
    );
  }

  return (
    <div
      className={cn('vv-meter flex flex-col gap-1.5', tone === 'warn' && 'vv-meter--warn')}
      {...aria}
    >
      <div className="vv-meter__row flex gap-2">
        <span className="vv-meter__label">{label}</span>
        <span className="vv-meter__value">{known ? value : '—'}</span>
      </div>
      {track}
      {sub && <span className="vv-meter__sub">{sub}</span>}
    </div>
  );
}
