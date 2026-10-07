// The Fleet view's pure half: the overview as one item per node, worst first, counted into the
// toolbar's filter groups, searched, and laid out as rings. No React, no clock, no DOM — a function
// of the overview and the box it is handed, so the grid, the list and the rings never disagree about
// which node is worse. Ported from the prototype's `build` (`design/cerberus/cerberus-fleet.js`)
// for the real read model: nothing synthetic, no "fleet size" knob.
import type { CerberusNodeView, CerberusOverview, CerberusRunView, CerberusServiceView } from '@/shared/cerberus-types';
import type {
  FleetFilter,
  FleetFilterGroup,
  FleetGroup,
  FleetItem,
  FleetService,
  FleetStatus,
  RingSpokeKind,
  RingsLayout,
  RingsNode,
} from '@/shared/types';

//----------------- ORDER ------------

/**
 * How bad each node status is, the one ranking every sort and "is it loud" test reads: the smaller,
 * the worse. `failing` and `denied` share the worst place. `fixing` — a fix running — sits just under
 * them: a node whose only trouble is being fixed reads fixing, while one with another service still
 * failing stays failing, since that one still needs you. `paused`/`enrolling` hold their places for the
 * updates plan. `empty` — no service — is last: nothing is wrong, and nothing is on it.
 */
const STATUS_RANK: Record<FleetStatus, number> = {
  failing: 0,
  denied: 0,
  fixing: 1,
  warn: 2,
  unknown: 3,
  paused: 4,
  enrolling: 4,
  muted: 5,
  ok: 6,
  empty: 7,
};

/** Ids like `node-2` and `node-10` sort as people count them, and the same way in every browser locale. */
const NODE_ID_ORDER = new Intl.Collator('en', { numeric: true });

/** A fleet of this many nodes or fewer opens the nodes that need you on their own. */
const AUTO_EXPAND_MAX_NODES = 12;

/**
 * True when `candidate` is a worse word than `current`. Equal ranks keep the word already held,
 * except that a refusal outranks a failure: red is reserved for denied, and a node with both should
 * read as the one that is refused.
 */
function isWorse(candidate: FleetStatus, current: FleetStatus): boolean {
  const difference = STATUS_RANK[candidate] - STATUS_RANK[current];
  return difference < 0 || (candidate === 'denied' && current === 'failing');
}

/**
 * The run going on one of a service's checks, or null: the oldest of `running` (the overview's runs
 * that have not ended, oldest first) whose check is one of the service's. A service with a run is
 * `fixing`, whatever its own word is; its row, its square and its node's word read it from here.
 */
export function runOnService(running: CerberusRunView[], node: string, service: CerberusServiceView): CerberusRunView | null {
  return running.find((run) => run.node === node && service.checks.some((check) => check.key === run.check)) ?? null;
}

/**
 * A node's word: the worst of its services', `empty` with none. A service with a run going is `fixing`.
 * A service whose every check is switched off on its own side (`not_enabled`) counts as passing here —
 * it is nothing to look at and nothing wrong — while its own row still says what it is.
 */
function nodeStatusOf(node: CerberusNodeView, running: CerberusRunView[]): FleetStatus {
  if (node.services.length === 0) return 'empty';
  let worst: FleetStatus = 'ok';
  for (const service of node.services) {
    const word: FleetStatus = runOnService(running, node.id, service) !== null
      ? 'fixing'
      : service.status === 'not_enabled' ? 'ok' : service.status;
    if (isWorse(word, worst)) worst = word;
  }
  return worst;
}

/** The worst-first order of the fleet: status rank, then the hub ahead of its peers, then id with numeric collation. */
function compareFleetItems(a: FleetItem, b: FleetItem): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || Number(b.role === 'hub') - Number(a.role === 'hub')
    || NODE_ID_ORDER.compare(a.id, b.id);
}

/**
 * One node of the overview as an item: its services cut down to what the fleet lists, and the
 * lower-cased text a search matches — id, description, and each service's id and plain label.
 */
