// protects: server/modules/analytics/sections/repeats.ts, server/modules/analytics/sections/verb.ts, server/modules/analytics/sections/index.ts, server/modules/analytics/analytics.module.ts, /home/lyphe/.claude/hooks/heal_repeats/answer.py, /home/lyphe/.claude/scripts/heal-repeats
// writes: none
// The joined whole across the repeats seam: what GET /api/analytics/repeats?days=30 carries is the object
// heal-repeats reading --days 30 prints: the same days, today, first_day, window_days, thresholds, totals, steps
// totals, series days and family rows (id, tool, launches, programs, characters, uses, raised, cured_at, feature
// count). A launch that ends between the two reads moves a count, so the pair is read again, three times at most,
// before a difference is a break. The reading's own sync notes changed folders into its index: that is what every
// open of the section does, and the case changes nothing else.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "heal-repeats");
const ROUTE = "/api/analytics/repeats?days=30";

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["reading", "--days", "30"], { cwd: os.homedir(), timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
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

function canon(value) {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? null : value);
}

const rows = (v) => (Array.isArray(v) ? v : []);

function picture(d) {
  const st = d.steps && typeof d.steps === "object" ? d.steps : {};
  return {
    days: d.days,
    today: d.today,
    first_day: d.first_day,
    window_days: d.window_days,
    thresholds: canon(d.thresholds),
    totals: canon(d.totals),
    steps: canon({ uses: st.uses, worked: st.worked, launches: st.launches, by_helper: st.by_helper }),
    series: rows(d.series).map((r) => r.day + "=" + r.launches_writing + "/" + r.programs + "/" + r.chars + "/" + r.chars_in_families),
    families: rows(d.families).map((f) => f.id + "=" + f.tool + "/" + f.launches + "/" + f.programs + "/" + f.chars + "/" + f.uses + "/" + f.raised + "/" + f.cured_at + "/" + rows(f.features).length).sort(),
  };
}

function difference(a, b) {
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (!Array.isArray(a[key])) return key + ": route " + String(JSON.stringify(a[key])).slice(0, 160) + ", command " + String(JSON.stringify(b[key])).slice(0, 160);
    const onlyRoute = a[key].filter((x) => !b[key].includes(x)).slice(0, 2);
    const onlyVerb = b[key].filter((x) => !a[key].includes(x)).slice(0, 2);
    return key + ": route " + a[key].length + " rows, command " + b[key].length + "; route only " + JSON.stringify(onlyRoute) + ", command only " + JSON.stringify(onlyVerb);
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
    if (v.error) return cannotRun("heal-repeats reading --days 30 did not answer: " + v.error);
    const a = picture(data);
    const b = picture(v.data);
    if (JSON.stringify(a) === JSON.stringify(b)) {
      const t = data.totals || {};
      const ids = rows(data.families).map((f) => f.id);
      return held("route and command agree at 30 days: " + ids.length + " families (" + ids.slice(0, 4).join(", ") + (ids.length > 4 ? ", ..." : "") + "), " + t.launches + " launches read, " + t.programs + " programs, " + t.chars + " characters, " + a.series.length + " series days, " + (data.steps || {}).uses + " custom-step uses");
    }
    last = difference(a, b);
  }
  return broken("three reads in a row, the route and the command disagree at 30 days: " + last);
});
