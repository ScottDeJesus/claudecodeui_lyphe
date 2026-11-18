type SpinnerProps = {
  /** The loop's outer size in px. */
  size?: number;
  /** Words under the loop, in the faint ink ("Reading the roadmap…"). */
  label?: string;
};

/** The loop's own geometry in its 44-unit box: a hairline track, and the same circle broken into dashes that turn. */
const LOOP_RADIUS = 19;
const LOOP_CIRCUMFERENCE = 2 * Math.PI * LOOP_RADIUS;

/**
 * Used across the app's modules wherever something is on its way (a read, a load, a turn being worked on): Astrolabe's thinking
 * loop — the instrument's ring broken into dashes that turn while the answer is pending, the same sign Kaylee's face makes when
 * she thinks. A hairline track holds the circle so it reads as one ring at any size; the dashes are the accent, the one live colour.
 * Under reduced motion the dashes hold still. It is a status region, so a label is read out with it.
 */
export function Spinner({ size = 44, label }: SpinnerProps) {
  // Twelve dashes round the ring at any size: each a quarter longer than its gap.
  const dash = LOOP_CIRCUMFERENCE / 12;
  return (
    <div className="vv-spinner inline-flex flex-col items-center gap-3.5" role="status" aria-busy="true">
      <svg className="vv-spinner__ring block" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
        <circle className="vv-spinner__track" cx="22" cy="22" r={LOOP_RADIUS} />
        <circle className="vv-spinner__dashes" cx="22" cy="22" r={LOOP_RADIUS} strokeDasharray={`${dash * 0.56} ${dash * 0.44}`} />
      </svg>
      {label && <span className="vv-spinner__label">{label}</span>}
    </div>
  );
}
