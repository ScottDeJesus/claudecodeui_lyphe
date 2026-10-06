import type {
  CerberusProbeDefinition,
  CerberusProbeKind,
  CerberusServiceDefinition,
} from '@/shared/cerberus-types.js';

/**
 * The key grammar of Cerberus and the parser of a node's definition document.
 *
 * A definition is what a person writes (`PUT /api/cerberus/definitions/:node`): the services of one
 * node, each with the probes a warden runs for it and the plain labels of what they report. This
 * file decides whether a document is well formed — every service id, probe id, kind and kind field
 * — and answers a normalised copy or the one path that is wrong. It touches no store; what the
 * service does with a good document is `definitions.service.ts`.
 *
 * The parser REFUSES rather than repairs: a field it does not know is refused at its own path (a
 * `staleafter` typo would otherwise be dropped and a check would quietly keep its default
 * staleness), and so is a field that belongs to another kind (a `url` on a `tcp` probe).
 *
 * `pass` and `warn` stay TEXT. They are expressions the warden parses (`age < 26h`); this file
 * only requires that a `file_age` probe has a `pass`, since without one it cannot judge anything.
 *
 * Consumers: `definitions.service.ts` (the writer: `parseDefinition`, the patterns, `KIND_FIELDS`
 * and the hub's id), `definition-rows.ts` (`KIND_FIELDS` and `PROBE_KINDS`, to move a probe between
 * its document and its rows) and `enrollments.service.ts`, which validates a node name against the
 * same grammar.
 */

/**
 * The id of center's own node: it checks itself, has no warden and no `nodes` row, and is never a
 * name a person can enroll. Consumers: `definitions.service.ts` (the hub's seed and label writes),
 * `ingest.service.ts` (the node whose results carry no warden's sequence), `self-checks.service.ts`
 * (the node it reports as) and the read model
 * (`read-model/overview.ts`, `check-views.ts` and `node-links.ts`: the hub comes first, is never
 * silent, and its checks are `self`).
 */
export const HUB_NODE_ID = 'center';

// The node grammar written with its one exclusion, so no caller can validate a name and forget
// that `center` is taken. Built from `HUB_NODE_ID` so the two cannot drift.
/**
 * A node name: lower case, digits and hyphens, at most 32 characters, and never `center`.
 * Consumers: `enrollments.service.ts` (the name a token is minted for).
 */
export const NODE_ID_PATTERN = new RegExp(`^(?!${HUB_NODE_ID}$)[a-z0-9][a-z0-9-]{0,31}$`);

/**
 * A service id: lower case, digits and hyphens, at most 48 characters. Holds no `/`.
 * Consumers: this file's parser and `ingest.service.ts`'s key test.
 */
export const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * A check id — the part of a key after its service: letters, digits, `.`, `_`, `-`, at most 80
 * characters. Holds no `/`. Consumers: this file's parser and `ingest.service.ts`'s key test.
 */
export const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Every probe kind, in the order the error message lists them. Consumers: this file and `definition-rows.ts`'s row reader. */
export const PROBE_KINDS: readonly CerberusProbeKind[] = ['health_doc', 'http', 'tcp', 'exec', 'file_age', 'sql'];

/**
 * The fields that belong to each kind and to no other, in the order they are stored. All of them
 * are required: a probe without its `url`, `host` and `port`, `cmd`, `path` or `dsn` and `query`
 * has nothing to run. Consumers: this file's parser, and `definition-rows.ts`, which moves exactly
 * these fields between a probe's document and its `spec` column.
 */
export const KIND_FIELDS: Record<CerberusProbeKind, readonly string[]> = {
  health_doc: ['url'],
  http: ['url'],
  tcp: ['host', 'port'],
  exec: ['cmd'],
  file_age: ['path'],
  sql: ['dsn', 'query'],
};

/** What `parseDefinition` answers: the normalised services, or the path of the first thing wrong. Consumer: `definitions.service.ts`. */
export type ParsedDefinition =
  | { ok: true; services: CerberusServiceDefinition[] }
  | { ok: false; path: string; message: string };

