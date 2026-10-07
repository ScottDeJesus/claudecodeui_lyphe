import {
  cerberusCatalogDb,
  cerberusDefinitionsDb,
  cerberusRunsDb,
  type CerberusCatalogRow,
} from '@/modules/database/index.js';
import type { CerberusCatalogEntryView, CerberusCheckView, CerberusStatus } from '@/shared/cerberus-types.js';

/**
 * The catalog as the screen reads it: an entry row turned into `CerberusCatalogEntryView`, and the
 * two questions the read model asks of the catalog — which fixes are on a check (its sheet), and
 * which one is offered for a check that needs a person (its card).
 *
 * WHICH FIX A NEED IS OFFERED. The first live entry on the check, oldest first, whose `when` the
 * check's current status satisfies: a `failing` check satisfies `failing` and `warn` entries, a `warn`
 * check satisfies `warn` entries only, and a `denied` check is offered what a `failing` one is — the
 * warden said no to a command or a credential, and a person may still choose to try a fix, though
 * Cerberus never runs one on its own for it. Any other status is offered nothing.
 *
 * Every view is built from the store as it is now: the check's label and its service's (null while
 * the check is not an active one, or has none), and the entry's run counts from `runs`.
 *
 * Consumers: `overview.ts` (`offeredFixes`), `check-detail.ts` (`fixesOfCheck`) and
 * `catalog.service.ts` (`catalogEntryViews`, for the entry a write answers and the list a read does).
 */

type CheckNames = { label: string | null; serviceLabel: string | null };

/** The entry's origin from its JSON column; an unreadable one is logged and shown as a person's, never a 500 on the tab. */
function readOrigin(row: CerberusCatalogRow): CerberusCatalogEntryView['origin'] {
  try {
    const origin = JSON.parse(row.origin) as CerberusCatalogEntryView['origin'];
    if (origin.kind === 'written' || origin.kind === 'diagnosis') return origin;
  } catch {
    // Falls through to the log below, with the same fallback.
  }
  console.error(`[Cerberus] catalog entry ${row.id} has an origin this center cannot read: ${row.origin}`);
  return { kind: 'written', by: 'unknown', at: row.created_at };
}

/** The plain names of every active check of the given nodes, keyed `<node>/<key>` (a node id holds no `/`). */
function namesOfChecks(nodes: string[]): Map<string, CheckNames> {
  const names = new Map<string, CheckNames>();
  for (const node of new Set(nodes)) {
    for (const check of cerberusDefinitionsDb.activeChecks(node)) {
      names.set(`${node}/${check.key}`, { label: check.label, serviceLabel: check.service_label });
    }
  }
  return names;
}

/**
 * The entries as views, in the order given: names from the active checks and counts from `runs`,
 * each read in one statement however many entries there are.
 */
export function catalogEntryViews(rows: CerberusCatalogRow[]): CerberusCatalogEntryView[] {
  if (rows.length === 0) return [];
  const names = namesOfChecks(rows.map((row) => row.node));
  const stats = new Map(cerberusRunsDb.statsFor(rows.map((row) => row.id)).map((row) => [row.entry, row]));

  return rows.map((row) => {
    const checkNames = names.get(`${row.node}/${row.check_key}`);
    const ended = stats.get(row.id);
    return {
      id: row.id,
      node: row.node,
      check: row.check_key,
      checkLabel: checkNames?.label ?? null,
      serviceLabel: checkNames?.serviceLabel ?? null,
      name: row.name,
      when: row.run_when,
      cmd: row.cmd,
      timeout: row.timeout,
      auto: row.auto === 1,
      limit: { runs: row.limit_runs, per: row.limit_per },
      capped: row.capped,
      recheck: row.recheck === 1,
      origin: readOrigin(row),
      createdAt: row.created_at,
      stats: { runs: ended?.runs ?? 0, ok: ended?.ok ?? 0, lastRunAt: ended?.last_run_at ?? null },
    };
  });
}

/** Every live entry on one check, whatever its `when`, oldest first. */
export function fixesOfCheck(node: string, key: string): CerberusCatalogEntryView[] {
  return catalogEntryViews(cerberusCatalogDb.forCheck(node, key));
}

/** Whether a check in `status` is one the entry's `when` applies to — see the file header. */
function appliesTo(status: CerberusStatus, when: CerberusCatalogRow['run_when']): boolean {
  if (status === 'failing' || status === 'denied') return true;
  return status === 'warn' && when === 'warn';
}

/**
 * The fix offered for each of the given checks that has one, keyed `<node>/<key>`. A check with no
 * entry that applies is absent. One read of the whole live catalog serves every check, so a fleet
 * with a hundred needs asks the store once.
 */
export function offeredFixes(checks: CerberusCheckView[]): Map<string, CerberusCatalogEntryView> {
  const live = cerberusCatalogDb.list();
  if (live.length === 0) return new Map();

  const chosen = new Map<string, CerberusCatalogRow>();
  for (const check of checks) {
    const mark = `${check.node}/${check.key}`;
    // `list` is oldest first, so the first that applies is the one the contract names.
    const entry = live.find((row) => row.node === check.node && row.check_key === check.key && appliesTo(check.status, row.run_when));
    if (entry) chosen.set(mark, entry);
  }

  // Two checks never share an entry, so the views are keyed by entry id and read back per check.
  const views = new Map(catalogEntryViews([...chosen.values()]).map((view) => [view.id, view]));
  const offered = new Map<string, CerberusCatalogEntryView>();
  for (const [mark, row] of chosen) {
    const view = views.get(row.id);
    if (view) offered.set(mark, view);
  }
  return offered;
}
