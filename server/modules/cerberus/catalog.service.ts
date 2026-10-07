import {
  cerberusCatalogDb,
  getCerberusConnection,
  type CerberusCatalogChangeRow,
  type CerberusCatalogRow,
  type CerberusCatalogSetRow,
} from '@/modules/database/index.js';
import type { CerberusCatalogEntryInput, CerberusCatalogEntryView, CerberusCatalogSet } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { notifyCatalogAcked } from './catalog-ack.js';
import { hintChanged } from './cerberus-broadcast.js';
import { freeEntryId, validateEntryInput } from './catalog-entry-input.js';
import { catalogEntryViews } from './read-model/catalog-views.js';
import { wardenLinks } from './warden-links.js';

/**
 * The catalog: the fixes a person has written for a check, and the signed set of them each node's
 * warden verifies every `run.start` against.
 *
 * THE ONE WRITER of `catalog`, `catalog_sets` and `catalog_changes`. A write lands its rows in ONE
 * transaction — the entry, its change row and the node's next set — so a crash never leaves an entry
 * no set carries; the set goes down the node's link only after that commit, and every change ends in
 * `hintChanged`. Refusals are `AppError`s: 400 `CERBERUS_BAD_ENTRY` (the field named, see
 * `catalog-entry-input.ts`), 404 `CERBERUS_UNKNOWN_ENTRY`, 409 `CERBERUS_ENTRY_CAPPED`.
 *
 * A SET is a node's whole catalog at one version: `{ id, cmd, timeout }` of every live entry, plus the
 * one-offs of the previous set that have not yet expired (a one-off is a diagnosis's proposal; the
 * plan that owns diagnoses is the one that puts one in, this file only carries them across a
 * publish and drops them once past `expiresAt`). Versions count up per node from 1. The set carries
 * nothing about WHEN a fix applies, its limit or its auto switch: the warden verifies, center decides.
 *
 * THE ACK. A warden answers `catalog.set` (or a `welcome`'s catalog) with `catalog.ack { version }`
 * and a run is only ever started against a version its warden acked, so the ack is stamped on the
 * set's row. A `hello` carrying a `catalogVersion` is the same word said again — the warden holds that
 * version — and is stamped the same way when no later version is acked yet: the ack that crossed a
 * dropped link would otherwise never be repeated, since the welcome carries a set only when the
 * warden's version differs from center's. Only the version named is stamped: a set written while the
 * node had no link and superseded before it dialled in is never delivered and never acked, so its row
 * stays `sent_at` and `acked_at` NULL for good — the newest version's ack is the one that counts.
 *
 * TURNING AUTO-RUN ON SENDS NOTHING. The switch is center's own: Cerberus decides auto-runs (the
 * `auto-run.ts` rule), and the warden is never told which entries may run unprompted, so a toggle
 * writes a change row and no set.
 *
 * Every ack stamped here also tells `catalog-ack.ts`, whose waiters (a run asked for the moment its fix
 * was written) end on that event.
 *
 * Consumers: `cerberus.routes.ts` (`listCatalog`, `writeEntry`, `setAuto`), `warden-link.ts`
 * (`catalogForWelcome`, `markCatalogSent`), `cerberus.module.ts` (`registerCatalogHandlers`),
 * `runs.service.ts` (`liveEntry`, `catalogSetFor`) and the plans after this one (`publishCatalog` when
 * a diagnosis's one-off appears, `retireEntry` when an entry is withdrawn).
 */

function unknownEntry(id: string): AppError {
  return new AppError(`No catalog entry "${id}" exists.`, { code: 'CERBERUS_UNKNOWN_ENTRY', statusCode: 404 });
}

/** The entry's row, or a 404 `CERBERUS_UNKNOWN_ENTRY` when none carries the id or it has been retired. */
export function liveEntry(id: string): CerberusCatalogRow {
  const entry = cerberusCatalogDb.get(id);
  if (!entry || entry.retired_at !== null) throw unknownEntry(id);
  return entry;
}

function isPrimaryKeyClash(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

/**
 * Appends one field's change. A change is keyed `(entry, at, field)`, so a second edit of one field
 * inside the same millisecond (a script flipping a switch twice) would be refused as a repeat; it is
 * written a millisecond later instead, which keeps both in order. However many edits one millisecond
 * holds, the walk ends: each clash is a row already at that moment, and there are finitely many.
 */
function appendChange(change: Omit<CerberusCatalogChangeRow, 'at'>, at: number): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      cerberusCatalogDb.insertChange({ ...change, at: at + attempt });
      return;
    } catch (error) {
      if (!isPrimaryKeyClash(error)) throw error;
    }
  }
}