// The longest period any duration field may name, 30 days in seconds: a guard against a typo in
// milliseconds, not a product rule.
const MAX_SECONDS = 2_592_000;

/**
 * The longest a plain label may be, in characters. Consumers: this file's parser and
 * `definitions.service.ts`'s `setLabel`, so a label is refused at one length on every door.
 */
export const MAX_LABEL_LENGTH = 200;
const COMMON_PROBE_FIELDS = ['key', 'service', 'kind', 'every', 'timeout', 'label', 'pass', 'warn', 'staleAfter'];

/** Thrown inside the parser and caught at its door, so the checks below read as plain statements. */
class Refusal extends Error {
  constructor(
    readonly path: string,
    message: string
  ) {
    super(message);
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Refusal(path, 'must be an object');
  return value as Record<string, unknown>;
}

function asText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Refusal(path, 'must be a non-empty string');
  return value.trim();
}

function asWholeNumber(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Refusal(path, `must be a whole number from 1 to ${max.toLocaleString('en-US')}`);
  }
  return value;
}

/** A label: a string up to the length cap; the empty string is kept (it means "clear the label"). */
function asLabel(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Refusal(path, 'must be a string');
  const label = value.trim();
  if (label.length > MAX_LABEL_LENGTH) throw new Refusal(path, `can be ${MAX_LABEL_LENGTH} characters at most`);
  return label;
}

function refuseUnknownFields(record: Record<string, unknown>, allowed: readonly string[], path: string, kind: string): void {
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) throw new Refusal(`${path}.${field}`, `is not a field of a ${kind} probe`);
  }
}

function parseKindField(field: string, value: unknown, path: string): string | number {
  if (field === 'port') return asWholeNumber(value, path, 65_535);
  const text = asText(value, path);
  if (field === 'url') {
    let protocol = '';
    try {
      protocol = new URL(text).protocol;
    } catch {
      throw new Refusal(path, 'must be an http or https URL');
    }
    if (protocol !== 'http:' && protocol !== 'https:') throw new Refusal(path, 'must be an http or https URL');
  }
  return text;
}

function parseProbe(raw: unknown, path: string, service: string): CerberusProbeDefinition {
  const record = asRecord(raw, path);

  const kind = record.kind;
  if (typeof kind !== 'string' || !PROBE_KINDS.includes(kind as CerberusProbeKind)) {
    throw new Refusal(`${path}.kind`, `must be one of ${PROBE_KINDS.join(', ')}`);
  }
  const probeKind = kind as CerberusProbeKind;
  // `cadence` is how often a health document republishes, so it is a health_doc's field alone;
  // that keeps "three times the cadence, else three times every" one rule for every kind.
  const cadenceFields = probeKind === 'health_doc' ? ['cadence'] : [];
  refuseUnknownFields(record, [...COMMON_PROBE_FIELDS, ...KIND_FIELDS[probeKind], ...cadenceFields], path, probeKind);

  // The key is `<service>/<id>`; a probe's `service` field, when written, must agree with the
  // service it sits under — one document cannot file a probe under two services.
  const key = asText(record.key, `${path}.key`);
  const probeId = key.startsWith(`${service}/`) ? key.slice(service.length + 1) : null;
  if (probeId === null) throw new Refusal(`${path}.key`, `must start with "${service}/"`);
  if (!CHECK_ID_PATTERN.test(probeId)) throw new Refusal(`${path}.key`, 'its id after the "/" is not a valid check id');
  if (probeKind === 'health_doc' && probeId !== 'health') {
    throw new Refusal(`${path}.key`, `a health_doc probe's key is "${service}/health"`);
  }
  if (record.service !== undefined && record.service !== service) {
    throw new Refusal(`${path}.service`, `must be "${service}", the service it sits under`);
  }

  const probe: Record<string, unknown> = {
    key,
    service,
    kind: probeKind,
    every: asWholeNumber(record.every, `${path}.every`, MAX_SECONDS),
    timeout: asWholeNumber(record.timeout, `${path}.timeout`, MAX_SECONDS),
  };
  if (record.cadence !== undefined) probe.cadence = asWholeNumber(record.cadence, `${path}.cadence`, MAX_SECONDS);
  for (const field of KIND_FIELDS[probeKind]) {
    probe[field] = parseKindField(field, record[field], `${path}.${field}`);
  }

  if (record.pass !== undefined) probe.pass = asText(record.pass, `${path}.pass`);
  if (probeKind === 'file_age' && probe.pass === undefined) {
    throw new Refusal(`${path}.pass`, 'a file_age probe needs a pass expression, such as "age < 26h"');
  }
  if (record.warn !== undefined) probe.warn = asText(record.warn, `${path}.warn`);
  if (record.staleAfter !== undefined) probe.staleAfter = asWholeNumber(record.staleAfter, `${path}.staleAfter`, MAX_SECONDS);
  if (record.label !== undefined) probe.label = asLabel(record.label, `${path}.label`);
  return probe as CerberusProbeDefinition;
}

