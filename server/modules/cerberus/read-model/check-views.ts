import { cerberusDefinitionsDb, type CerberusActiveCheckRow } from '@/modules/database/index.js';
import type { CerberusCheckView, CerberusProbeKind, CerberusReadInputs } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { HUB_NODE_ID } from '../definition-document.js';

import { statusAt } from './freshness.js';
import { layerCurrent, muteActiveAt, pausedSince, toMuteView, type NodeOverlay } from './overlays.js';
import { staleAfterSecondsOf, type CheckSeries } from './series.js';
import { shownRow, storedStatusOf } from './status-rules.js';

/**
 * One check as the screen reads it, now: the stored row's word while it is fresh, `unknown` when it
 * is not, with the mute, the silence and the pause laid over — the one place a check's CURRENT status
 * is decided, so the tab, "Needs you" and the `fixes` plan's auto-run cannot disagree.
 */

const PROBE_KINDS: ReadonlySet<string> = new Set<CerberusProbeKind>([
  'health_doc',
  'http',
  'tcp',
  'exec',
  'file_age',
  'sql',
]);

/**
 * The check named `key` on `node`, from the index of active checks — or a 404 `AppError`. A retired
 * check is not found: it has no staleness to judge freshness by, and it is on no screen.
 *
 * Consumers: `check-detail.ts` and `lookup.ts`, whose routes answer for one named check;
 * `nodeChecks` lets the first pass in the node's checks it has already read.
 */
export function findActiveCheck(
  node: string,
  key: string,
  nodeChecks: CerberusActiveCheckRow[] = cerberusDefinitionsDb.activeChecks(node)
): CerberusActiveCheckRow {
  const found = nodeChecks.find((check) => check.key === key);
  if (!found) {
    throw new AppError(`No active check ${node}/${key}`, { code: 'CERBERUS_UNKNOWN_CHECK', statusCode: 404 });
  }
  return found;
}

/**
 * The kind a check reports through: its probe's, `self` for the hub's own checks. A check whose
 * probe row is gone (the index keeps it on screen rather than dropping it) has no kind to read; the
 * answer then follows how the check was found — a component came through a health document — and
 * is a best guess, which `every` = 0 beside it makes plain.
 */
function kindOf(check: CerberusActiveCheckRow): CerberusCheckView['kind'] {
  if (check.probe_kind !== null && PROBE_KINDS.has(check.probe_kind)) return check.probe_kind as CerberusProbeKind;
  if (check.probe_kind === 'self' || check.node === HUB_NODE_ID) return 'self';
  return check.source !== null ? 'health_doc' : 'http';
}

/**
 * Where a check came from: `self` for the hub's own, `component` for one a health document fanned
 * out (it has a source and no probe of its own), `probe` for a probe's own check.
 */
function originOf(check: CerberusActiveCheckRow): CerberusCheckView['origin'] {
  if (check.probe_kind === 'self' || check.node === HUB_NODE_ID) return 'self';
  return check.source !== null && check.probe === null ? 'component' : 'probe';
}

/**
 * When an `unknown` status began: the earlier of the moment the last result went stale (its
 * vouching moment plus `staleAfter`) and the start of a current silence, or null when neither
 * applies (a check that has never reported has no beginning to give).
 */
function unknownSince(
  series: CheckSeries,
  lastRowAt: number | null,
  silentSince: number | null,
  now: number
): number | null {
  const candidates: number[] = [];
  if (lastRowAt !== null) {
    const staleSince = (series.liveLastAt ?? lastRowAt) + series.staleAfterMs;
    if (staleSince < now) candidates.push(staleSince);
  }
  if (silentSince !== null && silentSince < now) candidates.push(silentSince);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * Builds one check's view at `inputs.now` from its definition row and its series.
 *
 * `status` is the latest row's word when it is still fresh (`statusAt`), `unknown` when it is not or
 * when no row exists, then the overlays. `stored`, `value` and `at` stay the latest row's own even
 * when the status over them is `unknown` or `muted` — the screen can say what was last heard.
 * `value` and `at` are the exception to "the row's own": the store keeps a value that moves under an
 * unchanged status only in a keep-alive every five minutes, so when ingest's memory holds a result
 * NEWER than the stored row (`newest`), its value and `at` are shown instead. After a boot the memory
 * is empty and the stored row speaks until the check's next result arrives. The status, `since` and
 * every staleness rule still read the stored row and `lastReceivedAt`: a result that was not stored
 * moved neither status nor document status.
 * `since` is when `status` began: ingest's memory for a stored status, the moment it went stale
 * or silent for `unknown`, and the restart's first step for `paused`. `mute` is the unexpired mute covering the check, whatever its status.
 * `every` and `staleAfter` are seconds.
 *
 * Consumers: `overview.ts` (every check of the fleet) and `check-detail.ts` (the check and its
 * siblings).
 */
export function buildCheckView(
  series: CheckSeries,
  overlay: NodeOverlay,
  inputs: CerberusReadInputs
): CerberusCheckView {
  const { check } = series;
  const { now } = inputs;
  const { verdict, row } = statusAt(series.rows, now, series.staleAfterMs, series.liveLastAt, now);
  const raw = verdict === 'result' && row ? shownRow(row) : 'unknown';
  const status = layerCurrent(raw, now, series.mutes, overlay);
  const mute = muteActiveAt(series.mutes, now);
  const { newest, since: statusSince } = inputs.memory(check.node, check.key);
  const heard = newest && (!row || newest.at > row.at) ? newest : row;

  return {
    node: check.node,
    key: check.key,
    service: check.service,
    id: check.key.slice(check.key.indexOf('/') + 1),
    label: check.label,
    serviceLabel: check.service_label,
    status,
    stored: row ? storedStatusOf(row) : null,
    value: heard?.value ?? null,
    at: heard?.at ?? null,
    since:
      status === 'unknown'
        ? unknownSince(series, row?.at ?? null, overlay.silentSince, now)
        : status === 'paused'
          ? pausedSince(overlay.pauses, now)
          : statusSince,
    every: check.probe_every ?? 0,
    staleAfter: staleAfterSecondsOf(check),
    origin: originOf(check),
    kind: kindOf(check),
    mute: mute ? toMuteView(mute) : null,
  };
}
