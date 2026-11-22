// protects: server/modules/analytics/sections/code-mode.ts, server/modules/analytics/analytics.service.ts, /home/lyphe/.claude/hooks/plan_runner/code_mode/analytics.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/history.py
// writes: none
// The joined whole across the seam: what GET /api/analytics/code-mode?days=30 carries is the object
// `code-mode analytics --days 30` prints: the same groups with the same launches, the same cause families
// with the same counts, the same faults total and first_day. A launch that ends between the two reads moves
// one count, so the pair is read again, three times at most, before a difference is a break.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "code-mode");
const ROUTE = "/api/analytics/code-mode?days=30";

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["analytics", "--days", "30"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

function dataOf(json) {
  const envelope = json && json.data && typeof json.data === "object" && "section" in json.data ? json.data : json;
  return envelope && typeof envelope === "object" ? envelope.data : undefined;
}

function picture(d) {
  const groups = (Array.isArray(d.groups) ? d.groups : []).map((r) => r.kind + "|" + r.code_mode + "|" + r.model + "=" + r.launches).sort();
  const causes = (Array.isArray(d.causes) ? d.causes : []).map((c) => c.fault + "|" + c.helper + "|" + c.hook + "=" + c.count + "/" + c.threw).sort();
  return { days: d.days, first_day: d.first_day, faults: d.faults ? d.faults.total : null, groups: groups, causes: causes };
}

function difference(a, b) {
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (!Array.isArray(a[key])) return key + ": route " + JSON.stringify(a[key]) + ", verb " + JSON.stringify(b[key]);
    const onlyRoute = a[key].filter((x) => !b[key].includes(x)).slice(0, 2);
    const onlyVerb = b[key].filter((x) => !a[key].includes(x)).slice(0, 2);
    return key + ": route " + a[key].length + " rows, verb " + b[key].length + "; route only " + JSON.stringify(onlyRoute) + ", verb only " + JSON.stringify(onlyVerb);
  }
  return "none";
}

runCase(async () => {
  let last = "";
  for (let turn = 0; turn < 3; turn += 1) {
    const r = await api(ROUTE);
    if (r.status !== 200) return broken("the route answered " + r.status + ": " + String(r.text || "").slice(0, 200));
    const data = dataOf(r.json);
    if (!data || typeof data !== "object") return broken("the route answered 200 with no data object in its envelope");
    const v = await verb();
    if (v.error) return cannotRun("code-mode analytics --days 30 did not answer: " + v.error);
    const a = picture(data);
    const b = picture(v.data);
    if (JSON.stringify(a) === JSON.stringify(b)) {
      return held("route and verb agree at 30 days: " + a.groups.length + " groups, " + a.causes.length + " cause families, faults " + a.faults + ", history from " + a.first_day);
    }
    last = difference(a, b);
  }
  return broken("three reads in a row, the route and the verb disagree at 30 days: " + last);
});
