import { cerberusNodesDb, type CerberusNodeRow } from '@/modules/database/index.js';
import type { CerberusLinkState, CerberusPauseWindow, CerberusReadInputs } from '@/shared/cerberus-types.js';

import { HUB_NODE_ID } from '../definition-document.js';
import { pauseWindows } from '../updates.service.js';

import { buildNodeOverlay, NO_OVERLAY, pausedAt, type NodeOverlay } from './overlays.js';

/**
 * How long a warden may go unheard before its node is SILENT: any frame counts as heard, whether or
 * not the socket is still open. `silentSince` is `lastHeardAt` plus this.
 *
 * Consumers: this file; it is the contract's number (`CerberusLinkState`), kept in one place.
 */
const SILENT_AFTER_MS = 90_000;

/**
 * Where a node's link stands at `now`, and the overlay to lay over its checks. `overlay.silentSince`
 * is the moment the silence began, set whenever the node is silent — INCLUDING a node still waiting
 * for its first heartbeat, since the overlay keys off the silence and not off the label. `link` is
 * decided in the contract's order: `paused` while a restart for an update holds (it is never a
 * silence, and wins over the other three), else `never` when the node row has no first heartbeat (it
 * wins over `silent`, so a boot does not turn a node that has not spoken yet into one that went quiet),
 * else `silent`, else `reporting`.
 */
export type ResolvedNodeLink = {
  link: 'reporting' | 'silent' | 'never' | 'paused';
  lastHeardAt: number | null;
  overlay: NodeOverlay;
};

/**
 * Works out a warden node's link from its row, the live link state `wardenLinks` reports (absent for
 * a node the gateway has not seen since boot) and the restarts that touch the strip being read
 * (`pauses`, from `pauseWindows`). `lastHeardAt` is the live one, else the row's stored last
 * heartbeat — which is how a node center has not heard from since a restart is still judged by when
 * it was last heard, rather than reading as freshly alive. The live `silentSince` wins when it has
 * one; otherwise a node unheard for more than 90 s is silent since `lastHeardAt` + 90 s. A
 * `silentSince` after `now` is not yet a silence — a silence that would begin inside a pause that is
 * still running is one of those.
 *
 * Consumers: `overview.ts` (every enrolled node's view) and `nodeOverlayOf` below.
 */
export function resolveNodeLink(
  row: CerberusNodeRow,
  state: CerberusLinkState | undefined,
  now: number,
  pauses: CerberusPauseWindow[]
): ResolvedNodeLink {
  const lastHeardAt = state?.lastHeardAt ?? row.last_heartbeat_at;

  let silentSince = state?.silentSince ?? null;
  if (silentSince === null && lastHeardAt !== null && now - lastHeardAt > SILENT_AFTER_MS) {
    silentSince = lastHeardAt + SILENT_AFTER_MS;
  }
  if (silentSince !== null && silentSince > now) silentSince = null;

  // The silence moves out of a pause first, and only then is judged against now.
  const settled = buildNodeOverlay(silentSince, pauses);
  const overlay = settled.silentSince !== null && settled.silentSince > now ? { ...settled, silentSince: null } : settled;

  const link = pausedAt(pauses, now)
    ? 'paused'
    : row.first_heartbeat_at === null
      ? 'never'
      : overlay.silentSince !== null
        ? 'silent'
        : 'reporting';
  return { link, lastHeardAt, overlay };
}

/**
 * What to lay over one node's checks as of `inputs.now`, with the pauses read from `from` on: `from`
 * is the earliest moment the caller draws. The hub and a node with no row get nothing — the hub is
 * never silent or paused.
 *
 * Consumers: `check-detail.ts` and `lookup.ts`, which read one node's checks; the overview resolves
 * every node itself from the rows it already holds.
 */
export function nodeOverlayOf(node: string, inputs: CerberusReadInputs, from: number): NodeOverlay {
  if (node === HUB_NODE_ID) return NO_OVERLAY;
  const row = cerberusNodesDb.get(node);
  if (row === null) return NO_OVERLAY;
  const { now } = inputs;
  return resolveNodeLink(row, inputs.links.get(node), now, pauseWindows(node, from, now + 1)).overlay;
}
