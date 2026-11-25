// An R&D candidate walks the whole joined line on a scratch dispatcher home: filed in the scout's object, spiked, proved
// and adopted under an epic (INV-6570: adoption is store.add_plan under the epic he names). Its word is derived at the read,
// the roadmap carries the idea and the candidates standing, and the design brief of the new feature carries the R&D lines
// roadmap_brief._feature takes from rnd_report.brief_lines.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/rnd.py, /home/lyphe/.claude/hooks/dispatcher/rnd_acts.py, /home/lyphe/.claude/hooks/dispatcher/rnd_acts_life.py, /home/lyphe/.claude/hooks/dispatcher/store_rnd.py, /home/lyphe/.claude/hooks/dispatcher/rnd_report.py, /home/lyphe/.claude/hooks/dispatcher/report_roadmap.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_brief.py, /home/lyphe/.claude/hooks/dispatcher/shapes.py
// writes: none

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { DISPATCHER, bugHouse, rows } from "../lib/bug_house.mjs";

const TITLE = "A loop that names its slowest query";
const WHAT = "A Claude loop reads each query's rows scanned against rows returned and rewrites the worst.";
const WHY = "No standing signal ties a query to its scan-to-return ratio here.";
const QUESTION = "Does the ratio name one live query scanning 100 times what it returns?";
const SOURCE_URL = "https://example.com/case/rnd-joined-line";
const EVIDENCE = "Measured: the ranking named 2 queries over 100 to 1.";
const GOAL = "Rank the live queries by rows scanned over rows returned.";
const MEASURE_LINE = "Measure: this feature came from R&D, so its design names how its doing is measured — one [measure] table (~/.claude/scripts/dispatcher shapes measure prints it), its baseline the spike's own number from the evidence above. dispatcher load refuses the design without it, and Analytics → R&D draws its row. Where the evidence holds no number to stand on, that is a question for the operator. Give the feature its own Analytics tab as well when it has more to show than one number, and name it in section.";

