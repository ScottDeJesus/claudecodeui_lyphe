import type { CerberusCheckRow, CerberusCheckUpsert, CerberusProbeRow } from '@/modules/database/index.js';
import type {
  CerberusDefinition,
  CerberusProbeDefinition,
  CerberusProbeKind,
  CerberusProbeSpec,
  CerberusServiceDefinition,
} from '@/shared/cerberus-types.js';

import { KIND_FIELDS, PROBE_KINDS } from './definition-document.js';

/**
 * Moves a probe between its two forms: the document a person writes and the rows the store keeps.
 *
 * At rest a probe is split across two tables — `probes` holds what the warden runs (the kind's
 * own fields as the `spec` JSON, `every`, `timeout`, `cadence`), and the `checks` row of the check
 * it reports holds `pass`, `warn`, `stale_after` and the label. A `checks.set` and a definition
 * document are both that join, read back; this file is the one place the split and the join are
 * spelled, so the writer, the reader and the warden's copy cannot disagree about which field lives
 * where. No statement runs here: it maps rows in and rows out.
 *
 * Consumer: `definitions.service.ts`, which reads rows and hands them here, and writes the rows
 * this file builds.
 */

/** The order a probe's fields are compared in: a change in any one of them is a change the warden must hear. */
const SPEC_SIGNATURE_FIELDS = [
  'key',
  'service',
  'kind',
  'every',
  'timeout',
  'cadence',
  'url',
  'host',
  'port',
  'cmd',
  'path',
  'dsn',
  'query',
  'pass',
  'warn',
  'staleAfter',
] as const;

function isProbeKind(kind: string): kind is CerberusProbeKind {
  return (PROBE_KINDS as readonly string[]).includes(kind);
}

/** The kind's own fields out of a row's `spec` JSON — only the ones the kind owns, whatever else the text holds. */
function kindFieldsOf(row: CerberusProbeRow, kind: CerberusProbeKind): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(row.spec) as Record<string, unknown>;
  } catch (error) {
    // Only this service writes the column, so this is a damaged row; the warden will report the
    // probe as unrunnable, which is louder than leaving it out of the set.
    console.error(`[Cerberus] the spec of probe ${row.node}/${row.key} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const fields: Record<string, unknown> = {};
  for (const field of KIND_FIELDS[kind]) {
    if (stored[field] !== undefined) fields[field] = stored[field];
  }
  return fields;
}

/**
 * The checks of a node that are a probe's OWN check, by key. A probe's own check carries the key
 * of the probe, so this is also the table of every probe's `pass`, `warn`, `stale_after` and label.
 */
export function ownChecksByKey(checks: CerberusCheckRow[]): Map<string, CerberusCheckRow> {
  return new Map(checks.filter((check) => check.probe !== null).map((check) => [check.key, check]));
}

/**
 * One probe as the warden runs it, joined from its row and its own check's row; `null` for a row
 * whose kind is not one a warden knows (center's own `self` probes, which no warden ever runs).
 */
export function probeSpecOf(row: CerberusProbeRow, ownCheck: CerberusCheckRow | undefined): CerberusProbeSpec | null {
  if (!isProbeKind(row.kind)) return null;

  const spec: Record<string, unknown> = {
    key: row.key,
    service: row.service,
    kind: row.kind,
    every: row.every,
    timeout: row.timeout,
    ...kindFieldsOf(row, row.kind),
  };
  if (row.cadence !== null) spec.cadence = row.cadence;
  if (ownCheck?.pass) spec.pass = ownCheck.pass;
  if (ownCheck?.warn) spec.warn = ownCheck.warn;
  if (ownCheck?.stale_after) spec.staleAfter = ownCheck.stale_after;
  return spec as CerberusProbeSpec;
}

/** A document's probe as the warden would run it: the same fields, without the label the warden never hears of. */
export function specOfDefinition(probe: CerberusProbeDefinition): CerberusProbeSpec {
  const spec: CerberusProbeDefinition = { ...probe };
  delete spec.label;
  return spec;
}

/**
 * A text that is equal exactly when two sets of probes would make a warden run the same thing:
 * the probes in key order, every field in a fixed order. A label is not in it — the warden never
 * hears of one, so a label write must not bump the version or restart anything.
 */
export function specSetSignature(specs: CerberusProbeSpec[]): string {
  return specs
    .map((spec) => JSON.stringify(SPEC_SIGNATURE_FIELDS.map((field) => spec[field] ?? null)))
    .sort()
    .join('\n');
}

/** The `probes` row a probe of a document is stored as, written at checks-set `version`. */
export function probeRowOf(node: string, probe: CerberusProbeDefinition, version: number): CerberusProbeRow {
  const fields: Record<string, unknown> = {};
  for (const field of KIND_FIELDS[probe.kind]) fields[field] = (probe as Record<string, unknown>)[field];
  return {
    node,
    key: probe.key,
    service: probe.service,
    kind: probe.kind,
    spec: JSON.stringify(fields),
    every: probe.every,
    timeout: probe.timeout,
    cadence: probe.cadence ?? null,
    version,
  };
}

/**
 * The `checks` row of a probe's own check. Its key IS the probe's key. `label` is the probe's
 * label when one is written (an empty one is carried as NULL, which an upsert leaves alone — the
 * writer clears a label explicitly); `service_label` is left NULL for the service's own write.
 */
export function ownCheckUpsertOf(node: string, probe: CerberusProbeDefinition, version: number): CerberusCheckUpsert {
  return {
    node,
    key: probe.key,
    service: probe.service,
    service_label: null,
    label: probe.label ? probe.label : null,
    source: null,
    probe: probe.key,
    pass: probe.pass ?? null,
    warn: probe.warn ?? null,
    stale_after: probe.staleAfter ?? null,
    version,
    discovered_at: null,
  };
}

/**
 * A node's definition document, read back from its rows. Services appear in key order; a service's
 * label is the one its active checks carry; `labels` holds the component labels (the checks a
 * health_doc probe discovered, by the id after the service's `/`) that someone has written.
 */
export function definitionFromRows(
  node: string,
  version: number,
  probes: CerberusProbeRow[],
  checks: CerberusCheckRow[]
): CerberusDefinition {
  const ownChecks = ownChecksByKey(checks);
  const activeChecks = checks.filter((check) => check.retired_at === null);
  const services: CerberusServiceDefinition[] = [];

  for (const row of probes) {
    const spec = probeSpecOf(row, ownChecks.get(row.key));
    if (!spec) continue;

    let service = services.find((candidate) => candidate.service === row.service);
    if (!service) {
      const serviceChecks = activeChecks.filter((check) => check.service === row.service);
      service = {
        service: row.service,
        label: serviceChecks.find((check) => check.service_label !== null)?.service_label ?? null,
        probes: [],
      };
      const labels: Record<string, string> = {};
      for (const component of serviceChecks) {
        if (component.probe === null && component.label !== null) labels[component.key.slice(row.service.length + 1)] = component.label;
      }
      if (Object.keys(labels).length > 0) service.labels = labels;
      services.push(service);
    }

    const label = ownChecks.get(row.key)?.label;
    service.probes.push(label ? { ...spec, label } : spec);
  }
  return { node, version, services };
}