/** The one-offs a set's JSON column holds, or none when the column cannot be read — it must not block a publish. */
function parseOneOffs(row: CerberusCatalogSetRow, node: string): CerberusCatalogSet['oneOffs'] {
  try {
    return JSON.parse(row.one_offs) as CerberusCatalogSet['oneOffs'];
  } catch (error) {
    console.error(`[Cerberus] version ${row.version} of node ${node}'s catalog has one-offs this center cannot read: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function setOfRow(row: CerberusCatalogSetRow): CerberusCatalogSet {
  return {
    version: row.version,
    entries: JSON.parse(row.entries) as CerberusCatalogSet['entries'],
    oneOffs: parseOneOffs(row, row.node),
  };
}

/**
 * The node's latest set — whether or not it was sent or acked — or `null` for a node that has never
 * had an entry. Consumers: `catalogForWelcome`, and the runs plan's `startRun`.
 */
export function catalogSetFor(node: string): CerberusCatalogSet | null {
  const row = cerberusCatalogDb.latestSet(node);
  return row ? setOfRow(row) : null;
}

/** The newest version the node's warden has acked — the one a `run.start` must name — or `null`. */
export function ackedCatalogVersion(node: string): number | null {
  return cerberusCatalogDb.ackedSet(node)?.version ?? null;
}

/**
 * Records the node's next set: its live entries, and the previous set's one-offs that have not yet
 * expired. Runs INSIDE the caller's write transaction, so the set and the change that made it commit
 * together; nothing is sent here.
 */
function recordNextSet(node: string, now: number): CerberusCatalogSet {
  const entries = cerberusCatalogDb.list(node).map(({ id, cmd, timeout }) => ({ id, cmd, timeout }));
  const previous = cerberusCatalogDb.latestSet(node);
  const oneOffs = previous ? parseOneOffs(previous, node).filter((oneOff) => oneOff.expiresAt > now) : [];
  const version = cerberusCatalogDb.insertSet(node, JSON.stringify(entries), JSON.stringify(oneOffs));
  return { version, entries, oneOffs };
}

/** Puts a recorded set on the node's link and stamps `sent_at` when it went; an unlinked node reads it in its next `welcome`. */
function sendSet(node: string, set: CerberusCatalogSet): void {
  if (wardenLinks.send(node, 'catalog.set', set)) cerberusCatalogDb.markSetSent(node, set.version, Date.now());
}

/**
 * Publishes the node's catalog as it stands now: a new version row, then the signed `catalog.set`
 * down its link. Answers the set. For the plans that change a set without an entry changing (a
 * diagnosis's one-off appearing or lapsing); the writes below publish in their own transaction.
 */
export function publishCatalog(node: string): CerberusCatalogSet {
  const set = getCerberusConnection()
    .transaction(() => recordNextSet(node, Date.now()))
    .immediate();
  sendSet(node, set);
  hintChanged({ nodes: [node] });
  return set;
}

/** Every live entry of every node, oldest first, as the Fixes tab reads them. */
export function listCatalog(): CerberusCatalogEntryView[] {
  return catalogEntryViews(cerberusCatalogDb.list());
}

/**
 * Writes one entry and publishes the node's next set. `origin` is how it came to be — the route
 * passes `{ kind: 'written', by, at }` for a person. The entry starts with auto-run OFF whatever it
 * says: switching it on is its own decision (`setAuto`), and one this call could not make for a capped
 * entry. Answers the entry as the tab reads it.
 */
export function writeEntry(input: CerberusCatalogEntryInput, origin: CerberusCatalogEntryView['origin']): CerberusCatalogEntryView {
  const entry = validateEntryInput(input);
  const now = Date.now();

  const written = getCerberusConnection()
    .transaction(() => {
      // Chosen and inserted under one write lock, so two writers cannot both take a free id.
      const id = freeEntryId(entry.name);
      cerberusCatalogDb.insert({
        id,
        node: entry.node,
        check_key: entry.check,
        name: entry.name,
        run_when: entry.when,
        cmd: entry.cmd,
        timeout: entry.timeout,
        auto: 0,
        limit_runs: entry.limitRuns,
        limit_per: entry.limitPer,
        capped: entry.capped,
        recheck: entry.recheck ? 1 : 0,
        origin: JSON.stringify(origin),
        created_at: now,
      });
      appendChange(
        { entry: id, field: 'added', from_value: null, to_value: entry.name, by: origin.kind === 'written' ? origin.by : 'you' },
        now
      );
      return { id, set: recordNextSet(entry.node, now) };
    })
    .immediate();

  hintChanged({ nodes: [entry.node], checks: [`${entry.node}/${entry.check}`] });
  sendSet(entry.node, written.set);
  const row = cerberusCatalogDb.get(written.id);
  if (!row) throw new Error(`Catalog entry ${written.id} was written and cannot be read back.`);
  return catalogEntryViews([row])[0];
}

/**
 * Switches an entry's auto-run on or off for `by`, and answers the entry. A capped entry cannot be
 * switched on (409 `CERBERUS_ENTRY_CAPPED`, the reason in the message); an unknown or retired one is a
 * 404. A switch already in the state asked for changes nothing and writes nothing. The entry's
 * state and its change row land together; no set is published (see the file header).
 */
export function setAuto(id: string, on: boolean, by: string): CerberusCatalogEntryView {
  const now = Date.now();
  const moved = getCerberusConnection()
    .transaction(() => {
      const entry = liveEntry(id);
      if (on && entry.capped !== null) {
        throw new AppError(`"${entry.name}" can never run on its own: ${entry.capped}`, {
          code: 'CERBERUS_ENTRY_CAPPED',
          statusCode: 409,
        });
      }
      if (!cerberusCatalogDb.setAuto(id, on)) return false;
      appendChange({ entry: id, field: 'auto', from_value: on ? '0' : '1', to_value: on ? '1' : '0', by }, now);
      return true;
    })
    .immediate();

  const row = cerberusCatalogDb.get(id);
  if (!row) throw unknownEntry(id);
  if (moved) hintChanged({ nodes: [row.node], checks: [`${row.node}/${row.check_key}`] });
  return catalogEntryViews([row])[0];
}

/**
 * Retires an entry: it leaves every list and the node's next set, and its runs keep its name. 404 for
 * an unknown id; one already retired is left as it is and publishes nothing.
 */
export function retireEntry(id: string): void {
  const entry = cerberusCatalogDb.get(id);
  if (!entry) throw unknownEntry(id);
  const now = Date.now();

  const set = getCerberusConnection()
    .transaction(() => (cerberusCatalogDb.retire(id, now) ? recordNextSet(entry.node, now) : null))
    .immediate();
  if (!set) return;

  hintChanged({ nodes: [entry.node], checks: [`${entry.node}/${entry.check_key}`] });
  sendSet(entry.node, set);
}

/**
 * What a connecting warden's `hello` means for the catalog. `heldVersion` is the version it says it
 * acked (null for none): a version center published and has no ack for yet is stamped acked at `at`,
 * since the ack itself may have been lost with the previous link. Answers the set its `welcome` must
 * carry — the node's latest, when the warden's version DIFFERS from it (an older warden, a restarted
 * one holding nothing, or one ahead of a center whose store went back) — or null.
 */
export function catalogForWelcome(node: string, heldVersion: number | null, at: number): CerberusCatalogSet | null {
  const latest = catalogSetFor(node);
  if (latest === null) return null;

  const acked = ackedCatalogVersion(node);
  if (heldVersion !== null && (acked === null || heldVersion > acked) && cerberusCatalogDb.markSetAcked(node, heldVersion, at)) {
    hintChanged({ nodes: [node] });
    notifyCatalogAcked(node);
  }
  return heldVersion === latest.version ? null : latest;
}

/** Notes that `welcome` carried `version` to the node, so its row's `sent_at` says the set went. */
export function markCatalogSent(node: string, version: number): void {
  cerberusCatalogDb.markSetSent(node, version, Date.now());
}

/** Takes a warden's `catalog.ack { version }`: the version it now holds, stamped on that set's row. */
function recordCatalogAck(node: string, body: unknown): void {
  const version = (body as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
    console.warn(`[Cerberus] node ${node} sent a catalog.ack without a usable version; ignored`);
    return;
  }
  if (!cerberusCatalogDb.markSetAcked(node, version, Date.now())) {
    console.warn(`[Cerberus] node ${node} acked catalog version ${version}, which center never published; ignored`);
    return;
  }
  hintChanged({ nodes: [node] });
  notifyCatalogAcked(node);
}

/**
 * Registers the frames this service takes from a warden — `catalog.ack` — with the link registry.
 * Called once at the module's start, before the gateway binds: a second registration throws, which is
 * a mistake to hear about at boot.
 */
export function registerCatalogHandlers(): void {
  wardenLinks.registerHandler('catalog.ack', (node, body) => recordCatalogAck(node, body));
}
