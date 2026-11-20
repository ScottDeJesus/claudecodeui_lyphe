// `dispatcher hunt config` is the one writer of charters/hunts.toml. Over the seam's file it reads the globals the
// seam ships (and `scripts/hunt config --json`, the hunters' wrapper, reads the same); each bad write is ONE line
// `REFUSED hunt config: <reason>` at exit 2 with the file byte-identical; and a good write rewrites the file whole
// under its header, keeping every other key and every project block with its databases. Run against a scratch
// hunts.toml (HUNTS_CONFIG_PATH), a scratch registry (DATABASE_PATH) and a scratch tab, never the operator's.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_config.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/scripts/hunt
// writes: none

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { said } from "../lib/bug_house.mjs";
import {
  KINDS, PROJECTS, configJson, hunt, huntHouse, huntScript, liveCrontab, nightLines, parseJson, projectNames, refusals, toml,
} from "../lib/hunt_house.mjs";

const SAME = (a, b) => JSON.stringify(a) === JSON.stringify(b);

runCase(async (t) => {
  const house = await huntHouse(t, "hunt-config");
  const crontabBefore = await liveCrontab();
  const wrong = [];

  const first = await hunt(house, ["config", "--json"]);
  const read = parseJson(first);
  if (!read) return broken(`dispatcher hunt config --json printed no JSON — ${said(first)}`);
  const want = { nightly: false, start: "00:30", minutes: 120, order: KINDS, turns: "project" };
  for (const [key, value] of Object.entries(want)) {
    if (!SAME(read[key], value)) wrong.push(`--json read ${key} ${JSON.stringify(read[key])}, not ${JSON.stringify(value)}`);
  }
  if (!SAME(projectNames(read), PROJECTS)) wrong.push(`--json read the projects ${JSON.stringify(projectNames(read))}, not the file's four in order`);
  const wrapper = parseJson(await huntScript(house, ["config", "--json"]));
  if (!SAME(wrapper, read)) wrong.push(`scripts/hunt config --json answered ${JSON.stringify(wrapper)?.slice(0, 120)}, not what dispatcher hunt config --json did`);

  const bad = [
    ["--minutes", "14"], ["--minutes", "601"], ["--order", "security,security"], ["--order", "security,style"],
    ["--turns", "weekly"], ["--start", "25:00"], ["--projects", "CloudCLI,The house,Restorly app,Nowhere"],
    ["--projects", "CloudCLI,The house,Restorly app"],
  ];
  for (const args of bad) {
    const before = fs.readFileSync(house.config);
    const ran = await hunt(house, ["config", ...args, "--tabfile", house.tab]);
    const lines = refusals(ran);
    if (ran.code !== 2 || lines.length !== 1 || !lines[0].startsWith("REFUSED hunt config: ")) {
      wrong.push(`${args.join(" ")} exited ${ran.code} saying ${JSON.stringify(lines)}, not one REFUSED hunt config: line at exit 2`);
    }
    if (!fs.readFileSync(house.config).equals(before)) wrong.push(`${args.join(" ")} changed hunts.toml`);
  }

  const reordered = ["CloudCLI", "The house", "Restorly connector", "Restorly app"];
  const wrote = await hunt(house, ["config", "--order", "", "--projects", reordered.join(","), "--minutes", "90", "--start", "01:00", "--tabfile", house.tab]);
  if (wrote.code !== 0) wrong.push(`an empty --order with a --projects reorder was refused — ${said(wrote)}`);
  const after = await configJson(house);
  if (!SAME(after?.order, [])) wrong.push(`after --order '' the order reads ${JSON.stringify(after?.order)}, not []`);
  if (!SAME(projectNames(after), reordered)) wrong.push(`after the reorder the projects read ${JSON.stringify(projectNames(after))}`);
  if (after?.minutes !== 90 || after?.start !== "01:00" || after?.nightly !== false || after?.turns !== "project") {
    wrong.push(`after the write the globals read ${JSON.stringify({ minutes: after?.minutes, start: after?.start, nightly: after?.nightly, turns: after?.turns })}`);
  }
  if (nightLines(house.tab).length !== 0) wrong.push("a --start written while nightly is off put a night line in the tab");

  const text = fs.readFileSync(house.config, "utf8");
  if (!/^#.*dispatcher hunt config/m.test(text.split("\n").slice(0, 6).join("\n"))) wrong.push("the rewritten file's header no longer names `dispatcher hunt config` as its one writer");
  const file = await toml(house.config);
  if (!file) wrong.push("the rewritten hunts.toml is not TOML");
  else {
    for (const [key, value] of Object.entries({ grace: 15, min_left: 20, tickets_per_night: 15, batch: 12 })) {
      if (file[key] !== value) wrong.push(`the write lost ${key} (reads ${JSON.stringify(file[key])})`);
    }
    if (!SAME(file.lens?.ui?.include, ["**/*.tsx", "**/*.jsx", "**/*.css", "**/*.html"])) wrong.push("the write lost [lens.ui] include");
    if (!Array.isArray(file.exclude) || file.exclude.length !== 15) wrong.push(`the write left exclude as ${JSON.stringify(file.exclude)}`);
    const byName = Object.fromEntries((file.project ?? []).map((p) => [p.name, p]));
    if (byName["Restorly connector"]?.database?.[0]?.env_file !== "/opt/shadow-connector/.env"
        || !SAME(byName["Restorly connector"]?.exclude, ["installation_guides/**"])) wrong.push("the write lost the Restorly connector's exclude or its postgres row");
    if (byName.CloudCLI?.database?.[0]?.path !== "/home/lyphe/.cloudcli/auth.db") wrong.push("the write lost CloudCLI's board database row");
    if (byName["The house"]?.database?.[0]?.name !== "dispatcher" || byName["Restorly app"]?.path !== "/opt/eis-app") wrong.push("the write lost The house's database row or the Restorly app's path");
  }

  if ((await liveCrontab()) !== crontabBefore) wrong.push("THE OPERATOR'S CRONTAB CHANGED during the case");
  if (wrong.length) return broken(wrong.join("; "));
  return held("the seam's globals and four projects read through both doors; eight bad writes each one REFUSED line at exit 2 with the file untouched; an empty order, a project reorder, minutes and start written with the header, keys, lens and database rows kept and no line in the tab");
});
