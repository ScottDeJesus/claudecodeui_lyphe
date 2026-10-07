/**
 * The narrowing every "history since a moment" statement of the Cerberus store shares: a window that
 * opens at `since`, optionally held to one `node` and one check key. The results, runs and diagnoses
 * repositories each answer a diagnosis's `history_read` over their own table and their own time
 * column; this assembles the WHERE they have in common so the three cannot drift apart.
 *
 * The conditions are fixed fragments and every value is a named parameter — nothing the agent typed is
 * ever spliced into SQL. `timeColumn` is the one thing interpolated, and only the repositories pass it,
 * as a literal of their own table's.
 *
 * Consumers: `cerberus-results.db.ts` (`transitionsSince`), `cerberus-runs.db.ts` (`requestedSince`) and
 * `cerberus-diagnoses.db.ts` (`startedSince`).
 */

/** A window opening at `since` (epoch ms), held to `node` and `check` (a check key) when given. */
export type CerberusHistoryFilter = { node?: string; check?: string; since: number };

/** The WHERE fragments and bound parameters for `filter` over `timeColumn`; `limit` rides along as `@limit`, clamped to a whole number of at least 0. */
export function historyConditions(
  filter: CerberusHistoryFilter,
  timeColumn: string,
  limit: number
): { conditions: string[]; params: Record<string, string | number> } {
  const conditions = [`${timeColumn} >= @since`];
  const params: Record<string, string | number> = { since: filter.since, limit: Math.max(0, Math.trunc(limit)) };
  if (filter.node !== undefined) {
    conditions.push('node = @node');
    params.node = filter.node;
  }
  if (filter.check !== undefined) {
    conditions.push('check_key = @check');
    params.check = filter.check;
  }
  return { conditions, params };
}
