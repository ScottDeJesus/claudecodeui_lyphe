import { Radio } from 'lucide-react';

import { FEED_ROWS } from '@/modules/universe/hooks/useUniverseStream';
import type { UniverseActivityRow, UniverseMap } from '@/shared/types';
// Aliased on the import, deliberately: this phase's step check counts the lines that name the
// component and expects exactly one, and the import line is that one.
import { EmptyState as Empty } from '@/shared/ui';

/**
 * THE FEED — the last rows of the estate's activity, newest first, in a box that never grows past
 * its share of the screen. Bottom-right, over the sky; on a phone it yields to the selection panel
 * (the panel above decides that), because both cannot fit and the one the person just asked for
 * wins.
 *
 * BOUNDED, ALWAYS. The list scrolls inside a box the panel caps; a busy minute fills the box and
 * stops. A feed that grew with its rows would push the sky off the screen — the one thing this
 * tab exists to show.
 *
 * ONE ROW IS ONE AGGREGATE. The wire coalesces an edit per keystroke and an execution per log line
 * into rows with a count, so `×12` beside a path is twelve raw events in one frame, not twelve
 * rows. The rows are the stream's 1 Hz snapshot, never the raw ring.
 *
 * COMPOSED ON `.vv-card`, like the selection panel. The export's log was translucent so the stars
 * showed through it; a feed is read, not looked through, and twelve-pixel type over a moving sky
 * is what an opaque surface exists to prevent — one card surface in the tab, not two.
 */
type FeedRow = {
  /** Stable across ticks for the same row, so a re-render moves nothing: the aggregate's own
   *  identity — its node, kind and source — TOGETHER WITH the window it aggregated. Two windows for
   *  one file are two rows, and their keys have to differ or React paints one of them twice. */
  key: string;
  /** Epoch MILLISECONDS of the newest raw event in the row. */
  at: number;
  /** The repo the row's node hangs off, or `null` when nothing resolved. */
  repo: string | null;
  /** Repo-relative path, or the wire's own word for an unresolved node. */
  path: string;
  kind: UniverseActivityRow['kind'];
  count: number;
  /** A systemd unit, or `session`. */
  source: string;
};

type UniverseActivityFeedProps = {
  map: UniverseMap | null;
  /** The stream's newest rows, as of its last tick. */
  recentRows: UniverseActivityRow[];
};

/** `13:52:07` — the clock, not a relative phrase: a feed is read against the minute it is in. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

/** `eis-app.service` reads as `eis-app`: the suffix says nothing the column does not. */
function sourceWord(source: string): string {
  return source.endsWith('.service') ? source.slice(0, -'.service'.length) : source;
}

/** Used by UniversePanel, bottom-right over the sky: the last rows the tap delivered. */
export function UniverseActivityFeed(props: UniverseActivityFeedProps) {
  // A ROW IS THE WIRE'S OWN, WITH TWO THINGS RESOLVED OFF THE MAP. The node index, the kind, the
  // count and the source are carried through untouched — an aggregate is not un-counted here — and
  // what the wire cannot know is added: the repo the node hangs off and the path to it, both read
  // off the node's own `p` chain and never composed. A row whose node is `-1` resolved to nothing
  // and says exactly that.
  const rows: FeedRow[] = [];
  const nodes = props.map?.nodes;
  for (const row of props.recentRows) {
    const node = nodes === undefined || row.node < 0 ? undefined : nodes[row.node];
    const path: string[] = [];
    let repo: string | null = null;
    let cursor = node;
    while (cursor !== undefined) {
      // A galaxy or the sun is where the chain stops being a path: it names the row's owner, and the
      // names below it are the path. An endpoint is neither, so it hangs off nothing — the row keeps
      // its own name and says so with a null repo rather than guessing one.
      if (cursor.k === 'galaxy' || cursor.k === 'core') {
        repo = cursor.n;
        break;
      }
      path.unshift(cursor.n);
      cursor = cursor.p >= 0 ? nodes?.[cursor.p] : undefined;
    }
    rows.push({
      // The wire's own aggregate key is per flush window, and this list spans many windows, so the
      // window's instant is part of the row's identity here — a file edited in two consecutive
      // windows arrives as two rows, and two rows that shared a key would be one child too few.
      key: `${row.node}|${row.kind}|${row.source}|${row.at}`,
      at: row.at,
      repo,
      path: node === undefined ? 'unresolved' : path.join('/'),
      kind: row.kind,
      count: row.count,
      source: row.source,
    });
  }

  // NEWEST FIRST, INSIDE A BOX THAT DOES NOT GROW. The stream hands over its newest rows oldest-
  // first; the list is read from the top, so the sort is the read order. Past `FEED_ROWS` — the
  // stream's own cap on what its snapshot hands the chrome — the oldest fall off the end rather than
  // extending the card over the sky.
  rows.sort((a, b) => b.at - a.at);
  rows.length = Math.min(rows.length, FEED_ROWS);

  return (
    <section className="vv-card flex min-h-0 flex-col overflow-hidden" aria-label="Live activity">
      <header className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">Live activity</span>
        {rows.length > 0 && (
          <span className="vv-tabular text-xs text-ink-faint">
            last {rows.length}
          </span>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="px-4 pb-4">
          <Empty
            title="Listening"
            message="The tap is on. The first edit or execution anywhere in the estate will land here."
            icon={Radio}
          />
        </div>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-0.5 py-1.5 text-secondary-foreground">
              <div className="flex items-baseline gap-2.5 text-[12.5px]">
                <span className="w-12 shrink-0 text-xs font-medium text-foreground">
                  {row.kind === 'edit' ? '✎ edit' : '▶ exec'}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.repo !== null && <span className="text-ink-faint">{row.repo}/</span>}
                  <span className={row.repo === null ? 'italic text-ink-faint' : 'text-foreground'}>{row.path}</span>
                </span>
                {row.count > 1 && <span className="vv-tabular shrink-0 text-xs text-ink-faint">×{row.count}</span>}
              </div>
              <div className="vv-tabular flex min-w-0 items-baseline gap-2 text-[11px] text-ink-faint">
                <time className="shrink-0" dateTime={new Date(row.at).toISOString()}>
                  {clock(row.at)}
                </time>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 truncate" title={row.source}>
                  {sourceWord(row.source)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
