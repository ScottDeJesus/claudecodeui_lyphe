import { cerberusDefinitionsDb } from '@/modules/database/index.js';
import type { CerberusCheckView } from '@/shared/cerberus-types.js';

import { oneMaskedLine } from './diagnosis-text.js';

/**
 * What a check MEASURES, as lines for the diagnosing agent's prompt: the kind of probe, what it looks
 * at (a file's path, a URL, a host and port, a command, a query) and the rule that decides pass, warn and
 * fail. A check's value says only what the probe found ("Newest file written 1 min ago (probe-file.txt)");
 * without WHERE it looked the agent has no way to go and read the thing — the first measured diagnosis
 * of a file-age check read twenty-four directories looking for the file and never submitted.
 *
 * Read from the store as it is now: the `checks` row (its `pass` and `warn` expressions, the probe that
 * reports it) and that probe's `spec` JSON. A component fanned out of a health document names the
 * document's URL; the hub's own checks say they are center's.
 *
 * WHAT NEVER REACHES THE MODEL. `dsn` is left out whole — a database connection string is a credential
 * — and every other field goes through `oneMaskedLine`, so a token in a URL or a command line is masked the
 * way every other stored text of a diagnosis is. The fields are picked by name, not copied: a probe kind that
 * gains a field gains no exposure until it is added here.
 *
 * Consumers: `diagnosis-agent.ts`, which hands the lines to `buildDiagnosisSystemPrompt`.
 */

/** A target field is cut to this before it enters the prompt. */
const FIELD_LIMIT = 240;

/** The spec fields that say what a probe looks at, in the order the prompt lists them. `dsn` is deliberately not one. */
const TARGET_FIELDS = ['url', 'host', 'port', 'path', 'cmd', 'query'] as const;

/** The probe's spec JSON as an object; empty — logged — when it is not one. */
function readSpec(spec: string, probe: string, node: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(spec);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the log below, with the same fallback.
  }
  console.error(`[Cerberus] probe ${probe} of node ${node} has a spec this center cannot read`);
  return {};
}

/**
 * The lines saying what `check` measures: probe kind and cadence, each target field the probe has, and the
 * check's pass and warn rules. An empty list when nothing is known (a check whose probe row is gone).
 */
export function describeMeasurement(check: CerberusCheckView): string[] {
  const row = cerberusDefinitionsDb.activeChecks(check.node).find((candidate) => candidate.key === check.key);
  if (!row) return [];
  if (check.kind === 'self') return ["  one of Cerberus's own checks, run by center itself — there is no probe on a node behind it"];

  const lines: string[] = [];
  const probeKey = row.reporting_probe;
  const probe = probeKey === null ? undefined : cerberusDefinitionsDb.probesOf(check.node).find((candidate) => candidate.key === probeKey);
  if (probe) {
    const via =
      check.origin === 'component'
        ? `one component of the health document that probe ${probe.key} fetches every ${probe.cadence ?? probe.every} s`
        : `probe ${probe.key} (${probe.kind}), every ${probe.every} s`;
    lines.push(`  ${via}`);
    const spec = readSpec(probe.spec, probe.key, check.node);
    for (const field of TARGET_FIELDS) {
      const value = spec[field];
      if (typeof value === 'string' || typeof value === 'number') lines.push(`  ${field}: ${oneMaskedLine(String(value), FIELD_LIMIT)}`);
    }
  }
  if (row.pass !== null) lines.push(`  passes when: ${oneMaskedLine(row.pass, FIELD_LIMIT)}`);
  if (row.warn !== null) lines.push(`  warns when: ${oneMaskedLine(row.warn, FIELD_LIMIT)}`);
  return lines;
}
