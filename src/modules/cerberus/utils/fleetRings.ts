import type { TFunction } from 'i18next';

import { groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { markLook, nodeMark } from '@/modules/cerberus/utils/cerberusStatus';
import { nodeLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusNodeView } from '@/shared/cerberus-types';
import type { AstrolabeRing, AstrolabeRingItem, AstrolabeRingState, FleetItem, FleetStatus } from '@/shared/types';

/**
 * THE FLEET'S MACHINES AS MARKS ON RINGS: what Cerberus's instrument (`CerberusInstrument`) draws, worked out from the fleet model's
 * items (`fleetItems`, worst first). A ring is a state, and the rings stand still while machines move between them:
 *
 * - NEEDS YOU, innermost: a check failing, refused, close to its limit, or being fixed (the fleet model's `needs` group).
 * - UPDATING: a warden updating, restarting for an update, or a machine enrolling.
 * - PASSING: every check passing.
 * - SILENT, outermost: no result, muted, or nothing assigned to it.
 *
 * Each machine says several things without a word, the design system's way:
 * - WHAT IT IS DOING by how its span moves: a machine that needs you turns its mark the accent with a gate held open; a refused one
 *   stops in the danger dot; one being fixed or updated works (dashes crawl); a passing one rests lit; a silent one is a hairline.
 * - HOW HEALTHY IT IS by how much of its span is lit: its checks passing, of those switched on.
 * - WHICH IT IS by how tall its mark stands: the hub, the server Cerberus runs on, stands taller than its peers.
 *
 * Its words wait for the plate: the machine's name over its one line ("docstore — refused", "All 4 services passing").
 *
 * A RING HOLDS AT MOST `RING_MOST` MARKS. A state with more machines puts its worst ones on the ring and one more mark, `moreMarkId`,
 * whose Opening lists the rest.
 */

/** A ring of the instrument: a state a machine can be in, inside out. */
export type FleetRingId = 'needs' | 'updating' | 'passing' | 'silent';

/** The rings inside out: what needs you nearest the core. */
const RING_ORDER: readonly FleetRingId[] = ['needs', 'updating', 'passing', 'silent'];

/** The most marks a ring carries, the "more" mark among them (the design system reads a ring of two to twenty-four). */
const RING_MOST = 24;

/** The mark that stands for a ring's further machines. */
export const moreMarkId = (ringId: string) => `more:${ringId}`;
/** The ring a "more" mark stands for, or null for a machine's own mark. */
export const ringOfMoreMark = (itemId: string) => (itemId.startsWith('more:') ? itemId.slice('more:'.length) : null);

/** The ring a machine's word puts it on. */
export function ringOfStatus(status: FleetStatus): FleetRingId {
  const group = groupOf(status);
  if (group === 'needs') return 'needs';
  if (group === 'updating') return 'updating';
  if (group === 'ok') return 'passing';
  return 'silent';
}

/** How a machine's span moves, by its word. */
function stateOf(status: FleetStatus): AstrolabeRingState {
  switch (status) {
    case 'denied':
      return 'failed';
    case 'failing':
    case 'warn':
      return 'waiting';
    case 'fixing':
    case 'updating':
    case 'paused':
    case 'enrolling':
      return 'working';
    case 'ok':
      return 'done';
    default:
      return 'idle';
  }
}

/** How much of a machine's span is lit: its checks passing, of those switched on; null for a machine with none to count. */
export function passingShare(node: CerberusNodeView): number | null {
  // `total` already leaves out the checks switched off on their own side (`notEnabled` counts those apart).
  let on = 0;
  let passing = 0;
  for (const service of node.services) {
    on += service.counts.total;
    passing += service.counts.passing;
  }
  return on > 0 ? Math.min(1, passing / on) : null;
}

/** The ring's name, the slider's name and the plate's first word. */
export function ringLabel(t: TFunction, ringId: FleetRingId): string {
  switch (ringId) {
    case 'needs':
      return t('cerberus.fleet.filters.needs');
    case 'updating':
      return t('cerberus.fleet.filters.updating');
    case 'passing':
      return t('cerberus.status.ok');
    default:
      return t('cerberus.ring.silent', { defaultValue: 'Silent' });
  }
}

/** A machine's word as its plate and its Opening say it ("Refused", "Being fixed", "Updating its warden"). */
export function machineWord(t: TFunction, status: FleetStatus): string {
  if (status === 'updating') return t('cerberus.node.updatingWarden');
  if (status === 'empty') return t('cerberus.fleet.filters.empty');
  if (status === 'enrolling') return t('cerberus.ring.enrolling', { defaultValue: 'Enrolling' });
  const mark = nodeMark(status);
  return mark === null ? t('cerberus.status.unknown') : t(markLook(mark).wordKey);
}

/** The rings as the instrument draws them, and the machines each holds in full (its marks and the ones past them). */
export type FleetRings = {
  rings: AstrolabeRing[];
  /** Every machine each ring holds, worst first, the ones past its marks included. */
  machinesOf: Partial<Record<FleetRingId, string[]>>;
  /** The ring a machine stands on, or null for one the fleet does not hold. */
  ringOf: (nodeId: string) => FleetRingId | null;
};

/**
 * The fleet as rings: one ring per state that holds a machine (a ring with nothing on it is not drawn), worst machines first round
 * each, the open machine kept facing on its ring (or its ring's "more" mark, when it is past the marks).
 */
export function fleetRings(items: FleetItem[], nodes: CerberusNodeView[], openNodeId: string | null, t: TFunction): FleetRings {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const machinesOf: Partial<Record<FleetRingId, string[]>> = {};
  const ringById = new Map<string, FleetRingId>();
  for (const item of items) {
    const ringId = ringOfStatus(item.status);
    (machinesOf[ringId] ??= []).push(item.id);
    ringById.set(item.id, ringId);
  }
  const itemById = new Map(items.map((item) => [item.id, item]));

  const rings: AstrolabeRing[] = [];
  for (const ringId of RING_ORDER) {
    const ids = machinesOf[ringId] ?? [];
    if (ids.length === 0) continue;
    const shown = ids.length > RING_MOST ? ids.slice(0, RING_MOST - 1) : ids;
    const marks: AstrolabeRingItem[] = shown.flatMap((id) => {
      const item = itemById.get(id);
      const node = nodeById.get(id);
      if (item === undefined || node === undefined) return [];
      const share = passingShare(node);
      return [{
        id,
        label: item.desc === null ? item.id : `${item.id} · ${item.desc}`,
        detail: nodeLine(t, item, node),
        state: stateOf(item.status),
        ...(share === null ? {} : { progress: share }),
        weight: item.role === 'hub' ? 0.8 : 0.4,
      }];
    });
    const rest = ids.length - shown.length;
    if (rest > 0) marks.push({ id: moreMarkId(ringId), label: t('cerberus.ring.more', { count: rest, defaultValue: '{{count}} more' }), weight: 0 });
    // The open machine faces you on its ring; one past the marks is said by the "more" mark.
    const facing = openNodeId === null ? undefined : shown.includes(openNodeId) ? openNodeId : ids.includes(openNodeId) ? moreMarkId(ringId) : undefined;
    rings.push({ id: ringId, label: ringLabel(t, ringId), items: marks, ...(facing === undefined ? {} : { value: facing }) });
  }

  return { rings, machinesOf, ringOf: (nodeId) => ringById.get(nodeId) ?? null };
}
