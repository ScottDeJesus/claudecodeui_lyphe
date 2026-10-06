import {
  cerberusDefinitionsDb,
  cerberusMutesDb,
  cerberusNodesDb,
  cerberusResultsDb,
  type CerberusMuteRow,
} from '@/modules/database/index.js';
import type { CerberusActivity, CerberusReadInputs } from '@/shared/cerberus-types.js';

import { shownRow, statusOf } from './status-rules.js';

/**
 * "What happened": the fleet's recent moments, merged newest first from three sources — a check's
 * status changing, a mute being set, lifted or running out, and a node enrolling. Later plans of the
 * arc add `fix`, `catalog`, `diagnosis` and `warden` lines; a reader switches on `kind`.
 *
 * Only what is already in the store is read: a transition is a `change` row that has a `prev_status`
 * and a status that differs from it (`not_enabled` spells a null on either side), and a mute's
 * three events are its own columns. Nothing is written for the feed.
 */

/** A check's plain names, keyed `<node>/<key>` — a node id has no `/`, so the key cannot be misread. */
type CheckLabels = Map<string, { label: string | null; serviceLabel: string | null }>;

function checkLabels(): CheckLabels {
  const labels: CheckLabels = new Map();
  for (const check of cerberusDefinitionsDb.activeChecks()) {
    labels.set(`${check.node}/${check.key}`, { label: check.label, serviceLabel: check.service_label });
  }
  return labels;
}

/**
 * A mute's events that have happened and fall before `before`: `muted` at `from_at`, `lifted` at
 * `lifted_at`, and `expired` at `until_at` once that has passed unlifted. A mute lifted early never
 * also expires — `lifted_at` is set and the record says "lifted", never "ran out".
 */
function muteEvents(mute: CerberusMuteRow, before: number, now: number, labels: CheckLabels): CerberusActivity[] {
  const names = labels.get(`${mute.node}/${mute.check_key}`) ?? { label: null, serviceLabel: null };
  const event = (at: number, kind: 'muted' | 'lifted' | 'expired'): CerberusActivity => ({
    kind: 'mute',
    at,
    node: mute.node,
    check: mute.check_key,
    label: names.label,
    serviceLabel: names.serviceLabel,
    event: kind,
    until: mute.until_at,
    reason: mute.reason,
    by: mute.by,
  });

  const events: CerberusActivity[] = [];
  if (mute.from_at < before) events.push(event(mute.from_at, 'muted'));
  if (mute.lifted_at !== null) {
    if (mute.lifted_at < before) events.push(event(mute.lifted_at, 'lifted'));
  } else if (mute.until_at <= now && mute.until_at < before) {
    events.push(event(mute.until_at, 'expired'));
  }
  return events;
}

/** Newest first; at one instant, by node then check then kind, so a page is the same every time. */
function newestFirst(a: CerberusActivity, b: CerberusActivity): number {
  if (a.at !== b.at) return b.at - a.at;
  const keyOf = (item: CerberusActivity): string =>
    `${item.node}\u0000${'check' in item ? item.check : ''}\u0000${item.kind}`;
  return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;
}

/**
 * The events strictly before `before`, newest first, at least `limit` of them when that many exist.
 * `limit` cuts at an INSTANT, not in the middle of one: a health document stamps every component
 * with one `at`, so a mass flip is a group of events that share it, and the caller's cursor is
 * `before = <last event's at>` with a strict `<` — an event left behind at that `at` would be
 * skipped for ever. So the answer runs on to the end of the instant the `limit`-th event sits in.
 *
 * Each source is asked for `limit` of its own newest: an event in the overall top `limit` is in the
 * top `limit` of its source. That holds for transitions (the store returns whole instants) and
 * enrollments, and for mutes except where two mutes' newest events share the cut's instant —
 * `cerberusMutesDb.recent` returns exactly `limit` mutes, so the second of such a tie is on neither
 * this page nor the next. Labels come from the active checks; a retired check's
 * events keep their key and a null label, and a check's label may be null on the screen too — the
 * screen then shows the key.
 *
 * Consumers: `overview.ts` (the newest seven) and the activity route (`GET /activity?before&limit`,
 * `limit` ≤ 100 by the route), through the module's services.
 */
export function activity(
  { before, limit }: { before: number; limit: number },
  inputs: CerberusReadInputs
): CerberusActivity[] {
  // A cursor or a page size that is not a number is a caller's bug, and answering `[]` for it (or
  // letting SQLite refuse the bind) would hide it; a page of no rows asked for is just empty.
  if (typeof before !== 'number' || Number.isNaN(before) || typeof limit !== 'number' || Number.isNaN(limit)) {
    throw new RangeError(`activity needs a numeric before and limit, got ${String(before)} and ${String(limit)}`);
  }
  if (limit <= 0) return [];
  const labels = checkLabels();
  const merged: CerberusActivity[] = [];

  for (const row of cerberusResultsDb.transitions(before, limit)) {
    const names = labels.get(`${row.node}/${row.check_key}`) ?? { label: null, serviceLabel: null };
    merged.push({
      kind: 'check',
      at: row.at,
      node: row.node,
      check: row.check_key,
      label: names.label,
      serviceLabel: names.serviceLabel,
      from: statusOf(row.prev_status),
      to: shownRow(row),
      value: row.value,
    });
  }

  for (const mute of cerberusMutesDb.recent(before, limit)) {
    merged.push(...muteEvents(mute, before, inputs.now, labels));
  }

  for (const node of cerberusNodesDb.list()) {
    if (node.enrolled_at < before) {
      merged.push({
        kind: 'node',
        at: node.enrolled_at,
        node: node.id,
        event: 'enrolled',
        wardenVersion: node.warden_version,
      });
    }
  }

  merged.sort(newestFirst);
  if (merged.length <= limit) return merged;
  const cutInstant = merged[limit - 1].at;
  let end = limit;
  while (end < merged.length && merged[end].at === cutInstant) end += 1;
  return merged.slice(0, end);
}
