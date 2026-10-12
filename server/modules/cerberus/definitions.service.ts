import {
  cerberusDefinitionsDb,
  cerberusNodesDb,
  getCerberusConnection,
  type CerberusNodeRow,
} from '@/modules/database/index.js';
import type {
  CerberusChecksSet,
  CerberusDefinition,
  CerberusProbeSpec,
  CerberusServiceDefinition,
} from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { hintChanged } from './cerberus-broadcast.js';
import { HUB_NODE_ID, MAX_LABEL_LENGTH, parseDefinition } from './definition-document.js';
import {
  definitionFromRows,
  ownCheckUpsertOf,
  ownChecksByKey,
  probeRowOf,
  probeSpecOf,
  specOfDefinition,
  specSetSignature,
} from './definition-rows.js';
import { wardenLinks } from './warden-links.js';

/**
 * The ONE writer of probes, checks and labels — and the reader of them as documents.
 *
 * Every write here ends in `hintChanged`, after it committed, so a screen re-reads exactly when
 * something it shows has moved. Refusals are `AppError`s: 400 `CERBERUS_BAD_DEFINITION` (with the
 * offending path in `details`), 404 `CERBERUS_UNKNOWN_NODE`, 404 `CERBERUS_UNKNOWN_CHECK`, and 409
 * `CERBERUS_HUB_CHECK` for retiring one of center's own checks (`seedHub` would bring it back at the next start).
 *
 * WHAT A DEFINITION WRITE DOES. `putDefinition` REPLACES a node's probes in one transaction: each
 * probe of the document is upserted with its own check (whose key IS the probe's key); a probe that
 * left is deleted, and its own check and the components it had discovered are RETIRED — stamped
 * `retired_at`, their history untouched. Only when the set a warden would run differs does the
 * node's `checks_version` bump and a `checks.set` go down its link; a write that only changes labels
 * changes nothing the warden can see, so it neither bumps nor sends.
 *
 * LABELS NEVER VANISH BY OMISSION. A probe, a service or a component the document does not give a
 * label keeps the one it has; only an explicit empty label clears one. That is what lets a person
 * name a discovered component on screen and a later document, written without it, leave the name be.
 * A `labels` entry, on the other hand, must name a component that EXISTS: a component's row is made
 * the first time a health document carries it, so a label for one not yet seen is REFUSED at
 * `services[i].labels.<id>` (400, the whole PUT rolled back) rather than accepted and dropped.
 * Write the document without it, and add the label once the component has been seen.
 *
 * Consumers: `cerberus.routes.ts` (the definitions, labels and checks routes), `ingest.service.ts`
 * (`discoverComponent`), `warden-link.ts` (`checksSetFor`, for a `welcome`) and the module's
 * `start()` (`seedHub`).
 */

const HUB_SERVICE = 'cerberus';
const HUB_SERVICE_LABEL = 'Cerberus itself';

/** The hub's three checks: every 30 s, so `activeChecks` resolves their staleness to the 90 s the spec gives them. */
const HUB_CHECKS = [
  { id: 'wardens.fresh', label: 'Every warden heard from in 90 s' },
  { id: 'gateway.listening', label: 'Wardens can reach Cerberus' },
  { id: 'store.write', label: 'The store accepts writes' },
] as const;

function unknownNode(node: string): AppError {
  return new AppError(`No node called "${node}" is enrolled.`, { code: 'CERBERUS_UNKNOWN_NODE', statusCode: 404 });
}

function unknownCheck(node: string, what: string): AppError {
  return new AppError(`${node} has no ${what}.`, { code: 'CERBERUS_UNKNOWN_CHECK', statusCode: 404 });
}

function requireEnrolledNode(node: string): CerberusNodeRow {
  const row = cerberusNodesDb.get(node);
  if (!row) throw unknownNode(node);
  return row;
}

/** Labels reach center's own checks too; every other write needs an enrolled node. */
function requireKnownNode(node: string): void {
  if (node !== HUB_NODE_ID) requireEnrolledNode(node);
}

/** The set a node's warden should be running, at the version the node is on. */
export function checksSetFor(node: string): CerberusChecksSet {
  const ownChecks = ownChecksByKey(cerberusDefinitionsDb.checksOf(node));
  const probes = cerberusDefinitionsDb
    .probesOf(node)
    .map((row) => probeSpecOf(row, ownChecks.get(row.key)))
    .filter((spec): spec is CerberusProbeSpec => spec !== null);
  return { version: cerberusNodesDb.get(node)?.checks_version ?? 0, probes };
}

/** A node's definition as the document the routes read; 404 when the node is not enrolled. */
export function getDefinition(node: string): CerberusDefinition {
  const row = requireEnrolledNode(node);
  return definitionFromRows(node, row.checks_version, cerberusDefinitionsDb.probesOf(node), cerberusDefinitionsDb.checksOf(node));
}