function run(house, args, input) {
  const env = Object.assign({}, house.env);
  delete env.RND_SCOUT;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(DISPATCHER, args, { env: env, cwd: house.dir, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, out: "", err: String(error && error.message) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, out: out, err: err + error.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code, out: out, err: err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}
const said = (ran) => "exit " + ran.code + ": " + ((ran.out + ran.err).trim().replace(/\s+/g, " ").slice(0, 240) || "(nothing printed)");
function json(ran) {
  try { return JSON.parse(ran.out); } catch (e) { return null; }
}

/** dispatcher design <plan>, then the brief it composed: the newest planners row names its file. */
async function designBrief(house, plan) {
  const designed = await run(house, ["design", plan]);
  if (designed.code !== 0) return { error: "dispatcher design " + plan + " failed — " + said(designed) };
  let row;
  try {
    row = (await rows(house, "SELECT * FROM planners ORDER BY id DESC LIMIT 1"))[0];
  } catch (error) {
    return { error: "dispatcher design " + plan + " answered (" + said(designed) + ") but no planners row could be read — " + String(error.message) };
  }
  const file = row && Object.values(row).find((v) => typeof v === "string" && v.startsWith("/") && fs.existsSync(v) && fs.statSync(v).isFile());
  if (!file) return { error: "dispatcher design " + plan + " queued " + JSON.stringify(row).slice(0, 200) + " naming no brief file" };
  return { text: fs.readFileSync(file, "utf8"), file: file };
}

runCase(async (t) => {
  const house = await bugHouse(t, "rnd-joined");
  const wrong = [];
  for (const args of [["add", "roadmap", "case-rm", "--title", "Case roadmap"],
    ["add", "milestone", "case-ms", "--roadmap", "case-rm", "--title", "Case milestone"],
    ["add", "arc", "case-epic", "--milestone", "case-ms", "--title", "The case epic"]]) {
    const ran = await run(house, ["roadmap"].concat(args, ["--by", "cli"]));
    if (ran.code !== 0) return broken("dispatcher roadmap " + args.slice(0, 3).join(" ") + " failed — " + said(ran));
  }
  const filing = JSON.stringify({ title: TITLE, what: WHAT, why: WHY, question: QUESTION, source_url: SOURCE_URL, source: "https://example.com/case" });
  const filed = await run(house, ["rnd", "file", "-"], filing);
  const fm = filed.out.match(/^FILED candidate (\S+)\s*$/m);
  if (filed.code !== 0 || !fm) return broken("rnd file - did not print FILED candidate <name> — " + said(filed));
  const name = fm[1];
  const spiked = await run(house, ["rnd", "spike", name, "--session", "case-spike-session"]);
  if (spiked.code !== 0 || spiked.out.indexOf("SPIKING candidate " + name) === -1) return broken("rnd spike " + name + " — " + said(spiked));
  const dir = path.join(house.dir, "spikes", name);
  fs.mkdirSync(dir, { recursive: true });
  const verdict = await run(house, ["rnd", "verdict", name, "yes", "--dir=" + dir, "--evidence", "-"], EVIDENCE + "\n");
  if (verdict.code !== 0 || verdict.out.indexOf("VERDICT candidate " + name + " — yes") === -1) return broken("rnd verdict " + name + " yes — " + said(verdict));
  const adopted = await run(house, ["rnd", "adopt", name, "--arc", "case-epic", "--repo", house.repo, "--goal=" + GOAL]);
  const am = adopted.out.match(/^ADOPTED candidate (\S+) — idea (\S+) under /m);
  if (adopted.code !== 0 || !am) return broken("rnd adopt " + name + " --arc case-epic --goal=<words> did not print ADOPTED candidate … — idea <plan> under … — " + said(adopted));
  const plan = am[2];

  const plans = await rows(house, "SELECT p.name, p.state, p.title, p.goal, a.name AS arc FROM plans p JOIN arcs a ON a.id = p.arc_id");
  if (plans.length !== 1 || plans[0].name !== plan || plans[0].state !== "idea" || plans[0].arc !== "case-epic" || plans[0].title !== TITLE || String(plans[0].goal || "").trim() !== GOAL) {
    wrong.push("the plans table holds " + JSON.stringify(plans) + ", not one idea " + plan + " titled as the candidate, goal his words, under case-epic");
  }

  const shown = json(await run(house, ["rnd", "show", "--json"]));
  const one = shown && (shown.candidates || []).find((c) => c.name === name);
  if (!one) wrong.push("rnd show --json holds no candidate " + name);
  else {
    if (one.word !== "adopted") wrong.push("rnd show reads the candidate " + one.word + ", not adopted");
    if (!one.adopted || one.adopted.plan !== plan || ["case-epic", "The case epic"].indexOf(one.adopted.epic) === -1) wrong.push("rnd show's adopted is " + JSON.stringify(one.adopted));
    else if (one.adopted.word !== "idea") wrong.push("rnd show's adopted.word is " + one.adopted.word + ", not idea");
    if (!one.verdict || one.verdict.word !== "yes" || one.verdict.dir !== dir) wrong.push("rnd show's verdict is " + JSON.stringify(one.verdict));
  }
  const st = shown && shown.standing;
  if (!st || st.waiting !== 0 || st.spiking !== 0 || st.proved !== 0 || st.adopted !== 1 || st.rejected !== 0) wrong.push("rnd show's standing is " + JSON.stringify(st));

  const rm = await run(house, ["roadmap", "show", "--json"]);
  const doc = json(rm);
  const c = doc && doc.candidates;
  if (!c) wrong.push("roadmap show --json carries no candidates key — " + said(rm));
  else if ([c.waiting, c.spiking, c.proved, c.rejected].join(",") !== "0,0,0,0") wrong.push("roadmap show's candidates is " + JSON.stringify(c));
  if (rm.out.indexOf('"' + plan + '"') === -1) wrong.push("roadmap show --json does not carry the plan " + plan);
  const face = await run(house, ["roadmap", "show"]);
  if (!/dispatcher rnd show/.test(face.out)) wrong.push("roadmap show's text face prints no line naming dispatcher rnd show");

  const brief = await designBrief(house, plan);
  if (brief.error) wrong.push(brief.error);
  else {
    const want = [GOAL, "From R&D: " + TITLE + " — " + SOURCE_URL, "What it is: " + WHAT, "Why it might help: " + WHY,
      "Spike: " + QUESTION + " — yes, ", "Evidence: " + EVIDENCE, "Spike directory: " + dir, MEASURE_LINE];
    const missing = want.filter((line) => brief.text.indexOf(line) === -1);
    if (missing.length) wrong.push("the design brief " + brief.file + " lacks " + JSON.stringify(missing));
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("filed " + name + ", spiked, proved and adopted as idea " + plan + " under case-epic; rnd show reads adopted/idea with standing adopted 1; roadmap show carries the idea, candidates 0/0/0/0 and the rnd show line; dispatcher design's brief carries his goal and the seven R&D lines, the Measure line last");
});
