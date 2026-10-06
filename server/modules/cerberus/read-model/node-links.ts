import { cerberusNodesDb, type CerberusNodeRow } from '@/modules/database/index.js';
import type { CerberusLinkState, CerberusReadInputs } from '@/shared/cerberus-types.js';

import { HUB_NODE_ID } from '../definition-document.js';

/**
 * How long a warden may go unheard before its node is SILENT: any frame counts as heard, whether or
 * not the socket is still open. `silentSince` is `lastHeardAt` plus this.
 *
 * Consumers: this file; it is the contract's number (`CerberusLinkState`), kept in one place.
 */
const SILENT_AFTER_MS = 90_000;

/**
 * Where a node's link stands at `now`. `silentSince` is the moment the silence began, set whenever
 * the node is silent — INCLUDING a node still waiting for its first heartbeat, since the overlay
 * keys off the silence and not off the label. `link` is decided in the contract's order: `never`
 * when the node row has no first heartbeat (it wins over `silent`, so a boot does not turn a node
 * that has not spoken yet into one that went quiet), else `silent`, else `reporting`.
 */
export type ResolvedNodeLink = {
  link: 'reporting' | 'silent' | 'never';
  lastHeardAt: number | null;
  silentSince: number | null;
};

/**
 * Works out a warden node's link from its row and the live link state `wardenLinks` reports (absent
 * for a node the gateway has not seen since boot). `lastHeardAt` is the live one, else the row's
 * stored last heartbeat — which is how a node center has not heard from since a restart is still
 * judged by when it was last heard, rather than reading as freshly alive. The live `silentSince` wins
 * when it has one; otherwise a node unheard for more than 90 s is silent since `lastHeardAt` + 90 s.
 * A `silentSince` after `now` is not yet a silence.
 *
 * Consumers: `overview.ts` (every enrolled node's view) and `silentSinceOf` below.
 */
export function resolveNodeLink(
  row: CerberusNodeRow,
  state: CerberusLinkState | undefined,
  now: number
): ResolvedNodeLink {
  const lastHeardAt = state?.lastHeardAt ?? row.last_heartbeat_at;

  let silentSince = state?.silentSince ?? null;
  if (silentSince === null && lastHeardAt !== null && now - lastHeardAt > SILENT_AFTER_MS) {
    silentSince = lastHeardAt + SILENT_AFTER_MS;
  }
  if (silentSince !== null && silentSince > now) silentSince = null;

  const link = row.first_heartbeat_at === null ? 'never' : silentSince !== null ? 'silent' : 'reporting';
  return { link, lastHeardAt, silentSince };
}

/**
 * The silence to lay over one node's checks: `silentSince` while the node is silent, `null`
 * otherwise — and always `null` for the hub and for a node with no row.
 *
 * Consumers: `check-detail.ts` and `lookup.ts`, which read one node's checks; the overview resolves
 * every node itself from the rows it already holds.
 */
export function silentSinceOf(node: string, inputs: CerberusReadInputs): number | null {
  if (node === HUB_NODE_ID) return null;
  const row = cerberusNodesDb.get(node);
  if (row === null) return null;
  return resolveNodeLink(row, inputs.links.get(node), inputs.now).silentSince;
}
