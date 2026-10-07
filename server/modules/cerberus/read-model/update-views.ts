import { cerberusUpdatesDb, type CerberusUpdateResult, type CerberusUpdateRow } from '@/modules/database/index.js';
import type { CerberusActivity, CerberusNodeView } from '@/shared/cerberus-types.js';

/**
 * What the warden updates add to the fleet screen, read straight from the `updates` rows: a node's
 * `updating` and the `warden` lines of "What happened". The third thing they add — the `paused` word on
 * a node's link and its checks — is laid over by `overlays.ts` and `node-links.ts` from the pause
 * windows `updates.service.ts` works out; nothing here is written and nothing is cached.
 */

/** A node's `updating`, as `CerberusNodeView` carries it. */
type NodeUpdating = NonNullable<CerberusNodeView['updating']>;

/** The activity line a finished update makes. */
const END_EVENT: Record<CerberusUpdateResult, 'updated' | 'rolled_back' | 'update_failed'> = {
  updated: 'updated',
  rolled_back: 'rolled_back',
  failed: 'update_failed',
};

/**
 * Every node that has an update queued or running, with where it stands: the update's latest word and its
 * sentence, its place in its batch (counting from 1) and the batch's size. The oldest live update is the
 * one being offered — it reads "Offering warden <v>" until its warden's first step — and the rest wait
 * their turn.
 *
 * Consumers: `overview.ts`, for each node's `updating`.
 */
export function updatingByNode(): Map<string, NodeUpdating> {
  const live = cerberusUpdatesDb.running();
  const batches = new Map<string, CerberusUpdateRow[]>();
  const byNode = new Map<string, NodeUpdating>();

  live.forEach((row, position) => {
    if (!batches.has(row.batch)) batches.set(row.batch, cerberusUpdatesDb.forBatch(row.batch));
    const batch = batches.get(row.batch) ?? [];
    const latestStep = cerberusUpdatesDb.steps(row.id).at(-1);
    const waiting = position === 0 ? `Offering warden ${row.to_version}` : 'Waiting its turn';
    byNode.set(row.node, {
      // The column holds 'queued' or a word the driver stored after checking it is one of the six.
      step: (row.step ?? 'queued') as NodeUpdating['step'],
      text: latestStep?.text ?? waiting,
      index: batch.findIndex((member) => member.id === row.id) + 1,
      of: batch.length,
    });
  });
  return byNode;
}

/**
 * The `warden` lines of "What happened" before `before`: `update_started` once per batch, at the moment it
 * was written (`nodes` the number it took), and `updated`, `rolled_back` or `update_failed` once per
 * update that has ended, at its end. `limit` bounds how many updates are read; the store hands back the
 * whole group of one instant, so the caller's `before` cursor skips nothing (`cerberusUpdatesDb.recent`).
 *
 * Consumers: `activity.ts`.
 */
export function updateEvents(before: number, limit: number): CerberusActivity[] {
  const events: CerberusActivity[] = [];
  const announced = new Set<string>();

  for (const row of cerberusUpdatesDb.recent(before, limit)) {
    if (!announced.has(row.batch)) {
      announced.add(row.batch);
      events.push({
        kind: 'warden',
        at: row.started_at,
        node: null,
        event: 'update_started',
        from: null,
        to: row.to_version,
        nodes: cerberusUpdatesDb.forBatch(row.batch).length,
      });
    }
    if (row.ended_at !== null && row.ended_at < before && row.result !== null) {
      events.push({
        kind: 'warden',
        at: row.ended_at,
        node: row.node,
        event: END_EVENT[row.result],
        from: row.from_version,
        to: row.to_version,
      });
    }
  }
  return events;
}
