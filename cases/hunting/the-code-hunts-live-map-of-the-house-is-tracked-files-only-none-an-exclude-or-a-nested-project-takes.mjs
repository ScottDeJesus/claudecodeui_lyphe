// The code hunter's turn over The house can be taken on this box: its live map answers, and it hands only what a
// hunter should open. `dispatcher hunt map code "The house" --json` must exit 0 `mapped` with a total equal to its
// units and more than none; each unit is a regular file git tracks in ~/.claude (no symlink, no submodule); none is a
// path an exclude of the file or of the project takes (judged here by the globs' plain meaning, not by the reader's
// matcher); and none lies inside another listed project's folder, since such a file is that project's. The map writes
// nothing: the live store's hunt rows are the same before and after (unless a night is out and writing them itself).
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_map.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/charters/hunts.toml
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { HOME_CLAUDE, LIVE_STORE, liveHunt, liveRows, parseJson, run, said } from "../lib/hunting_live.mjs";

const PROJECT = "The house";

/** A glob's plain meaning: `**\/` any leading folders (or none), `/**` anything under, `*` within one segment. */
function globRegex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith("**/", i)) { out += "(?:.*/)?"; i += 2; }
    else if (glob.startsWith("/**", i) && i + 3 === glob.length) { out += "/.*"; i += 2; }
    else if (glob[i] === "*") out += "[^/]*";
    else if (glob[i] === "?") out += "[^/]";
    else out += glob[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const huntRows = () => liveRows(LIVE_STORE,
  "SELECT (SELECT count(*) FROM hunt_passes) AS passes, (SELECT count(*) FROM hunt_units) AS units, " +
  "(SELECT count(*) FROM hunt_sittings) AS sittings, (SELECT count(*) FROM hunt_sittings WHERE state = 'out') AS out");

runCase(async () => {
  const cfgRan = await liveHunt(["config", "--json"]);
  const config = parseJson(cfgRan);
  if (config === null) return cannotRun(`dispatcher hunt config --json did not answer — ${said(cfgRan)}`);
  const house = (config.projects ?? []).find((p) => p.name === PROJECT);
  if (!house) return cannotRun(`the live hunts.toml names no project "${PROJECT}"`);

  const before = (await huntRows())[0];
  const ran = await liveHunt(["map", "code", PROJECT, "--json"]);
  const after = (await huntRows())[0];
  const map = parseJson(ran);
  if (ran.code !== 0 || map === null) return broken(`hunt map code "${PROJECT}" exited ${ran.code} — ${said(ran)}`);

  const wrong = [];
  const units = (map.units ?? []).map((u) => u.unit);
  if (map.state !== "mapped") wrong.push(`the map's state reads ${JSON.stringify(map.state)}, not mapped`);
  if (units.length === 0 || map.total !== units.length) wrong.push(`the map's total reads ${map.total} over ${units.length} units`);

  const ls = await run("git", ["-C", house.path, "ls-files", "-s", "-z"]);
  if (ls.code !== 0) return cannotRun(`git ls-files in ${house.path} failed — ${said(ls)}`);
  const regular = new Set();
  for (const entry of ls.out.split("\0").filter(Boolean)) {
    const [meta, file] = entry.split("\t");
    if (meta.startsWith("100")) regular.add(file);
  }
  const untracked = units.filter((u) => !regular.has(u));
  if (untracked.length) wrong.push(`${untracked.length} units are not regular tracked files: ${untracked.slice(0, 5).join(", ")}`);

  const globs = [...(config.exclude ?? []), ...(house.exclude ?? [])];
  const taken = units.flatMap((u) => globs.filter((g) => globRegex(g).test(u)).map((g) => `${u} (${g})`));
  if (taken.length) wrong.push(`${taken.length} units an exclude takes: ${taken.slice(0, 5).join(", ")}`);

  const nested = (config.projects ?? []).filter((p) => p.name !== PROJECT && p.path.startsWith(`${house.path}/`))
    .map((p) => `${p.path.slice(house.path.length + 1)}/`);
  const others = units.filter((u) => nested.some((n) => u.startsWith(n)));
  if (others.length) wrong.push(`${others.length} units belong to a nested project (${nested.join(", ")}): ${others.slice(0, 5).join(", ")}`);

  if (before.out === 0 && after.out === 0 && JSON.stringify(before) !== JSON.stringify(after)) {
    wrong.push(`hunt map wrote the live store: hunt rows ${JSON.stringify(before)} before, ${JSON.stringify(after)} after`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held(`${units.length} tracked files mapped for the code hunt over ${HOME_CLAUDE}; none excluded, none of ${nested.join(", ") || "a nested project"}; the store unchanged`);
});