/** What one definition write did, for the hint and the push that follow its commit. */
type DefinitionWrite = { version: number; setChanged: boolean; touchedKeys: string[] };

/** The body of `putDefinition`'s transaction: every statement of a replace, none of its notifications. */
function writeDefinition(node: string, services: CerberusServiceDefinition[]): DefinitionWrite {
  // Read under the write lock: the version being bumped must be the one committed, not the one
  // an overlapping process of a handover has already moved past.
  const nodeRow = requireEnrolledNode(node);
  const now = Date.now();
  const nextProbes = services.flatMap((service) => service.probes);
  const nextKeys = new Set(nextProbes.map((probe) => probe.key));
  const nextHealthDocKeys = new Set(nextProbes.filter((probe) => probe.kind === 'health_doc').map((probe) => probe.key));

  const nextSpecs = nextProbes.map(specOfDefinition);
  const setChanged = specSetSignature(checksSetFor(node).probes) !== specSetSignature(nextSpecs);
  const version = nodeRow.checks_version + (setChanged ? 1 : 0);
  const touchedKeys = new Set(nextKeys);

  for (const [serviceIndex, service] of services.entries()) {
    for (const probe of service.probes) {
      cerberusDefinitionsDb.upsertProbe(probeRowOf(node, probe, version));
      cerberusDefinitionsDb.upsertCheck(ownCheckUpsertOf(node, probe, version));
      if (probe.label === '') cerberusDefinitionsDb.setCheckLabel(node, probe.key, null);
    }
    // After the probes, so the label reaches every check of the service in one statement —
    // the checks of components found earlier included.
    if (service.label !== null) {
      cerberusDefinitionsDb.setServiceLabel(node, service.service, service.label === '' ? null : service.label);
    }
    // A label needs a row to land on. Thrown inside the transaction, so a document with one
    // unseen component changes nothing at all.
    for (const [componentId, label] of Object.entries(service.labels ?? {})) {
      const key = `${service.service}/${componentId}`;
      if (!cerberusDefinitionsDb.setCheckLabel(node, key, label === '' ? null : label)) {
        const path = `services[${serviceIndex}].labels.${componentId}`;
        throw new AppError(`The definition is not valid at ${path}: no check "${key}" exists yet — a component can be labelled after a health document has first carried it.`, {
          code: 'CERBERUS_BAD_DEFINITION',
          statusCode: 400,
          details: { path },
        });
      }
      touchedKeys.add(key);
    }
  }

  for (const row of cerberusDefinitionsDb.probesOf(node)) {
    if (!nextKeys.has(row.key)) cerberusDefinitionsDb.deleteProbe(node, row.key);
  }
  // A check lives while the probe that reports it does: its own probe, or the health_doc probe it
  // was discovered through. This also catches a probe that stayed but stopped being a health_doc.
  for (const check of cerberusDefinitionsDb.checksOf(node)) {
    if (check.retired_at !== null) continue;
    const lives = check.probe !== null ? nextKeys.has(check.probe) : check.source !== null ? nextHealthDocKeys.has(check.source) : true;
    if (lives) continue;
    cerberusDefinitionsDb.retireCheck(node, check.key, now);
    touchedKeys.add(check.key);
  }
  if (setChanged) cerberusNodesDb.setChecksVersion(node, version);

  return { version, setChanged, touchedKeys: [...touchedKeys] };
}

/**
 * Replaces a node's probes with the document's, and answers the version the node is now on.
 * Refuses an unknown node (404) and a document the parser refuses (400, the path in `details`).
 * After the commit it hints the screens and, when the warden's set changed, sends the new
 * `checks.set` down the node's link; an unlinked node gets it in its next `welcome`.
 */
export function putDefinition(node: string, body: unknown): { version: number } {
  requireEnrolledNode(node);
  const parsed = parseDefinition(node, body);
  if (!parsed.ok) {
    throw new AppError(`The definition is not valid at ${parsed.path}: ${parsed.message}.`, {
      code: 'CERBERUS_BAD_DEFINITION',
      statusCode: 400,
      details: { path: parsed.path },
    });
  }

  const written = getCerberusConnection()
    .transaction(() => writeDefinition(node, parsed.services))
    .immediate();

  hintChanged({ nodes: [node], checks: written.touchedKeys.map((key) => `${node}/${key}`) });
  if (written.setChanged) wardenLinks.send(node, 'checks.set', checksSetFor(node));
  return { version: written.version };
}

/**
 * Writes one check's label (`key`) or one service's (`service`) — exactly one of the two. An
 * empty label stores NULL, and the key stands in on screen again. 404 for a node that is not
 * enrolled (center's own node counts) or a check or service that is not there.
 */