function toFleetItem(node: CerberusNodeView, running: CerberusRunView[]): FleetItem {
  const services: FleetService[] = node.services.map((service) => ({
    service: service.service,
    label: service.label,
    status: service.status,
    counts: service.counts,
  }));
  // A node with no description, or a service with no label, leaves no empty word behind: the joined
  // text has single spaces, so a query that runs across two words ("center cerberus") still matches.
  const words = [node.id, node.desc, ...services.flatMap((service) => [service.service, service.label])]
    .filter((word): word is string => word !== null && word !== '');
  const status = nodeStatusOf(node, running);
  return {
    id: node.id,
    desc: node.desc,
    role: node.role,
    link: node.link,
    status,
    // Who started the fix the node's line speaks of: its oldest run (`running` is oldest first).
    fixBy: status === 'fixing' ? running.find((run) => run.node === node.id)?.by ?? null : null,
    services,
    search: words.join(' ').toLowerCase(),
  };
}

/**
 * Every node of the overview as an item, worst first: the order the grid, the list and the rings all
 * draw in. The overview already puts the hub first among its nodes; this puts it first among its
 * PEERS of the same word, so a quiet fleet still opens on the server Cerberus runs on.
 */
export function fleetItems(overview: CerberusOverview): FleetItem[] {
  return overview.nodes.map((node) => toFleetItem(node, overview.running)).sort(compareFleetItems);
}

// ---------------------------

//----------------- FILTERS, SEARCH AND EXPANSION ------------

/**
 * The bucket a node's status counts in. The status bar counts every bucket, `ok` included; the
 * toolbar's filters are these buckets less `ok`, plus "All". Used by FleetView for the bar.
 */
export function groupOf(status: FleetStatus): FleetGroup {
  switch (status) {
    case 'failing':
    case 'denied':
    case 'fixing':
    case 'warn':
      return 'needs';
    case 'paused':
    case 'enrolling':
      return 'updating';
    default:
      return status;
  }
}

/** The toolbar's buttons, in the order it shows them. */
const FILTER_ORDER: FleetFilter[] = ['all', 'needs', 'unknown', 'muted', 'updating', 'empty'];

/**
 * Every filter button with the number of nodes it would show right now, over the WHOLE fleet — a
 * search box narrows what a button lists, never what its count says. A group with nothing in it is
 * still answered (count 0): whether the toolbar hides it is the toolbar's call.
 */
export function filterGroups(items: FleetItem[]): FleetFilterGroup[] {
  const counts = new Map<FleetGroup, number>();
  for (const item of items) {
    const group = groupOf(item.status);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return FILTER_ORDER.map((group) => ({
    group,
    count: group === 'all' ? items.length : counts.get(group) ?? 0,
  }));
}

/**
 * The items one filter button holds, narrowed by what was typed in the search box: a node whose id,
 * description or service names contain the query, case aside. An empty or blank query narrows
 * nothing, and the order the caller sorted in is kept.
 */
export function applyFilter(items: FleetItem[], group: FleetFilter, query: string): FleetItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (
    (group === 'all' || groupOf(item.status) === group)
    && (needle === '' || item.search.includes(needle))
  ));
}

/**
 * The ids of the nodes that open on their own: those that need you, while the fleet is twelve nodes
 * or fewer — with more, a card per problem would bury the rest, and the toolbar's "Needs you" is
 * the way in. Hand it the WHOLE fleet, never a filtered list, so typing in the search box never
 * changes what opens. A person's own open or close of a node always wins over this default.
 */
export function defaultExpanded(items: FleetItem[]): Set<string> {
  if (items.length > AUTO_EXPAND_MAX_NODES) return new Set();
  return new Set(items.filter((item) => groupOf(item.status) === 'needs').map((item) => item.id));
}

// ---------------------------

//----------------- THE RINGS ------------

// The prototype's geometry. Its ring box was 470 px square: a smaller box shrinks the dots in
// proportion, never below MIN_DOT_SCALE of them. A loud node (needs you, or no result) is never drawn
// under LOUD_DOT, however dense the fleet. Radii are shares of the box's shorter side.
const REFERENCE_SIDE = 470;
const MIN_DOT_SCALE = 0.7;
const MIN_DOT = 5;
const LOUD_DOT = 9;
const DOT_GAP_RATIO = 0.6;
const MAX_RINGS = 7;
const INNER_RING = 0.2;
const OUTER_RING = 0.48;
const LONE_RING_SMALL = 0.3;
const LONE_RING_LARGE = 0.4;
const SMALL_FLEET_MAX_NODES = 8;

/** Each ring is turned this many radians from the one inside it, so their spokes do not line up. */
const RING_TWIST = 0.37;

/** A ring this sparse writes every node's name beside its dot. */
const NAMED_RING_MAX_NODES = 12;