function parseService(raw: unknown, path: string, seenServices: Set<string>): CerberusServiceDefinition {
  const record = asRecord(raw, path);
  refuseUnknownFields(record, ['service', 'label', 'probes', 'labels'], path, 'service');

  const service = asText(record.service, `${path}.service`);
  if (!SERVICE_ID_PATTERN.test(service)) {
    throw new Refusal(`${path}.service`, 'must be lower case letters, digits and hyphens, at most 48 characters');
  }
  if (seenServices.has(service)) throw new Refusal(`${path}.service`, `"${service}" is listed twice`);
  seenServices.add(service);

  // A service's label lives on the rows of its checks, so a service with no probe has nowhere to
  // keep one: refuse it instead of accepting a document that quietly says nothing.
  if (!Array.isArray(record.probes) || record.probes.length === 0) {
    throw new Refusal(`${path}.probes`, 'must list at least one probe');
  }
  const seenKeys = new Set<string>();
  const probes = record.probes.map((rawProbe, index) => {
    const probe = parseProbe(rawProbe, `${path}.probes[${index}]`, service);
    if (seenKeys.has(probe.key)) throw new Refusal(`${path}.probes[${index}].key`, `"${probe.key}" is listed twice`);
    seenKeys.add(probe.key);
    return probe;
  });

  const parsed: CerberusServiceDefinition = {
    service,
    label: record.label === undefined || record.label === null ? null : asLabel(record.label, `${path}.label`),
    probes,
  };
  if (record.labels !== undefined) {
    const labels: Record<string, string> = {};
    for (const [componentId, label] of Object.entries(asRecord(record.labels, `${path}.labels`))) {
      const labelPath = `${path}.labels.${componentId}`;
      if (!CHECK_ID_PATTERN.test(componentId)) throw new Refusal(labelPath, 'is not a valid check id');
      labels[componentId] = asLabel(label, labelPath);
    }
    parsed.labels = labels;
  }
  return parsed;
}

/**
 * Checks a node's definition document and answers its normalised services, or the path of the
 * first thing wrong with a sentence saying what (`services[2].probes[0].pass`). `node` is the
 * node the document is being written to: a document that names another node is refused, so a
 * definition read from one node cannot be written over another by a copied path.
 *
 * Normalised means trimmed strings, a `service` filled into every probe, and every field of the
 * document's own shape; `version` in the document is ignored, since the store owns it.
 *
 * Consumer: `definitions.service.ts`, whose `putDefinition` turns a refusal into a 400
 * `CERBERUS_BAD_DEFINITION` carrying the path.
 */
export function parseDefinition(node: string, body: unknown): ParsedDefinition {
  try {
    const document = asRecord(body, 'body');
    if (document.node !== undefined && document.node !== node) {
      throw new Refusal('node', `is "${String(document.node)}", but the document is being written to "${node}"`);
    }
    if (!Array.isArray(document.services)) throw new Refusal('services', 'must be a list');

    const seenServices = new Set<string>();
    const services = document.services.map((rawService, index) => parseService(rawService, `services[${index}]`, seenServices));
    return { ok: true, services };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, path: error.path, message: error.message };
    throw error;
  }
}
