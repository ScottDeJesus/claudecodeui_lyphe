// protects: server/modules/cerberus/catalog.service.ts, server/modules/cerberus/cerberus.routes.ts, server/modules/cerberus/auto-run.ts, deploy/heal/dev-unit.sh, deploy/heal/bridge-drop.sh
// writes: none
//
// Each keeper check on eis1 has exactly one catalog entry, switched on to run by itself when the check fails, bounded to 3 runs an
// hour, asking for a recheck, not capped, running the repo's own deploy/heal script with the unit, canary and status as arguments;
// cloudcli/http.ok has none (Cerberus runs inside the API it would restart). Read only: GET /api/cerberus/catalog with the checks token.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const NODE = "eis1";
const DEV_UNIT = REPO + "/deploy/heal/dev-unit.sh";
const BRIDGE_DROP = REPO + "/deploy/heal/bridge-drop.sh";
const WANT = [
  { check: "cloudcli/dev-client.compiles", name: "Restart the CloudCLI dev client", cmd: DEV_UNIT + " cloudcli-client-dev.service http://127.0.0.1:5183/src/main.tsx 200", timeout: 120 },
  { check: "cloudcli/prod-client.ok", name: "Restart the CloudCLI production client", cmd: DEV_UNIT + " cloudcli-client-prod.service http://127.0.0.1:5184/ 200", timeout: 120 },
  { check: "eis-app/dev.compiles", name: "Restart the EIS App dev server", cmd: DEV_UNIT + " eis-app-dev.service http://localhost:5190/src/main.jsx 200", timeout: 120 },
  { check: "cloudcli/bridge.dropped", name: "Put the bridge drops back", cmd: BRIDGE_DROP + " fix 5183 5184", timeout: 30 },
];

runCase(async () => {
  const catalog = await api("/api/cerberus/catalog");
  if (catalog.status !== 200 || !Array.isArray(catalog.json)) return broken("GET /api/cerberus/catalog answered " + catalog.status);
  const entries = catalog.json.filter((entry) => entry.node === NODE);
  const wrong = [];
  for (const want of WANT) {
    const mine = entries.filter((entry) => entry.check === want.check);
    if (mine.length !== 1) { wrong.push(want.check + " has " + mine.length + " entries, not one"); continue; }
    const entry = mine[0];
    if (entry.name !== want.name) wrong.push(want.check + " is named " + JSON.stringify(entry.name));
    if (entry.cmd !== want.cmd) wrong.push(want.check + " runs " + JSON.stringify(entry.cmd));
    if (entry.timeout !== want.timeout) wrong.push(want.check + " timeout is " + entry.timeout);
    if (entry.when !== "failing") wrong.push(want.check + " applies when " + entry.when);
    if (entry.auto !== true) wrong.push(want.check + "'s entry is not switched on (auto " + entry.auto + ")");
    if (entry.limit?.runs !== 3 || entry.limit?.per !== 3600) wrong.push(want.check + " is limited to " + JSON.stringify(entry.limit));
    if (entry.recheck !== true) wrong.push(want.check + " asks for no recheck");
    if (entry.capped != null) wrong.push(want.check + " is capped: " + entry.capped);
  }
  const httpOk = entries.filter((entry) => entry.check === "cloudcli/http.ok");
  if (httpOk.length) wrong.push("cloudcli/http.ok has an entry: " + httpOk.map((entry) => entry.name).join(", "));
  for (const script of [DEV_UNIT, BRIDGE_DROP]) {
    try { fs.accessSync(script, fs.constants.X_OK); } catch { wrong.push(script + " is not an executable file"); }
  }
  if (wrong.length) return broken(wrong.slice(0, 4).join("; ") + (wrong.length > 4 ? "; and " + (wrong.length - 4) + " more" : ""));
  return held("eis1's four keeper checks each have one entry, auto on, failing, 3 runs an hour, recheck, uncapped, on the repo's deploy/heal scripts; cloudcli/http.ok has none");
});