export function setLabel(input: { node: string; key?: string; service?: string; label: string }): void {
  const { node, key, service } = input;
  requireKnownNode(node);
  if ((key === undefined) === (service === undefined)) {
    throw new AppError('Name either a check or a service to label, not both and not neither.', {
      code: 'CERBERUS_BAD_LABEL',
      statusCode: 400,
    });
  }
  if (typeof input.label !== 'string') {
    throw new AppError('A label must be text; an empty one clears it.', { code: 'CERBERUS_BAD_LABEL', statusCode: 400 });
  }
  const label = input.label.trim();
  if (label.length > MAX_LABEL_LENGTH) {
    throw new AppError(`A label can be ${MAX_LABEL_LENGTH} characters at most.`, { code: 'CERBERUS_BAD_LABEL', statusCode: 400 });
  }
  const stored = label === '' ? null : label;

  if (key !== undefined) {
    if (!cerberusDefinitionsDb.setCheckLabel(node, key, stored)) throw unknownCheck(node, `check "${key}"`);
    hintChanged({ nodes: [node], checks: [`${node}/${key}`] });
  } else if (service !== undefined) {
    if (cerberusDefinitionsDb.setServiceLabel(node, service, stored) === 0) throw unknownCheck(node, `service "${service}"`);
    hintChanged({ nodes: [node] });
  }
}

/** Retires a check: it leaves every screen and keeps its history. 404 when it is not an active check of the node; 409 for center's own. */
export function retireCheck(node: string, key: string): void {
  if (node === HUB_NODE_ID) {
    throw new AppError("Center's own checks cannot be retired.", { code: 'CERBERUS_HUB_CHECK', statusCode: 409 });
  }
  requireEnrolledNode(node);
  if (!cerberusDefinitionsDb.retireCheck(node, key, Date.now())) throw unknownCheck(node, `active check "${key}"`);
  hintChanged({ nodes: [node], checks: [`${node}/${key}`] });
}

/**
 * Files a component a health document carried for the first time: a check with no label, whose
 * `source` is the health_doc probe and whose `discovered_at` is `at`. A component that was retired
 * and appears again is revived, its label as it was. Ingest calls this inside its own transaction,
 * where nothing has committed yet, so inside one it does NOT hint: the caller hints after its commit
 * (a rolled-back frame must not announce a check that has no row). Outside a transaction it hints.
 */
export function discoverComponent(node: string, key: string, sourceProbeKey: string, at: number): void {
  cerberusDefinitionsDb.upsertCheck({
    node,
    key,
    service: key.slice(0, key.indexOf('/')),
    service_label: null,
    label: null,
    source: sourceProbeKey,
    probe: null,
    pass: null,
    warn: null,
    stale_after: null,
    version: cerberusNodesDb.get(node)?.checks_version ?? 0,
    discovered_at: at,
  });
  if (!getCerberusConnection().inTransaction) hintChanged({ nodes: [node], checks: [`${node}/${key}`] });
}

/**
 * Writes center's own definition: node `center`, service `cerberus`, three `self` probes every 30
 * seconds — so a check goes unknown after 90 s without a result. Idempotent, run at every start.
 * The default words are written only when a check is INSERTED: a row that exists keeps both its
 * labels as they are, a cleared one (NULL) included, so a boot never undoes the clearing `setLabel`
 * stored. `upsertCheck` leaves a stored label alone when it is handed `null`, so an existing row is.
 * The hub has no `nodes` row, so its probes sit at version 0 and no warden is ever sent them.
 */
export function seedHub(): void {
  const existingKeys = new Set(cerberusDefinitionsDb.checksOf(HUB_NODE_ID).map((check) => check.key));
  // A service has one name, kept on every check of it. Once any check of the service has a row, the
  // service name is whatever the rows carry (a cleared one stays cleared), and a check added later takes
  // its siblings' name through `upsertCheck`; only a service with no row at all is named from the default.
  const serviceHasRows = existingKeys.size > 0;

  getCerberusConnection()
    .transaction(() => {
      for (const { id, label } of HUB_CHECKS) {
        const key = `${HUB_SERVICE}/${id}`;
        cerberusDefinitionsDb.upsertProbe({
          node: HUB_NODE_ID,
          key,
          service: HUB_SERVICE,
          kind: 'self',
          spec: '{}',
          every: 30,
          timeout: 5,
          cadence: null,
          version: 0,
        });
        cerberusDefinitionsDb.upsertCheck({
          node: HUB_NODE_ID,
          key,
          service: HUB_SERVICE,
          service_label: serviceHasRows ? null : HUB_SERVICE_LABEL,
          label: existingKeys.has(key) ? null : label,
          source: null,
          probe: key,
          pass: null,
          warn: null,
          stale_after: null,
          version: 0,
          discovered_at: null,
        });
      }
    })
    .immediate();

  if (existingKeys.size < HUB_CHECKS.length) hintChanged({ nodes: [HUB_NODE_ID] });
}
