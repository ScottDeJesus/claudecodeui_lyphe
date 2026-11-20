// `dispatcher hunt brief HUNT PROJECT` ends with the project's open proposals (id, title), so a finding can join one.
// A proposal belongs to the project whose folder holds its path, and a path under another listed project's folder
// belongs to that inner project (as the live config's CloudCLI sits inside The house). The scratch store holds four
// proposals: open under Outer, open under Inner (a folder inside Outer), dismissed under Outer, open outside both.
// Outer's brief names the first by its id and its title and none of the other three; Inner's names Inner's alone.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_brief.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/hunt_config.py
// writes: none

import path from "node:path";

import { exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { brief, briefHouse } from "../lib/hunt_brief_house.mjs";
import { setProjects } from "../lib/hunt_map_house.mjs";

const TITLES = {
  1: "Outer keeps its retries in three places",
  2: "Inner's cache has no owner",
  3: "Outer's old idea that was dismissed",
  4: "A folder no project names",
};

runCase(async (t) => {
  const house = await briefHouse(t, "hunt-brief-proposals", [], {});
  const outer = path.join(house.dir, "outer");
  const inner = path.join(outer, "inner");
  setProjects(house, [{ name: "Outer", path: outer }, { name: "Inner", path: inner }]);
  const paths = { 1: path.join(outer, "src"), 2: path.join(inner, "lib"), 3: outer, 4: path.join(house.dir, "elsewhere") };
  const states = { 1: "open", 2: "open", 3: "dismissed", 4: "open" };
  for (const id of [1, 2, 3, 4]) {
    await exec(house, "INSERT INTO proposals (id, path, title, words, kind, priority, state, reporter, hunt, proposed_at, reason) VALUES (?, ?, ?, 'words', 'design', 'medium', ?, '{}', 'security', ?, ?)",
      [id, paths[id], TITLES[id], states[id], `2026-11-1${id}T00:00:00Z`, states[id] === "dismissed" ? "not now" : null]);
  }
  const wrong = [];
  const listed = (out, id) => out.split("\n").some((l) => l.includes(TITLES[id]) && new RegExp(`\\b${id}\\b`).test(l.replace(TITLES[id], "")));
  const named = (out, id) => out.includes(TITLES[id]);
  for (const [name, own] of [["Outer", 1], ["Inner", 2]]) {
    const ran = await brief(house, "security", name);
    if (ran.code !== 0) { wrong.push(`hunt brief security ${name} answered ${said(ran)}`); continue; }
    if (!listed(ran.out, own)) wrong.push(`${name}'s brief does not list proposal ${own} by its id and title`);
    const strays = [1, 2, 3, 4].filter((id) => id !== own && named(ran.out, id));
    if (strays.length) wrong.push(`${name}'s brief names proposal(s) ${strays.join(", ")}: ${strays.map((id) => `"${TITLES[id]}"`).join(", ")}`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("Outer's brief lists proposal 1 by id and title and not Inner's, the dismissed or the outside one; Inner's lists proposal 2 alone");
});
