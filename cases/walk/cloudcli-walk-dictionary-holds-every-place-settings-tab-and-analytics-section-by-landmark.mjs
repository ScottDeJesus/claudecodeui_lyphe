// CloudCLI's walk dictionary keeps pace with the app: a [screen.<name>] for each place PlaceId names (the last
// chat as `session`), `settings` and `settings-<tab>` for every SettingsMainTab, `analytics` and
// `analytics-<id>` for every row of ANALYTICS_SECTIONS, each with a landmark and none naming a thing by position.
// Read from the files themselves, so a new place, tab or section that lands without its entry breaks this.
//
// protects: walk/screens.toml, src/shared/types.ts, src/modules/analytics/sections/registry.ts
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const POSITION = /(^|[\s{,])(css|xpath|nth|index|x|y)\s*=/m;
const STRINGS = /"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/g;

function union(text, type) {
  const m = new RegExp(`export type ${type}\\s*=\\s*([^;]+);`).exec(text);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
}

/** Each [screen.<name>] of the dictionary: whether it has a landmark and which position keys it holds. */
function screensOf(text) {
  const screens = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line);
    if (header) {
      const segs = [...header[1].matchAll(/"([^"]*)"|([A-Za-z0-9_-]+)/g)].map((s) => s[1] ?? s[2]);
      current = segs[0] === "screen" && segs[1] ? segs[1] : null;
      if (current && !screens.has(current)) screens.set(current, { landmark: false, positions: [] });
      if (current && segs[2] === "landmark") screens.get(current).landmark = true;
      continue;
    }
    if (!current) continue;
    const entry = screens.get(current);
    if (/^\s*landmark\s*=/.test(line)) entry.landmark = true;
    const hit = POSITION.exec(line.replace(STRINGS, '""'));
    if (hit) entry.positions.push(hit[2]);
  }
  return screens;
}

runCase(async () => {
  const types = read("src/shared/types.ts");
  const places = union(types, "PlaceId");
  const tabs = union(types, "SettingsMainTab");
  const registry = read("src/modules/analytics/sections/registry.ts");
  const at = registry.indexOf("ANALYTICS_SECTIONS");
  const sections = at < 0 ? [] : [...registry.slice(at).matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
  if (!places || !tabs || sections.length === 0) return cannotRun("PlaceId, SettingsMainTab or ANALYTICS_SECTIONS could not be read from the source");
  if (!fs.existsSync(path.join(REPO, "walk", "screens.toml"))) return broken("walk/screens.toml is not on disk");
  const screens = screensOf(read("walk/screens.toml"));
  const wanted = [...new Set([
    ...places.map((p) => (p === "chat" ? "session" : p)),
    "settings", ...tabs.map((t) => `settings-${t}`),
    "analytics", ...sections.map((s) => `analytics-${s}`),
  ])];
  const missing = wanted.filter((n) => !screens.has(n));
  const blind = [...screens.entries()].filter(([, s]) => !s.landmark).map(([n]) => n);
  const placed = [...screens.entries()].filter(([, s]) => s.positions.length).map(([n, s]) => `${n} (${s.positions.join(",")})`);
  const wrong = [];
  if (missing.length) wrong.push(`no entry for ${missing.join(", ")}`);
  if (blind.length) wrong.push(`no landmark: ${blind.join(", ")}`);
  if (placed.length) wrong.push(`named by position: ${placed.join(", ")}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`${wanted.length} screens the source names (${places.length} places, ${tabs.length} settings tabs, ${sections.length} analytics sections) each have a landmarked entry; ${screens.size} entries, none by position`);
});
