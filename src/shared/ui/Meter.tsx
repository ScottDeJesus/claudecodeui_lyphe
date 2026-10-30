import { useTranslation } from 'react-i18next';

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
   * `inline` is the one-line form for tight chrome (a table cell, a checklist row, a card's strip): label, track and
   * figure on a single baseline, no `sub`.
   * `ring` is the glanceable form for a rail or a header: a thick ring, 28px across, whose arc fills clockwise from 12
   * o'clock to `percent` and whose middle holds `label` (a word or two: "5h"). It draws no figure and no `sub` — the
   * caller's tooltip says the words — so `ariaLabel` is what names it, and `value` still feeds `aria-valuetext`.
   */
  variant?: 'stacked' | 'inline' | 'ring';
  /**
   * The ceiling, in percent, as a tick on the track — drawn only when given, so every meter that
   * is not a usage window's is exactly the bar it was. The raw figure is kept for the words and
   * for a probe even where the tick itself is clamped to the track's end.
   */
  tickAt?: number | null;
  /**
   * The projected end, in percent, as a mark on the track — drawn only when given, on the same rule.
   * A projected end past the ceiling, or past 100, is drawn AS IT IS: its mark sits at the track's
   * end and the words still say the real figure.
   */
  markAt?: number | null;
};

/**
 * A labelled horizontal bar with its figure and a line of context under it — or, as `variant="ring"`, a small ring.
 * Used by the accounts module (Phase 13) for the usage windows on the signed-in account (the bars in its panel, and the
 * two rings at the foot of the project-workspace rail), by the file manager for an upload in flight, by
 * TaskMaster's task card for its subtask progress, and by the companion module's face card in Settings for the frames of
 * her new face made so far; all of them need the same treatment of a figure nobody has yet.
 *
 * THE RING takes its arc's colour from `--tone-dot`, which the nearest `data-tone` container hands down (README rule 4:
 * tone is a token swap), and names no colour of its own: with no container it falls back to the meter's own accent, or
 * to the warn amber when `tone="warn"`. The arc sweeps and the colour eases when the figure or the tone changes, and
 * stands still under `prefers-reduced-motion`.
 *
 * The fill scales with `transform`, never `width`, so the bar animates without laying the
 * row out again on every frame. An unknown percent draws no fill at all and shows an
 * em-dash — a bar at zero would claim something the app does not know.
 *
 * TWO ANNOTATIONS ON THE TRACK, and only when a caller gives them: the ceiling tick (a full-height
 * hairline) and the projected end's mark (a short notch standing proud of the bar). Both are the
 * mode's own ink inside a 1px surface ring. The ink is what reads on the track and the plane; the
 * ring is what keeps one of the two at 3:1 wherever a filled bar runs underneath — the ink over an
 * amber fill in light, the ring over it in dark (MAN-578, MAN-579). They are NOT the meter's value
 * and never change its bounds, its fill or its tone: a projection past the ceiling is a forecast,
 * not a fault, and never wears amber (MAN-464, MAN-577).
 * The words a reader on assistive tech hears carry both figures after the value, because the marks
 * are paint and nothing else. A meter given neither is the same DOM and the same rendering as before
 * they existed.
 */
export function Meter({ percent, tone = 'accent', label, ariaLabel, value, sub, variant = 'stacked', tickAt, markAt }: MeterProps) {
  const { t } = useTranslation();
  const known = percent !== null;
  const clamped = known ? Math.min(100, Math.max(0, percent)) : 0;

  // The marks' positions are clamped to the track; their figures are not, and stay in the words.
  const tick = tickAt == null ? null : Math.min(100, Math.max(0, tickAt));
  const mark = markAt == null ? null : Math.min(100, Math.max(0, markAt));

  // One track, spelled once, so the two registers can never drift on how a fill is drawn or on
  // what an unknown percent looks like.
  const bareTrack = (
    <span className="vv-meter__track block">
      {known && <span className="vv-meter__fill block" style={{ transform: `scaleX(${clamped / 100})` }} />}
    </span>
  );
  // The wrapper exists ONLY when a mark is asked for, so every other Meter's tree is untouched.
  const track = tick === null && mark === null ? bareTrack : (
    <span className="relative block">
      {bareTrack}
      {tick !== null && (
        <span
          aria-hidden="true"
          data-meter-tick={String(tickAt)}
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground ring-1 ring-card"
          style={{ left: `${tick}%` }}
        />
      )}
      {mark !== null && (
        <span
          aria-hidden="true"
          data-meter-mark={String(markAt)}
          className="pointer-events-none absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-1 ring-card"
          style={{ left: `${mark}%` }}
        />
      )}
    </span>
  );

  // A mark is paint; its figure is put in the meter's words. The order is the reading order a
  // sighted reader takes off the bar: the value, the ceiling, then where the work is heading.
  const markWords: string[] = [];
  if (tickAt != null) markWords.push(t('usage.pace.ceiling', { percent: Math.round(tickAt), defaultValue: 'ceiling {{percent}}%' }));
  if (markAt != null) markWords.push(t('usage.pace.projected', { percent: Math.round(markAt), defaultValue: '{{percent}}% projected' }));
  const valueWords = known ? value : 'unknown';

  const aria = {
    role: 'meter' as const,
    'aria-label': ariaLabel ?? label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    ...(known ? { 'aria-valuenow': clamped } : {}),
    'aria-valuetext': markWords.length > 0 ? `${valueWords} · ${markWords.join(', ')}` : valueWords,
  };

  // The ring: a pie with its middle cut out for the label. Both circles share one 0..100 path length, so the arc's
  // length is `percent` whatever the radius, and `strokeDashoffset` (100 minus the figure) is the only thing that moves
  // when the figure does — which is what the CSS transition sweeps. An unknown percent draws no arc at all: a track
  // alone says "no reading", where an arc at zero would claim "none used". `tickAt`, `markAt` and `sub` belong to the
  // bar registers and are not drawn here.
  if (variant === 'ring') {
    return (
      <div className={cn('vv-meter vv-meter--ring', tone === 'warn' && 'vv-meter--warn')} {...aria}>
        <svg className="vv-meter__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
          <circle className="vv-meter__ring-track" cx="14" cy="14" r="11.75" pathLength={100} />
          {known && (
            <circle
              className="vv-meter__arc"
              cx="14"
              cy="14"
              r="11.75"
              pathLength={100}
              style={{ strokeDashoffset: 100 - clamped }}
            />
          )}
        </svg>
        <span className="vv-meter__ring-label">{label}</span>
      </div>
    );
  }

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
