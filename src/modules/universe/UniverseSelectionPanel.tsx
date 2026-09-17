import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { UniverseCounts } from '@/modules/universe/hooks/useUniverseStream';
import type { UniverseMap, UniverseNode } from '@/shared/types';
import { Badge, Button } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * THE SELECTION — what one node is, read top to bottom in the order a person asks: where is it,
 * what is it, how big, how alive, what does it touch. Top-right, over the sky, absent when nothing
 * is selected: the sky is the invitation, and a card saying "pick a star" would be noise over it.
 *
 * ONLY WHAT THE MAP CARRIES. Every field below is one the crawler writes — the `p` chain for the
 * path, `k`, `l`, `t`, `c`, the edge lists, `routes`, `loggers`, `tables` — or one the stream's
 * 1 Hz snapshot answers (the recent edits and executions its ring holds). Nothing here asks for a
 * fact the fill would have to invent.
 *
 * THE KIND BADGE IS NEUTRAL. A kind is an inert fact, and a fact is untoned (doctrine §9): the word
 * carries it, and the star's own hue lives on the canvas. Amber in this tab is reserved for the
 * crawler's warnings and a failed fetch, and a config file wearing it would spend that meaning.
 *
 * FOUR STATES, ONE COMPOSITION. A star shows everything; a directory has no routes, and its line
 * count is the crawler's roll-up of everything under it; an endpoint has no repo, no length and no
 * history, only the stars that touch it. Each
 * absence is a `null` or an empty list, and the section is simply not drawn — the same tree
 * every time, with fewer rows.
 */
type NeighbourEdge = keyof UniverseMap['edges'];

type UniverseNeighbour = {
  node: number;
  name: string;
  edge: NeighbourEdge;
  /** The edge's weight — co-changes counted, imports usually 1. Shown past 1. */
  weight: number;
};

type UniverseSelection = {
  node: number;
  /** The repo the node hangs off, or `null` for an endpoint, which hangs off nothing. */
  repo: string | null;
  /** The directory part of the repo-relative path, `''` at the repo root. */
  dir: string;
  name: string;
  kind: UniverseNode['k'];
  /** `null` only for an endpoint. A directory or a repo carries the crawler's roll-up of every line under it. */
  lines: number | null;
  /** Epoch SECONDS of the newest commit touching it; `null` for an endpoint. */
  changedAt: number | null;
  commits: number | null;
  /** The five heaviest, heaviest first. */
  neighbours: UniverseNeighbour[];
  /** The HTTP routes this file declares. */
  routes: { m: string; p: string }[];
  /** Logger names this Python module logs under. */
  loggers: string[];
  /** Tables this SQL creates. */
  tables: string[];
  /** Edits and executions as far back as the stream's ring reaches — its last 200 rows, not a clock window. */
  recent: UniverseCounts;
};

type UniverseSelectionPanelProps = {
  map: UniverseMap | null;
  /** The node the panel holds selected, or `null`. */
  selectedNode: number | null;
  /** The stream's per-node totals as of its last tick. */
  countsFor: (node: number) => UniverseCounts;
  /** A neighbour was picked (its node), or the panel was closed (`null`). */
  onSelectNode: (node: number | null) => void;
};

/** Each kind's word. The word is the whole signal; the badge stays neutral. */
const KIND_WORDS: Readonly<Record<UniverseNode['k'], string>> = {
  source: 'source',
  config: 'config',
  docs: 'docs',
  'data-sql': 'data & SQL',
  assets: 'asset',
  other: 'file',
  dir: 'directory',
  galaxy: 'repository',
  core: 'the sun',
  endpoint: 'endpoint',
};

/** Each edge kind as the word beside a neighbour. */
const EDGE_WORDS: Readonly<Record<NeighbourEdge, string>> = {
  tree: 'tree',
  import: 'import',
  cochange: 'co-change',
  endpoint: 'endpoint',
};

const PLAIN = new Intl.NumberFormat();

/** How many neighbours are listed. The five heaviest, heaviest first: the list is a hint at where
 *  the star sits in the graph, not the graph — an estate's hub has hundreds of edges and a card
 *  that held them all would be an inventory. */
const NEIGHBOURS_SHOWN = 5;

/** A captioned block of the panel: the caption is the question, the children the answer. */
function Section({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-faint">{caption}</h3>
      {children}
    </section>
  );
}

