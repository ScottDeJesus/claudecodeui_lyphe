import type { Tone } from '@/shared/types';

type ShareBarProps = {
  /** How much of its track it fills, from 0 to 1; outside that, the nearest end. */
  share: number;
  /** Its fill's ink, a tone's dot: `warn` for a count of things gone wrong, `positive` for the finished. Left off, the chart ink. */
  tone?: Tone;
};

/**
 * Used by the analytics module's Code Mode section: how the scripts fared (each fault against the commonest, the edits
 * merged of those handed to the merger) and each family of failures against the commonest.
 *
 * A SHARE AS A LENGTH and nothing else: a square-ended fill on the track, Astrolabe's meter without its words, because the
 * figure beside it is the reading and is what is said. It is paint (`aria-hidden`): a caller never lets it stand alone.
 *
 * The fill grows from the left on arrival and glides when the share changes, still under `prefers-reduced-motion`.
 *
 * Paint: `verve/readings.css`.
 */
export function ShareBar({ share, tone }: ShareBarProps) {
  const filled = Math.min(1, Math.max(0, share));
  return (
    <span className="vv-sharebar" data-tone={tone !== undefined && tone !== 'neutral' ? tone : undefined} aria-hidden="true">
      <span className="vv-sharebar__fill" style={{ transform: `scaleX(${filled})` }} />
    </span>
  );
}
