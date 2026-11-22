import type { TFunction } from 'i18next';

import { groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { markLook, nodeMark } from '@/modules/cerberus/utils/cerberusStatus';
import { nodeLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusNodeView } from '@/shared/cerberus-types';
import type { FleetItem, FleetStatus, HoopSlot, HoopSlotState } from '@/shared/types';

/**
 * THE FLEET'S MACHINES AS SLOTS ON A HOOP: what Cerberus's instrument (`CerberusInstrument`) draws round Cerberus's core, worked out
 * from the fleet model's items (`fleetItems`, worst first). A run is a state, and the runs stand in their order round the hoop while
 * machines move between them:
 *
 * - NEEDS YOU, first: a check failing, refused, close to its limit, or being fixed (the fleet model's `needs` group).
 * - UPDATING: a warden updating, restarting for an update, or a machine enrolling.
 * - PASSING: every check passing.
 * - SILENT: no result, muted, or nothing assigned to it.
 *
 * Each machine says several things without a word, in the hoop's own places:
 * - WHAT IT IS DOING by its square: the accent, breathing, while it needs you; red when it was refused; dashes turning while it is
 *   fixed or updated; green while it passes; the frame alone while it is silent.
 * - HOW HEALTHY IT IS by how much of its top edge is lit: its checks passing, of those switched on.
 * - WHICH IT IS by how tall it stands: the hub, the server Cerberus runs on, the band's full height, its peers shorter.
 *
 * Its words are read out under the hoop when it faces you: its run, its name and what it is, then its one line ("refused", "All 4
 * services passing").
 *
 * A RUN SHOWS AT MOST `RUN_MOST` SLOTS. A state with more machines puts its worst ones on the hoop and one more slot, `moreSlotId`,
 * whose Opening lists the rest.
 */

/** A run of the hoop: a state a machine can be in. */
export type FleetGroupId = 'needs' | 'updating' | 'passing' | 'silent';

/** The runs in their order round the hoop: what needs you first. */
const GROUP_ORDER: readonly FleetGroupId[] = ['needs', 'updating', 'passing', 'silent'];

/** The most slots a run stands on the hoop, the "more" slot among them. */
const RUN_MOST = 24;

/** How tall a machine stands: the hub the band's full height, a peer shorter, the "more" slot shortest. */
const HUB_HEIGHT = 1;
const PEER_HEIGHT = 0.8;
const MORE_HEIGHT = 0.62;

/** The slot that stands for a run's further machines. */
export const moreSlotId = (groupId: string) => `more:${groupId}`;
/** The run a "more" slot stands for, or null for a machine's own slot. */
export const groupOfMore = (slotId: string) => (slotId.startsWith('more:') ? slotId.slice('more:'.length) as FleetGroupId : null);

/** The run a machine's word puts it in. */
function groupOfStatus(status: FleetStatus): FleetGroupId {
  const group = groupOf(status);
  if (group === 'needs') return 'needs';
  if (group === 'updating') return 'updating';
  if (group === 'ok') return 'passing';
  return 'silent';
}

/** How a machine's square stands, by its word. */
function stateOf(status: FleetStatus): HoopSlotState {
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
      return 'asleep';
  }
}

/** How much of a machine's top edge is lit: its checks passing, of those switched on; null for a machine with none to count. */
function passingShare(node: CerberusNodeView): number | null {
  // `total` already leaves out the checks switched off on their own side (`notEnabled` counts those apart).
  let on = 0;
  let passing = 0;
  for (const service of node.services) {
    on += service.counts.total;
    passing += service.counts.passing;
  }
  return on > 0 ? Math.min(1, passing / on) : null;
}

/** The run's name: what its run is called along the ground, and the source a machine's Opening names. */
export function groupLabel(t: TFunction, groupId: FleetGroupId): string {
  switch (groupId) {
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

/** A machine's word as its Opening says it ("Refused", "Being fixed", "Updating its warden"). */
export function machineWord(t: TFunction, status: FleetStatus): string {
  if (status === 'updating') return t('cerberus.node.updatingWarden');
  if (status === 'empty') return t('cerberus.fleet.filters.empty');
  if (status === 'enrolling') return t('cerberus.ring.enrolling', { defaultValue: 'Enrolling' });
  const mark = nodeMark(status);
  return mark === null ? t('cerberus.status.unknown') : t(markLook(mark).wordKey);
}

/** The fleet as the instrument draws it, and the machines each run holds in full (its slots and the ones past them). */
export type FleetHoop = {
  slots: HoopSlot[];
  /** Every machine each run holds, worst first, the ones past its slots included. */
  machinesOf: Partial<Record<FleetGroupId, string[]>>;
  /** The run a machine stands in, or null for one the fleet does not hold. */
  groupOf: (nodeId: string) => FleetGroupId | null;
};

/**
 * The fleet as slots: one run per state that holds a machine (a run with nothing in it is not drawn), worst machines first in each.
 * `most` is the most slots a run stands, its "more" slot among them: `RUN_MOST` when absent, and no end for the fleet as a list
 * (`HoopList`).
 */
export function fleetHoop(items: FleetItem[], nodes: CerberusNodeView[], t: TFunction, most = RUN_MOST): FleetHoop {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const machinesOf: Partial<Record<FleetGroupId, string[]>> = {};
  const groupById = new Map<string, FleetGroupId>();
  for (const item of items) {
    const groupId = groupOfStatus(item.status);
    (machinesOf[groupId] ??= []).push(item.id);
    groupById.set(item.id, groupId);
  }
  const itemById = new Map(items.map((item) => [item.id, item]));

  const slots: HoopSlot[] = [];
  for (const groupId of GROUP_ORDER) {
    const ids = machinesOf[groupId] ?? [];
    if (ids.length === 0) continue;
    const groupName = groupLabel(t, groupId);
    const shown = ids.length > most ? ids.slice(0, most - 1) : ids;
    for (const id of shown) {
      const item = itemById.get(id);
      const node = nodeById.get(id);
      if (item === undefined || node === undefined) continue;
      slots.push({
        id,
        group: groupId,
        groupName,
        title: item.desc === null ? item.id : `${item.id} · ${item.desc}`,
        words: nodeLine(t, item, node),
        state: stateOf(item.status),
        edge: passingShare(node) ?? 0,
        beads: [],
        height: item.role === 'hub' ? HUB_HEIGHT : PEER_HEIGHT,
      });
    }
    const rest = ids.length - shown.length;
    if (rest > 0) {
      slots.push({
        id: moreSlotId(groupId),
        group: groupId,
        groupName,
        title: t('cerberus.ring.more', { count: rest, defaultValue: '{{count}} more' }),
        words: '',
        state: 'more',
        edge: 0,
        beads: [],
        height: MORE_HEIGHT,
      });
    }
  }

  return { slots, machinesOf, groupOf: (nodeId) => groupById.get(nodeId) ?? null };
}
