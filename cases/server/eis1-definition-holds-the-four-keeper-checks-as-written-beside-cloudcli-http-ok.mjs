// protects: server/modules/cerberus/definitions.service.ts, server/modules/cerberus/cerberus.routes.ts, warden/src/probe-kinds/http.mjs, deploy/heal/bridge-drop.sh
// writes: none
//
// eis1's Cerberus definition holds the four keeper checks exactly as they were written through the API, beside cloudcli/http.ok:
// three http probes and one exec probe, labelled, with the kinds' defaults as their rule (no pass or warn of their own). Read only,
// with the checks token: GET /api/cerberus/definitions/eis1, and GET /api/cerberus/checks for a label kept beside the probe.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const NODE = "eis1";
const WANT = [
  { service: "cloudcli", key: "cloudcli/dev-client.compiles", kind: "http", field: "url", value: "http://127.0.0.1:5183/src/main.tsx?t={nonce}", every: 60, timeout: 10, label: "CloudCLI dev client compiles a fresh module" },
  { service: "cloudcli", key: "cloudcli/prod-client.ok", kind: "http", field: "url", value: "http://127.0.0.1:5184/", every: 60, timeout: 10, label: "CloudCLI production client answers" },
  { service: "cloudcli", key: "cloudcli/bridge.dropped", kind: "exec", field: "cmd", value: REPO + "/deploy/heal/bridge-drop.sh check 5183 5184", every: 300, timeout: 10, label: "Docker bridges are kept off the CloudCLI client ports" },
  { service: "eis-app", key: "eis-app/dev.compiles", kind: "http", field: "url", value: "http://localhost:5190/src/main.jsx?t={nonce}", every: 60, timeout: 5, label: "EIS App dev server compiles a fresh module" },
];
const DEFAULT_RULES = new Set(["status == 200", "exit == 0"]);

const fieldOf = (probe, name) => probe?.[name] ?? probe?.spec?.[name];

runCase(async () => {
  const definition = await api("/api/cerberus/definitions/" + NODE);
  if (definition.status !== 200) return broken("GET /api/cerberus/definitions/" + NODE + " answered " + definition.status);
  const probes = new Map();
  for (const service of definition.json?.services ?? []) for (const probe of service.probes ?? []) probes.set(probe.key, { service: service.service, probe });
  const index = await api("/api/cerberus/checks");
  const labels = new Map((Array.isArray(index.json) ? index.json : []).filter((c) => c.node === NODE).map((c) => [c.key, c.label]));
  const wrong = [];
  for (const want of WANT) {
    const found = probes.get(want.key);
    if (!found) { wrong.push(want.key + " is not in the definition"); continue; }
    const { service, probe } = found;
    if (service !== want.service) wrong.push(want.key + " sits under service " + service);
    if (probe.kind !== want.kind) wrong.push(want.key + " is kind " + probe.kind);
    if (fieldOf(probe, want.field) !== want.value) wrong.push(want.key + " " + want.field + " is " + JSON.stringify(fieldOf(probe, want.field)));
    if (Number(fieldOf(probe, "every")) !== want.every) wrong.push(want.key + " every is " + fieldOf(probe, "every"));
    if (Number(fieldOf(probe, "timeout")) !== want.timeout) wrong.push(want.key + " timeout is " + fieldOf(probe, "timeout"));
    const label = probe.label ?? labels.get(want.key) ?? null;
    if (label !== want.label) wrong.push(want.key + " is labelled " + JSON.stringify(label));
    for (const rule of ["pass", "warn"]) {
      const value = fieldOf(probe, rule);
      if (value != null && !DEFAULT_RULES.has(String(value).trim())) wrong.push(want.key + " carries its own " + rule + " " + JSON.stringify(value));
    }
  }
  const httpOk = probes.get("cloudcli/http.ok");
  if (!httpOk) wrong.push("cloudcli/http.ok is gone from the definition");
  else if (httpOk.service !== "cloudcli" || httpOk.probe.kind !== "http") wrong.push("cloudcli/http.ok is now " + httpOk.service + " / " + httpOk.probe.kind);
  if (wrong.length) return broken(wrong.slice(0, 4).join("; ") + (wrong.length > 4 ? "; and " + (wrong.length - 4) + " more" : ""));
  return held("eis1's definition holds the four keeper checks as written, labelled, on the kinds' default rules, beside cloudcli/http.ok (" + probes.size + " probes in all)");
});
