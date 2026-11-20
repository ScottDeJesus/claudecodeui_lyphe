// The fleet's pure half: the overview as one item per node, worst first, each with its one word and
// the group that word falls in. No React, no clock, no DOM — a function of the overview, so the
// instrument's rings (`utils/fleetRings`), a machine's Opening and the core's summary never disagree
// about which node is worse. Ported from the prototype's `build` (`design/cerberus/cerberus-fleet.js`)
// for the real read model: nothing synthetic, no "fleet size" knob.
import type { CerberusNodeView, CerberusOverview, CerberusRunView, CerberusServiceView } from '@/shared/cerberus-types';
import type { FleetGroup, FleetItem, FleetStatus } from '@/shared/types';

//----------------- ORDER ------------

/**
 * How bad each node status is, the one ranking every sort reads: the smaller, the worse. `failing`
 * and `denied` share the worst place. `fixing` — a fix running — sits just under them: a node whose
 * only trouble is being fixed reads fixing, while one with another service still failing stays
 * failing, since that one still needs you. `updating` (an update queued or running on the node's
 * warden), `paused` (its warden restarting for one) and `enrolling` share the place under no result
 * and above muted: something is going on there, and nothing needs you. `empty` — no service — is
 * last: nothing is wrong, and nothing is on it.
 */
const STATUS_RANK: Record<FleetStatus, number> = {
  failing: 0,
  denied: 0,
  fixing: 1,
  warn: 2,
  unknown: 3,
  paused: 4,
  updating: 4,
  enrolling: 4,
  muted: 5,
  ok: 6,
  empty: 7,
};

/** Ids like `node-2` and `node-10` sort as people count them, and the same way in every browser locale. */
const NODE_ID_ORDER = new Intl.Collator('en', { numeric: true });

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
 * `fixing`, whatever its own word is; its row, its cell and its node's word read it from here.
 */
export function runOnService(running: CerberusRunView[], node: string, service: CerberusServiceView): CerberusRunView | null {
  return running.find((run) => run.node === node && service.checks.some((check) => check.key === run.check)) ?? null;
}

/**
 * A node's word: the worst of its services', `empty` with none. A service with a run going is `fixing`.
 * A service whose every check is switched off on its own side (`not_enabled`) counts as passing here —
 * it is nothing to look at and nothing wrong — while its own row still says what it is.
 *
 * A node whose warden is restarting for an update (`link` `paused`) or has one queued or running
 * (`updating`) starts from that word instead of `ok`, so a node being updated stands on the Updating
 * ring even with nothing else to say — and even with no service, which would otherwise read `empty`.
 * Anything worse still wins: a failing check on a node that is updating still needs you.
 */
function nodeStatusOf(node: CerberusNodeView, running: CerberusRunView[]): FleetStatus {
  const updateWord: FleetStatus | null = node.link === 'paused' ? 'paused' : node.updating !== null ? 'updating' : null;
  if (node.services.length === 0) return updateWord ?? 'empty';
  let worst: FleetStatus = updateWord ?? 'ok';
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

/** One node of the overview as an item: its name, its role, its word, and who started the fix its word may speak of. */
function toFleetItem(node: CerberusNodeView, running: CerberusRunView[]): FleetItem {
  const status = nodeStatusOf(node, running);
  return {
    id: node.id,
    desc: node.desc,
    role: node.role,
    status,
    // Who started the fix the node's line speaks of: its oldest run (`running` is oldest first).
    fixBy: status === 'fixing' ? running.find((run) => run.node === node.id)?.by ?? null : null,
  };
}

/**
 * Every node of the overview as an item, worst first: the order the instrument's rings draw in. The
 * overview already puts the hub first among its nodes; this puts it first among its PEERS of the same
 * word, so a quiet fleet still opens on the server Cerberus runs on.
 */
export function fleetItems(overview: CerberusOverview): FleetItem[] {
  return overview.nodes.map((node) => toFleetItem(node, overview.running)).sort(compareFleetItems);
}

// ---------------------------

//----------------- GROUPS ------------

/**
 * The group a node's word falls in: `needs` is failing, denied, fixing and warn; `updating` is
 * updating, paused and enrolling; every other word is its own group. The instrument's rings stand on
 * these (`utils/fleetRings`), and a machine's Opening inks its line by them.
 */
export function groupOf(status: FleetStatus): FleetGroup {
  switch (status) {
    case 'failing':
    case 'denied':
    case 'fixing':
    case 'warn':
      return 'needs';
    case 'paused':
    case 'updating':
    case 'enrolling':
      return 'updating';
    default:
      return status;
  }
}
