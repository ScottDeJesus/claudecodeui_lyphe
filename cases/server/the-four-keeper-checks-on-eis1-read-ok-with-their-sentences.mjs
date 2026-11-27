// protects: warden/src/probe-kinds/http.mjs, deploy/heal/bridge-drop.sh, deploy/heal/dev-unit.sh, server/modules/cerberus/read-model/check-detail.ts
// writes: none
//
// The four keeper checks on eis1 read ok: the three http checks say "HTTP 200 in <n> ms" (the two compile checks on a fresh module
// each run, not Vite's cache) and the bridge check says "4 of 4 bridge drops in place". Read only, with the checks token:
// GET /api/cerberus/checks/eis1/<service>/<check>, whose status center works out when it is read (a stale result is not ok).

import { api } from "../lib/app.mjs";
import { broken, held, runCase } from "../lib/case.mjs";

const NODE = "eis1";
const HTTP_200 = /^HTTP 200 in \d+ ms$/;
const DROPS = /\b4 of 4 bridge drops in place\b/;
const KEEPERS = [
  ["cloudcli/dev-client.compiles", HTTP_200],
  ["cloudcli/prod-client.ok", HTTP_200],
  ["eis-app/dev.compiles", HTTP_200],
  ["cloudcli/bridge.dropped", DROPS],
];

/** The check's reading as the detail carries it: its view under check, whose value is the latest sentence. */
function reading(detail) {
  const view = detail?.check ?? detail;
  return { status: view?.status ?? null, sentence: view?.value ?? null };
}

runCase(async () => {
  const wrong = [];
  const seen = [];
  for (const [key, said] of KEEPERS) {
    const detail = await api("/api/cerberus/checks/" + NODE + "/" + key);
    if (detail.status !== 200) { wrong.push(key + " answered " + detail.status); continue; }
    const { status, sentence } = reading(detail.json);
    if (status === null) { wrong.push(key + "'s detail carries no status (keys " + Object.keys(detail.json ?? {}).join(",") + ")"); continue; }
    if (status !== "ok") wrong.push(key + " is " + status + ": " + sentence);
    else if (!said.test(String(sentence))) wrong.push(key + " is ok but says " + JSON.stringify(sentence));
    seen.push(key + " " + sentence);
  }
  if (wrong.length) return broken(wrong.join("; ").slice(0, 380));
  return held("all four keeper checks on eis1 are ok: " + seen.join("; "));
});