/** Dot diameter for a fleet of this size: the denser the fleet, the smaller each dot. */
function dotFor(total: number): number {
  if (total <= 24) return 18;
  if (total <= 80) return 13;
  if (total <= 260) return 9;
  return 6;
}

/** The radii, as shares of the box side, of `count` rings from the inner outward. */
function ringFractions(count: number, total: number): number[] {
  if (count === 1) return [total <= SMALL_FLEET_MAX_NODES ? LONE_RING_SMALL : LONE_RING_LARGE];
  return Array.from({ length: count }, (_, index) => INNER_RING + ((OUTER_RING - INNER_RING) * index) / (count - 1));
}

/** True for a node that needs attention or has no result: the two the rings draw large and name. */
function isLoud(status: FleetStatus): boolean {
  return STATUS_RANK[status] <= STATUS_RANK.unknown;
}

/** How a node's spoke is drawn: dashed for no result, solid amber for needs you, plain otherwise. */
function spokeKindOf(status: FleetStatus): RingSpokeKind {
  if (status === 'unknown' || status === 'enrolling') return 'dashed';
  return STATUS_RANK[status] <= STATUS_RANK.warn ? 'amber' : 'plain';
}

const roundToHundredth = (value: number): number => Math.round(value * 100) / 100;

const nonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

/**
 * The fleet as rings in a `width` × `height` box, in pixels from its top-left corner: the hub at the
 * centre, every other node on a ring around it, the worst on the inner ring. The rings are circles
 * in the box's shorter side, so a wide box leaves margin and never stretches them to ellipses.
 *
 * As many rings (up to seven) open as the fleet needs, each holding what fits at its radius and the
 * dot's size; a fleet too big for seven places what fits, and `total` against `nodes.length` says
 * so. A box not yet measured (0 × 0) places nothing and does not throw.
 *
 * Hand it the nodes to draw: it picks the hub out by role and sorts the rest worst first itself. The
 * hub is at the centre only if it is in the list, so a caller that filters keeps it in.
 */
export function ringsLayout(items: FleetItem[], width: number, height: number): RingsLayout {
  const boxWidth = nonNegative(width);
  const boxHeight = nonNegative(height);
  const side = Math.min(boxWidth, boxHeight);
  const center = { x: roundToHundredth(boxWidth / 2), y: roundToHundredth(boxHeight / 2) };

  const hub = items.find((item) => item.role === 'hub') ?? null;
  const around = items.filter((item) => item.role !== 'hub').sort(compareFleetItems);
  const total = around.length;

  const scale = Math.min(1, Math.max(MIN_DOT_SCALE, side / REFERENCE_SIDE));
  const dot = Math.max(MIN_DOT, Math.round(dotFor(total) * scale));
  const capacityAt = (fraction: number): number => Math.floor((2 * Math.PI * fraction * side) / (dot * (1 + DOT_GAP_RATIO)));

  let ringCount = 1;
  while (ringCount < MAX_RINGS && ringFractions(ringCount, total).reduce((sum, fraction) => sum + capacityAt(fraction), 0) < total) {
    ringCount += 1;
  }

  const guides: { radius: number }[] = [];
  const nodes: RingsNode[] = [];
  ringFractions(ringCount, total).forEach((fraction, ring) => {
    const onRing = Math.min(capacityAt(fraction), total - nodes.length);
    if (onRing <= 0) return;
    const length = fraction * side;
    guides.push({ radius: roundToHundredth(length) });
    for (let slot = 0; slot < onRing; slot += 1) {
      const item = around[nodes.length];
      const angle = (slot / onRing) * 2 * Math.PI + ring * RING_TWIST - Math.PI / 2;
      const loud = isLoud(item.status);
      nodes.push({
        item,
        ring,
        x: roundToHundredth(center.x + Math.cos(angle) * length),
        y: roundToHundredth(center.y + Math.sin(angle) * length),
        angleDeg: roundToHundredth((((angle * 180) / Math.PI) % 360 + 360) % 360),
        length: roundToHundredth(length),
        dot: loud && dot < LOUD_DOT ? LOUD_DOT : dot,
        spoke: spokeKindOf(item.status),
        live: item.link === 'reporting',
        labelled: (ring === 0 && onRing <= NAMED_RING_MAX_NODES) || (loud && dot >= LOUD_DOT),
      });
    }
  });

  return { center, hub, guides, nodes, total };
}
