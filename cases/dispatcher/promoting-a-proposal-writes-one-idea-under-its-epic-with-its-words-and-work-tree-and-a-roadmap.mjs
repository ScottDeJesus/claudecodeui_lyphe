// Promoting a proposal is the operator's door from the bug hunters to the roadmap (INV-6570): ONE act that calls the
// roadmap's own `add_plan` under the epic he names, making an IDEA titled as the proposal, whose goal is its words,
// its findings and a last line `From the bug hunters' proposed feature "<title>".`, and whose repo is the git work tree
// of the proposal's folder (not the folder itself); the proposal reads promoted with that feature. `bug proposals`
// reads the feature's state from `plans` at each read, so a feature moved on the roadmap is seen moved. A refusal of
// the roadmap's is passed on in its own words, and then neither the idea nor the proposal's ending is written.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_propose.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/store_roadmap.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, dispatcher, lines, rows, said } from "../lib/bug_house.mjs";

const TITLE = "One state for a ticket";

async function feature(house) {
  const ran = await bug(house, ["proposals", "--all", "--json"]);
  try {
    return JSON.parse(ran.out).proposals.find((p) => p.id === 1)?.feature;
  } catch {
    return undefined;
  }
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-promote");
  const wrong = [];
  for (const args of [["add", "roadmap", "case-rm", "--title", "Case roadmap"],
    ["add", "milestone", "case-ms", "--roadmap", "case-rm", "--title", "Case milestone"],
    ["add", "arc", "case-epic", "--milestone", "case-ms", "--title", "The case epic"]]) {
    const ran = await dispatcher(house, ["roadmap", ...args, "--by", "cli"]);
    if (ran.code !== 0) return broken(`dispatcher roadmap ${args.slice(0, 3).join(" ")} failed — ${said(ran)}`);
  }
  const sub = path.join(house.repo, "deep", "folder");
  fs.mkdirSync(sub, { recursive: true });
  const made = await bug(house, ["propose", "--title", TITLE, "--kind", "design", "--path", sub], { input: "The two stores disagree." });
  const joined = await bug(house, ["propose", "--join", "1", "--unit", "store_tickets.py"], { input: "Seen again in the settle." });
  if (made.code !== 0 || joined.code !== 0) return broken(`bug propose or --join failed — ${said(made)} / ${said(joined)}`);

  // the roadmap's own sentence for an epic that does not exist, said by its own verb
  const own = await dispatcher(house, ["roadmap", "add", "plan", "case-probe", "--arc", "no-such-epic", "--title", "X", "--repo", house.repo, "--by", "cli"]);
  const ownWords = lines(own).at(-1) ?? "";
  const refused = await bug(house, ["proposal", "promote", "1", "--arc", "no-such-epic"]);
  const r1 = lines(refused);
  if (refused.code !== 2 || r1.length !== 1 || r1[0] !== `REFUSED bug proposal promote: ${ownWords}`) {
    wrong.push(`promote to an unknown epic did not pass on the roadmap's "${ownWords}" — ${said(refused)}`);
  }
  if ((await rows(house, "SELECT count(*) AS n FROM plans"))[0].n !== 0) wrong.push("a refused promotion wrote a plans row");
  if ((await rows(house, "SELECT state FROM proposals WHERE id = 1"))[0].state !== "open") wrong.push("a refused promotion ended the proposal");

  const promoted = await bug(house, ["proposal", "promote", "1", "--arc", "case-epic"]);
  const want = `PROMOTED proposal 1 — ${TITLE} — an idea under The case epic`;
  if (promoted.code !== 0 || promoted.out.trim() !== want) return broken(`promote did not print ${want} — ${said(promoted)}`);
  const plans = await rows(house, "SELECT p.*, a.name AS arc FROM plans p JOIN arcs a ON a.id = p.arc_id");
  if (plans.length !== 1) return broken(`the promotion wrote ${plans.length} plans rows, not 1`);
  const [plan] = plans;
  const [prop] = await rows(house, "SELECT * FROM proposals WHERE id = 1");
  if (plan.arc !== "case-epic" || plan.state !== "idea" || plan.title !== TITLE) wrong.push(`the plan is ${plan.state} "${plan.title}" under ${plan.arc}, not an idea "${TITLE}" under case-epic`);
  if (plan.repo !== house.repo) wrong.push(`the plan's repo is ${plan.repo}, not the git work tree ${house.repo} of the proposal's folder ${sub}`);
  const goal = String(plan.goal ?? "");
  for (const part of ["The two stores disagree.", "Seen again in the settle."]) if (!goal.includes(part)) wrong.push(`the goal does not hold "${part}"`);
  const last = goal.trimEnd().split("\n").at(-1);
  if (last !== `From the bug hunters' proposed feature "${TITLE}".`) wrong.push(`the goal's last line is ${JSON.stringify(last)}`);
  if (prop.state !== "promoted" || prop.feature !== plan.name || !prop.ended_at) wrong.push(`the proposal reads ${prop.state}, feature ${prop.feature}, ended_at ${prop.ended_at} (plan ${plan.name})`);

  const f1 = await feature(house);
  if (JSON.stringify(f1) !== JSON.stringify({ name: plan.name, title: TITLE, state: "idea" })) wrong.push(`bug proposals reads feature ${JSON.stringify(f1)}`);
  const moved = await dispatcher(house, ["roadmap", "propose", plan.name, "--by", "cli"]);
  if (moved.code !== 0) wrong.push(`dispatcher roadmap propose ${plan.name} failed — ${said(moved)}`);
  else if ((await feature(house))?.state !== "proposed") wrong.push(`after the roadmap moved the feature to proposed, bug proposals still reads ${JSON.stringify(await feature(house))}`);

  const again = await bug(house, ["proposal", "promote", "1", "--arc", "case-epic"]);
  if (again.code !== 2 || lines(again).join("|") !== `REFUSED bug proposal promote: "${TITLE}" is already promoted`) wrong.push(`a second promote was not refused by name — ${said(again)}`);
  if ((await rows(house, "SELECT count(*) AS n FROM plans"))[0].n !== 1) wrong.push("a second promote wrote another plan");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`promote wrote one idea ${plan.name} under The case epic with the words, the finding and the last line, repo the work tree and not the subfolder; the proposal read promoted; bug proposals followed the feature from idea to proposed; the roadmap's "${ownWords}" was passed on writing nothing; a second promote was refused by name`);
});
