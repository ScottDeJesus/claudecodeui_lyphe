// protects: server/modules/analytics/sections/web-walk.ts, server/modules/analytics/sections/verb.ts, server/modules/analytics/sections/index.ts, server/modules/analytics/analytics.module.ts, /home/lyphe/.claude/hooks/web_walk/answer.py, /home/lyphe/.claude/scripts/web-walk
// writes: none
// The joined whole across the web-walk seam: what GET /api/analytics/web-walk?days=30 carries is the object
// web-walk reading --days 30 prints: the same days and first_day, totals, doors, settled verdict with its bars,
// series days, check rows and app rows with their screens. A walk that ends between the two reads moves a count,
// so the pair is read again, three times at most, before a difference is a break.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "web-walk");
const ROUTE = "/api/analytics/web-walk?days=30";

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["reading", "--days", "30"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
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
  const s = d.settled && typeof d.settled === "object" ? d.settled : {};
  return {
    days: d.days,
    first_day: d.first_day,
    totals: canon(d.totals),
    doors: canon(d.doors),
    settled: canon({ refusing: s.refusing, since: s.since, share: s.share, walks: s.walks, faults: s.faults, launches_walking: s.launches_walking, launches_by_hand: s.launches_by_hand, bars: s.bars }),
    series: rows(d.series).map((r) => r.day + "=" + r.walks + "/" + r.launches_walking + "/" + r.launches_by_hand + "/" + r.custom_steps + "/" + r.faults),
    checks: rows(d.checks).map((c) => c.check + "=" + c.ran + "/" + c.false).sort(),
    apps: rows(d.apps).map((a) => a.app + "=" + a.walks + ":" + rows(a.screens).map((x) => x.screen + "=" + x.opened + "/" + x.unreached).sort().join(",")).sort(),
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
    if (v.error) return cannotRun("web-walk reading --days 30 did not answer: " + v.error);
    const a = picture(data);
    const b = picture(v.data);
    if (JSON.stringify(a) === JSON.stringify(b)) {
      const t = data.totals || {};
      return held("route and command agree at 30 days: " + a.series.length + " series days, " + t.walks + " walks, " + a.checks.length + " check rows, " + a.apps.length + " apps, refusing " + (data.settled || {}).refusing + ", history from " + a.first_day);
    }
    last = difference(a, b);
  }
  return broken("three reads in a row, the route and the command disagree at 30 days: " + last);
});
