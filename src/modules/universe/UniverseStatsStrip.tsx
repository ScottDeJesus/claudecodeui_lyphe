import { isFileKind } from '@/modules/universe/utils/universeBirth';
import type { UniverseMap } from '@/shared/types';
import { Badge } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

/**
 * THE STRIP — six figures and, when the crawler could not answer something, one badge. It sits
 * top-left, over the sky, and holds no control: every tunable's one control is in the Tweaks
 * dialog, and a chip here would be the second control that drifts.
 *
 * EVERY FIGURE IS A SNAPSHOT. The rate is the stream's 1 Hz reading, not a per-frame count, and
 * the rest is read off the map, which moves only when a repo's HEAD does. Nothing here is
 * composed expecting to be fresh more often than once a second.
 *
 * WORDS, NOT GLYPHS. The export marked each figure with a symbol and a tooltip; a person opening
 * this for the first time reads "9,245 stars" without hovering. The numbers are tabular so a
 * rate ticking from 9.8 to 10.1 does not shove its neighbours.
 */
type UniverseStats = {
  repos: number;
  /** Tracked files. */
  stars: number;
  /** Σ `l` over FILE nodes only: a directory's and a repo's `l` roll up the same lines, so a sum over every node counts each line up to four times. */
  lines: number;
  /** Every edge of every kind: tree, import, co-change and endpoint. */
  edges: number;
  /** Epoch SECONDS of the crawl that wrote the map. */
  builtAt: number;
  /** Raw events per second over the last ten seconds, as of the last tick. */
  rate: number;
  /** What the crawler could not answer. Zero hides the badge. */
  warnings: number;
};

type UniverseStatsStripProps = {
  map: UniverseMap | null;
  /** The stream's rate, as of its last tick. */
  rate: number;
};

/** Grouped, whole numbers: `9,245`. */
const PLAIN = new Intl.NumberFormat();
/** Compact for the one figure that runs to seven digits: `1.3M lines`. */
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** One figure and its word. The figure leads, in the ink; the word follows, muted. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </span>
  );
}

/** Used by UniversePanel, top-left over the sky: the map's size, its age, and the live rate. */
export function UniverseStatsStrip(props: UniverseStatsStripProps) {
  const map = props.map;

  // EVERY FIGURE IS READ, NONE IS COMPOSED. The counts are the map's own — it moves only when a
  // repo's HEAD does — and the rate is the stream's 1 Hz reading, handed in: nothing here is
  // fresher than a second and nothing has to be, because a number that ticked per frame would be a
  // number nobody could read. The panel above mounts this only with a map in hand; the null arms
  // are what keeps the arithmetic total rather than what paints the empty case.
  let stars = 0;
  let lines = 0;
  for (const node of map?.nodes ?? []) {
    // FILE nodes only: a directory's and a repo's `l` are the crawler's roll-up of the same lines,
    // so summing over every node would count each line up to four times.
    if (!isFileKind(node.k)) continue;
    stars++;
    lines += node.l;
  }
  let edges = 0;
  if (map !== null) {
    for (const list of Object.values(map.edges)) edges += list.length;
  }

  const stats: UniverseStats = {
    repos: map?.repos.length ?? 0,
    stars,
    lines,
    edges,
    builtAt: map?.builtAt ?? 0,
    rate: props.rate,
    warnings: map?.warnings.length ?? 0,
  };

  const live = stats.rate > 0;

  return (
    <div
      className="vv-tabular flex select-none flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
      role="group"
      aria-label="Map statistics"
    >
      <Stat value={PLAIN.format(stats.repos)} label={stats.repos === 1 ? 'repo' : 'repos'} />
      <Stat value={PLAIN.format(stats.stars)} label="stars" />
      <Stat value={COMPACT.format(stats.lines)} label="lines" />
      <Stat value={PLAIN.format(stats.edges)} label="edges" />
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <span>built</span>
        <span className="font-medium text-foreground">
          {formatRelativeTime(new Date(stats.builtAt * 1000).toISOString())}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span
          className={cn('vv-tone-dot', live && 'vv-pulse')}
          data-tone={live ? 'positive' : 'neutral'}
          data-filled={live ? 'true' : undefined}
          aria-hidden="true"
        />
        <span className="font-medium text-foreground">{stats.rate.toFixed(1)}/s</span>
        <span>live</span>
      </span>
      {stats.warnings > 0 && (
        <Badge tone="warn" className="vv-badge--compact">
          ▲ {stats.warnings} {stats.warnings === 1 ? 'warning' : 'warnings'}
        </Badge>
      )}
    </div>
  );
}