/** Used by UniversePanel, top-right over the sky: the selected node, or nothing when none is. */
export function UniverseSelectionPanel(props: UniverseSelectionPanelProps) {
  // EVERY FIELD IS READ OFF THE MAP, and nothing is composed that the map does not carry: the path
  // is the node's own `p` chain, its size and history are the crawler's `l`, `t` and `c`, its
  // neighbours are its edges, and `routes`, `loggers` and `tables` are the three indices pointing
  // back at it. The one figure from elsewhere is the stream's recent-activity reading, handed in —
  // also a measurement, of the ring the tap filled, never a number invented here.
  const map = props.map;
  const id = props.selectedNode;
  let selection: UniverseSelection | null = null;
  if (map !== null && id !== null) {
    const node = map.nodes[id];
    if (node !== undefined) {
      // THE PATH IS WALKED UPWARD, and it stops at the node that owns the star: a galaxy or the sun
      // names the row's repo, and every name between it and this node is the directory path. A root
      // node — a galaxy, the sun — is its own owner, and an endpoint has none, which is what a null
      // repo says and the card spells as `endpoint`.
      const parts = [node.n];
      let repo: string | null = node.k === 'galaxy' || node.k === 'core' ? node.n : null;
      let cursor = node;
      while (repo === null && cursor.p >= 0) {
        const parent = map.nodes[cursor.p];
        if (parent === undefined) break;
        if (parent.k === 'galaxy' || parent.k === 'core') {
          repo = parent.n;
          break;
        }
        parts.unshift(parent.n);
        cursor = parent;
      }

      // The heaviest links first, over every edge kind at once: an import, a co-change, a tree edge
      // and an endpoint are all answers to "what does this touch", and the heaviest is the one the
      // card is actually telling you about.
      const neighbours: UniverseNeighbour[] = [];
      for (const edge of Object.keys(map.edges) as NeighbourEdge[]) {
        for (const [a, b, weight] of map.edges[edge]) {
          if (a !== id && b !== id) continue;
          const other = map.nodes[a === id ? b : a];
          if (other === undefined) continue;
          neighbours.push({ node: a === id ? b : a, name: other.n, edge, weight });
        }
      }
      neighbours.sort((first, second) => second.weight - first.weight);
      neighbours.length = Math.min(neighbours.length, NEIGHBOURS_SHOWN);

      const endpoint = node.k === 'endpoint';
      selection = {
        node: id,
        repo,
        dir: parts.slice(0, -1).join('/'),
        name: node.n,
        kind: node.k,
        lines: endpoint ? null : node.l,
        changedAt: endpoint || node.t <= 0 ? null : node.t,
        commits: endpoint ? null : node.c,
        neighbours,
        routes: map.routes.filter((route) => route.n === id).map(({ m, p }) => ({ m, p })),
        loggers: Object.entries(map.loggers)
          .filter(([, at]) => at === id)
          .map(([name]) => name),
        tables: Object.entries(map.tables)
          .filter(([, at]) => at === id)
          .map(([name]) => name),
        recent: props.countsFor(id),
      };
    }
  }

  // A neighbour is a choice like a click on the sky: the same door, from the card's own list.
  const onPickNeighbor = (node: number): void => props.onSelectNode(node);
  // Closing the card is choosing nothing — the panel above drops the selection, and with it the
  // feed's yield on a phone and the camera's hold on the star.
  const onClose = (): void => props.onSelectNode(null);

  if (selection === null) return null;

  const changed = selection.changedAt === null ? null : new Date(selection.changedAt * 1000);

  return (
    <aside className="vv-card flex min-h-0 flex-col overflow-hidden" aria-label="Selected node">
      <div className="flex items-start justify-between gap-3 pl-5 pr-2 pt-3">
        <div className="min-w-0 truncate pt-2 text-xs text-ink-faint">
          <span className="uppercase tracking-[0.14em]">{selection.repo ?? 'endpoint'}</span>
          {selection.dir !== '' && <span className="font-mono"> · {selection.dir}/</span>}
        </div>
        <Button variant="ghost" size="sm" className="px-2" aria-label="Close" title="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <h2 className="mt-1 break-words font-serif text-[28px] leading-tight text-foreground">{selection.name}</h2>

        <div className="vv-tabular mt-3 flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
          <Badge tone="neutral">{KIND_WORDS[selection.kind]}</Badge>
          {selection.lines !== null && <span>{PLAIN.format(selection.lines)} lines</span>}
          {selection.commits !== null && (
            <span>
              {PLAIN.format(selection.commits)} {selection.commits === 1 ? 'commit' : 'commits'}
            </span>
          )}
        </div>
        {changed !== null && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Changed {formatRelativeTime(changed.toISOString())} · {changed.toLocaleDateString()}
          </p>
        )}

        <hr className="mt-4 border-border" />

        <Section caption="Recent activity">
          <div className="vv-tabular flex gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{PLAIN.format(selection.recent.edits)}</span>{' '}
              {selection.recent.edits === 1 ? 'edit' : 'edits'}
            </span>
            <span>
              <span className="font-medium text-foreground">{PLAIN.format(selection.recent.execs)}</span>{' '}
              {selection.recent.execs === 1 ? 'execution' : 'executions'}
            </span>
          </div>
        </Section>

        <Section caption={`Heaviest neighbours · ${selection.neighbours.length}`}>
          {selection.neighbours.length === 0 ? (
            <p className="text-[13px] text-ink-faint">Nothing links to it.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {selection.neighbours.map((neighbour) => (
                <li key={neighbour.node}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    onClick={() => onPickNeighbor(neighbour.node)}
                  >
                    <span className="min-w-0 flex-1 truncate">{neighbour.name}</span>
                    <span className="vv-tabular shrink-0 text-xs text-ink-faint">
                      {EDGE_WORDS[neighbour.edge]}
                      {neighbour.weight > 1 && ` ×${neighbour.weight}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {selection.routes.length > 0 && (
          <Section caption="Serves">
            <ul className="flex flex-col gap-1 font-mono text-xs">
              {selection.routes.map((route) => (
                <li key={`${route.m} ${route.p}`} className="flex gap-2">
                  <span className="w-12 shrink-0 text-ink-faint">{route.m}</span>
                  <span className="break-all text-secondary-foreground">{route.p}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {selection.loggers.length > 0 && (
          <Section caption="Logs as">
            <ul className="flex flex-col gap-1 font-mono text-xs text-secondary-foreground">
              {selection.loggers.map((logger) => (
                <li key={logger} className="break-all">
                  {logger}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {selection.tables.length > 0 && (
          <Section caption="Creates tables">
            <div className="flex flex-wrap gap-1.5">
              {selection.tables.map((table) => (
                <Badge key={table} tone="neutral" variant="outline" className="vv-badge--compact font-mono">
                  {table}
                </Badge>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}
