// hunt_brief_house.mjs — a scratch home for `dispatcher hunt brief HUNT PROJECT`: the hunt map's scratch home and
// config, a made store, a scratch launch table, the live rulebook read as its own sections, and a digest of every
// row the hunt and proposal lines hold.
//
//   import { briefHouse, brief, snapshot, rulebook, RULEBOOK } from "../lib/hunt_brief_house.mjs";
//   const house = await briefHouse(t, "brief", [{ name: "Outer", path: "<scratch>/outer" }], { code: "daedalus" });
//   const ran = await brief(house, "code", "Outer");         // { code, out, err }
//   const before = await snapshot(house);                     // JSON text of every hunt, proposal and ticket row
//   const book = rulebook();                                  // { common, lenses: { security, … } } or { fault }
//
// EVERY PATH IS SCRATCH but the rulebook: DISPATCHER_HOME, HUNTS_CONFIG_PATH and LAUNCH_TABLE_PATH name files under
// the case's own folder. The rulebook is the live charters/HUNTING.md, READ only, split here by its own
// `## <kind>` headings so a case judges the brief against the file and never against the brief module's own split.

import fs from "node:fs";
import path from "node:path";

import { dispatcher, rows } from "./bug_house.mjs";
import { mapHouse, py } from "./hunt_map_house.mjs";

export const RULEBOOK = "/home/lyphe/.claude/charters/HUNTING.md";
export const KINDS = ["security", "behaviour", "ui", "data", "code"];

const TABLES = ["hunt_nights", "hunt_passes", "hunt_sittings", "hunt_units", "proposals", "proposal_findings", "tickets"];

/** A whole launch table (one the reader takes without falling back to the shipped one) with a hunt row per kind in `souls`. */
function launchTable(souls) {
  let text = `version = 1\n\n[default]\nmodel = "sonnet"\n\n[default.effort]\nopus = "medium"\nfable = "high"\nsonnet = "high"\n\n[deepseek]\neffort = "max"\n\n[sorter]\nmodel = "claude-haiku-5-5"\neffort = "low"\n\n[tweak]\nmodel = "opus"\n`;
  for (const [kind, soul] of Object.entries(souls)) text += `\n[hunt.${kind}]\nsoul = "${soul}"\n`;
  return text;
}

/** mapHouse's scratch home naming `projects` (their folders made), its store made, and a scratch launch table. */
export async function briefHouse(t, label, projects, souls = {}) {
  const house = await mapHouse(t, label, projects);
  for (const p of projects) fs.mkdirSync(p.path, { recursive: true });
  house.launch = path.join(house.dir, "launch.toml");
  fs.writeFileSync(house.launch, launchTable(souls));
  house.env.LAUNCH_TABLE_PATH = house.launch;
  const made = await py(house, "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (made.code !== 0) throw new Error(`the scratch store could not be made: ${(made.err || made.out).trim().split("\n").pop()}`);
  return house;
}

/** `dispatcher hunt brief <kind> <project>` in the scratch home. */
export function brief(house, kind, project) {
  return dispatcher(house, ["hunt", "brief", kind, project]);
}

/** Every row of the hunt, proposal and ticket tables, as one JSON text: equal texts mean nothing was written. */
export async function snapshot(house) {
  const all = {};
  for (const table of TABLES) all[table] = await rows(house, `SELECT * FROM ${table} ORDER BY rowid`);
  return JSON.stringify(all);
}

/** The live rulebook's common part (above its first lens heading) and each lens's section, heading included. */
export function rulebook(file = RULEBOOK) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (error) { return { fault: `${file} cannot be read: ${error.message}` }; }
  const lines = text.split("\n");
  const heading = (line) => KINDS.find((k) => line.trimEnd() === `## ${k}`);
  const first = lines.findIndex((l) => heading(l));
  if (first < 0) return { fault: `${file} holds no "## <kind>" heading`, text };
  const lenses = {};
  const order = [];
  let kind = null;
  let body = [];
  const close = () => { if (kind) lenses[kind] = (lenses[kind] ?? "") + body.join("\n").trim(); };
  for (const line of lines.slice(first)) {
    if (line.startsWith("## ")) {
      close();
      kind = heading(line) ?? null;
      if (kind) order.push(kind);
      body = [];
    }
    if (kind) body.push(line);
  }
  close();
  return { common: lines.slice(0, first).join("\n").trim(), lenses, order, text };
}

/** The bullet and text lines of `section` that appear nowhere in `others` — the lines only that section says. */
export function ownLines(section, others) {
  const elsewhere = new Set(others.join("\n").split("\n").map((l) => l.trim()));
  return section.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !elsewhere.has(l));
}
