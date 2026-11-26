// protects: server/modules/analytics/sections/rnd.ts, server/modules/analytics/sections/verb.ts, server/modules/analytics/sections/index.ts, server/modules/analytics/analytics.module.ts, server/shared/dispatcher-command.ts, /home/lyphe/.claude/hooks/dispatcher/cmd/rnd.py, /home/lyphe/.claude/hooks/dispatcher/rnd_readings.py
// writes: none
// The joined whole across the R&D reader seam (rnd-adopted-measures, phase 5): GET /api/analytics lists rnd as its last
// section, and what GET /api/analytics/rnd carries under its envelope's data is the document
// dispatcher rnd readings --json prints, feature for feature and key for key: the reader computes nothing and compares
// nothing, so every key the verb prints is carried with its value and none is added. generated_at differs by the read and
// is left out. A reading's value can move between two reads (a measure's command counts what stands now), so the pair is
// read again, three times at most, before a difference is a break. Each read runs the measures' commands, which write
// nothing by the measure's own contract; the case changes nothing.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["rnd", "readings", "--json"], { cwd: os.homedir(), timeout: 50000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

function canon(value) {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? "<absent>" : value);
}

function picture(doc) {
  const keys = Object.keys(doc || {}).sort().join(",");
  const features = Array.isArray(doc && doc.features) ? doc.features.map(canon) : ["<features is not a list>"];
  return { keys, features };
}

function difference(a, b) {
  if (a.keys !== b.keys) return "top-level keys: route " + a.keys + ", command " + b.keys;
  if (a.features.length !== b.features.length) return "route " + a.features.length + " features, command " + b.features.length;
  const at = a.features.findIndex((f, i) => f !== b.features[i]);
  return "feature " + at + ": route " + String(a.features[at]).slice(0, 220) + " | command " + String(b.features[at]).slice(0, 220);
}

runCase(async () => {
  const list = await api("/api/analytics");
  if (list.status !== 200) return broken("GET /api/analytics answered " + list.status + ": " + String(list.text || "").slice(0, 160));
  const ids = ((list.json && (list.json.sections || (list.json.data && list.json.data.sections))) || []).map((s) => s && s.id);
  if (ids[ids.length - 1] !== "rnd") return broken("GET /api/analytics lists " + JSON.stringify(ids) + ": rnd is not its last section");
  let last = "";
  for (let turn = 0; turn < 3; turn += 1) {
    const r = await api("/api/analytics/rnd");
    if (r.status !== 200) return broken("GET /api/analytics/rnd answered " + r.status + ": " + String(r.text || "").slice(0, 200));
    const envelope = r.json && r.json.data && typeof r.json.data === "object" && "section" in r.json.data ? r.json.data : r.json;
    if (!envelope || envelope.section !== "rnd") return broken("the route's envelope does not name section rnd: " + String(r.text || "").slice(0, 160));
    const data = envelope.data;
    if (!data || typeof data !== "object" || typeof data.generated_at !== "string") return broken("the route answered 200 with no readings document in its envelope");
    const v = await verb();
    if (v.error) return cannotRun("dispatcher rnd readings --json did not answer: " + v.error);
    const a = picture(data);
    const b = picture(v.data);
    if (JSON.stringify(a) === JSON.stringify(b)) {
      const states = data.features.map((f) => f.state);
      return held("rnd listed last of " + ids.length + " sections; route and verb agree on " + data.features.length + " feature(s) key for key (states " + JSON.stringify(states) + ", top keys " + a.keys + ")");
    }
    last = difference(a, b);
  }
  return broken("three reads in a row, the route and dispatcher rnd readings disagree: " + last);
});
