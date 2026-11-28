// protects: server/modules/cerberus/definition-document.ts, server/shared/cerberus-types.ts
// writes: none
//
// An exec probe's definition may carry watch (an absolute path) and ages ('s','m','h','d'), refused unless
// both are there; accepted, both reach the parsed probe the warden is handed.

import { broken, held, runCase } from "../lib/case.mjs";

const DOC = new URL("../../server/modules/cerberus/definition-document.ts", import.meta.url);
const WATCH = "/var/lib/case-backup/status.json";

runCase(async () => {
  const { parseDefinition } = await import(DOC.href);
  const document = (extra: Record<string, unknown>) => ({
    services: [{ service: "case", label: null, probes: [{ key: "case/copy.age", kind: "exec", every: 300, timeout: 30, cmd: "echo 1", ...extra }] }],
  });
  for (const ages of ["s", "m", "h", "d"]) {
    const parsed = parseDefinition("case-node", document({ watch: WATCH, ages }));
    if (!parsed.ok) return broken("an exec probe with watch and ages " + ages + " is refused: " + parsed.path + " " + parsed.message);
    const kept = JSON.stringify(parsed.services);
    if (!kept.includes('"watch":"' + WATCH + '"') || !kept.includes('"ages":"' + ages + '"')) return broken("accepted, the parsed probe drops watch or ages: " + kept.slice(0, 300));
  }
  const refused: Array<[string, Record<string, unknown>]> = [
    ["watch without ages", { watch: WATCH }],
    ["ages without watch", { ages: "h" }],
    ["ages w", { watch: WATCH, ages: "w" }],
    ["a relative watch", { watch: "var/lib/case-backup/status.json", ages: "h" }],
  ];
  for (const [label, extra] of refused) {
    const parsed = parseDefinition("case-node", document(extra));
    if (parsed.ok) return broken("an exec probe with " + label + " is accepted");
  }
  return held("watch+ages accepted for s/m/h/d and kept; the four half or malformed shapes refused");
});
