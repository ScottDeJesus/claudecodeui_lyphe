// The Code Mode section on the running server: the envelope { section, days, data } around the house verb's
// `code-mode analytics --days N` object, data.days the window asked, every row carrying the figures the wire type
// names, "all" spelled null in the rollups. While the house verb has no `analytics` form (its phase lands beside
// this one), the promise is the 502 ANALYTICS_SOURCE_FAILED carrying the verb's own sentence, never "not at <bin>".
//
// protects: server/index.ts, server/modules/analytics/, server/shared/analytics-types.ts
// writes: none

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROUTE = "/api/analytics/code-mode";
const HOUSE = path.join(os.homedir(), ".claude", "hooks", "plan_runner", "code_mode");
const LISTS = ["kinds", "uncounted", "groups", "rollups", "series", "causes"];

function verbLanded() {
  const main = path.join(HOUSE, "__main__.py");
  return fs.existsSync(path.join(HOUSE, "analytics.py")) && fs.existsSync(main) && /analytics/.test(fs.readFileSync(main, "utf8"));
}

function figureKeys() {
  const text = fs.readFileSync(path.join(REPO, "server/shared/analytics-types.ts"), "utf8");
  const block = /export type CodeModeFigures = \{([^}]*)\}/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/(\w+)\??:/g)].map((m) => m[1]);
}

runCase(async () => {
  if (!fs.existsSync(path.join(HOUSE, "__main__.py"))) return cannotRun(`the house's code_mode package is not at ${HOUSE}`);
  const landed = verbLanded();
  const keys = landed ? figureKeys() : [];
  if (landed && keys.length === 0) return broken("server/shared/analytics-types.ts declares no CodeModeFigures keys");
  const wrong = [];
  const saw = [];
  for (const days of [30, 7]) {
    const r = await api(`${ROUTE}?days=${days}`);
    if (!landed) {
      const message = String(r.json?.error?.message ?? "");
      if (r.status !== 502 || r.json?.error?.code !== "ANALYTICS_SOURCE_FAILED" || message === "" || /is not at/.test(message)) {
        wrong.push(`days=${days} answered ${r.status} ${JSON.stringify(r.json?.error ?? String(r.text ?? "").slice(0, 120))}, not a 502 ANALYTICS_SOURCE_FAILED carrying the verb's sentence`);
      } else saw.push(`days=${days}: 502 "${message.slice(0, 120)}"`);
      continue;
    }
    if (r.status !== 200) { wrong.push(`days=${days} answered ${r.status} ${String(r.text ?? "").slice(0, 160)}`); continue; }
    const { section, data } = r.json ?? {};
    if (section !== "code-mode" || r.json.days !== days || data?.days !== days) {
      wrong.push(`days=${days} answered section ${section}, days ${r.json?.days}, data.days ${data?.days}`);
      continue;
    }
    const notLists = LISTS.filter((k) => !Array.isArray(data[k]));
    if (notLists.length > 0) { wrong.push(`days=${days}: data.${notLists.join(", ")} not lists`); continue; }
    for (const list of ["groups", "rollups", "series"]) {
      const short = data[list].filter((row) => keys.some((k) => typeof row[k] !== "number"));
      if (short.length > 0) wrong.push(`days=${days}: ${short.length} ${list} rows lack a CodeModeFigures number, e.g. ${JSON.stringify(short[0]).slice(0, 160)}`);
    }
    const spelled = data.rollups.filter((row) => row.model !== null);
    if (spelled.length > 0) wrong.push(`days=${days}: ${spelled.length} rollups spell their model ${JSON.stringify(spelled[0].model)}, not null`);
    saw.push(`days=${days}: ${data.groups.length} groups, ${data.rollups.length} rollups, ${data.series.length} series rows`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`${landed ? "house verb answers analytics" : "house verb has no analytics form yet"} — ${saw.join("; ")}`);
});
