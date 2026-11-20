// `bug proposals --json` is what CloudCLI's Proposed features face reads, so its shape is seam 8's verbatim: one
// `proposals` list, each proposal exactly sixteen keys, each finding three and each stopgap five. It lists the open
// proposals only unless `--all`, high priority first and then the oldest, so a priority raised by
// `bug proposal priority` moves the proposal at the next read.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/shapes.py, /home/lyphe/.claude/hooks/dispatcher/bug_propose.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, exec, said } from "../lib/bug_house.mjs";

const PROPOSAL = ["id", "path", "title", "words", "kind", "priority", "state", "hunt", "source", "proposed_at",
  "ended_at", "feature", "reason", "findings", "stopgaps", "sent_back"].sort().join(",");
const FINDING = ["unit", "words", "found_at"].sort().join(",");

async function read(house, all) {
  const ran = await bug(house, ["proposals", ...(all ? ["--all"] : []), "--json"]);
  if (ran.code !== 0) return { error: `bug proposals${all ? " --all" : ""} --json failed — ${said(ran)}` };
  try {
    const body = JSON.parse(ran.out);
    if (!body || !Array.isArray(body.proposals) || Object.keys(body).join(",") !== "proposals") {
      return { error: `the answer is not {"proposals": [...]}: ${ran.out.slice(0, 200)}` };
    }
    return { list: body.proposals };
  } catch {
    return { error: `the answer is not JSON: ${ran.out.slice(0, 200)}` };
  }
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-proposals");
  const wrong = [];
  const filed = [["Oldest medium", "medium"], ["Older low", "low"], ["Newer high", "high"], ["Dismissed one", "high"]];
  for (const [title, priority] of filed) {
    const ran = await bug(house, ["propose", "--title", title, "--kind", "too-big", "--priority", priority], { input: `words of ${title}` });
    if (ran.code !== 0) return broken(`bug propose --title ${title} failed — ${said(ran)}`);
  }
  // distinct ages, oldest first, so "then the oldest" is decided by the clock and never by a tie
  for (let id = 1; id <= 4; id += 1) {
    await exec(house, "UPDATE proposals SET proposed_at = ? WHERE id = ?", [`2026-11-1${id}T10:00:00Z`, id]);
  }
  const joined = await bug(house, ["propose", "--join", "1", "--unit", "a.py"], { input: "a sighting" });
  if (joined.code !== 0) wrong.push(`the join failed — ${said(joined)}`);
  const dismissed = await bug(house, ["proposal", "dismiss", "4", "--reason", "not worth a feature"]);
  if (dismissed.code !== 0) wrong.push(`bug proposal dismiss 4 failed — ${said(dismissed)}`);

  const open = await read(house, false);
  if (open.error) return broken(open.error);
  const titles = open.list.map((p) => p.title).join(" | ");
  if (titles !== "Newer high | Oldest medium | Older low") wrong.push(`open proposals read ${titles}, not Newer high | Oldest medium | Older low`);
  for (const p of open.list) {
    const keys = Object.keys(p).sort().join(",");
    if (keys !== PROPOSAL) wrong.push(`proposal "${p.title}" has the keys ${keys}, not seam 8's ${PROPOSAL}`);
    if (p.state !== "open" || p.feature !== null || p.sent_back !== null || p.ended_at !== null) {
      wrong.push(`open proposal "${p.title}" reads state ${p.state}, feature ${JSON.stringify(p.feature)}, sent_back ${JSON.stringify(p.sent_back)}, ended_at ${p.ended_at}`);
    }
    if (!Array.isArray(p.findings) || !Array.isArray(p.stopgaps)) wrong.push(`"${p.title}" findings or stopgaps is not a list`);
    if (p.source !== "chat") wrong.push(`"${p.title}" proposed from a chat reads source ${p.source}`);
    if (p.hunt !== null) wrong.push(`"${p.title}" proposed by no hunter reads hunt ${p.hunt}`);
  }
  const first = open.list.find((p) => p.title === "Oldest medium");
  const finding = first?.findings.find((f) => f.words === "a sighting");
  if (!finding) wrong.push(`the joined finding is not among "Oldest medium"'s findings: ${JSON.stringify(first?.findings)}`);
  else {
    if (Object.keys(finding).sort().join(",") !== FINDING) wrong.push(`a finding has the keys ${Object.keys(finding).sort()}, not ${FINDING}`);
    if (finding.unit !== "a.py") wrong.push(`the finding's unit reads ${finding.unit}`);
  }

  const raised = await bug(house, ["proposal", "priority", "2", "high"]);
  if (raised.code !== 0) wrong.push(`bug proposal priority 2 high failed — ${said(raised)}`);
  const after = await read(house, false);
  if (after.error) wrong.push(after.error);
  else {
    const order = after.list.map((p) => p.title).join(" | ");
    if (order !== "Older low | Newer high | Oldest medium") wrong.push(`after raising "Older low" to high the order is ${order}, not Older low | Newer high | Oldest medium`);
  }

  const every = await read(house, true);
  if (every.error) wrong.push(every.error);
  else {
    const gone = every.list.find((p) => p.title === "Dismissed one");
    if (!gone) wrong.push("--all does not hold the dismissed proposal");
    else if (gone.state !== "dismissed" || gone.reason !== "not worth a feature" || !gone.ended_at) {
      wrong.push(`the dismissed proposal reads state ${gone.state}, reason ${JSON.stringify(gone.reason)}, ended_at ${gone.ended_at}`);
    }
    if (every.list.length !== 4) wrong.push(`--all holds ${every.list.length} proposals, not 4`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("bug proposals --json listed the three open proposals only, high first then the oldest, each with seam 8's sixteen keys and its finding's three; a priority raised moved its proposal at the next read; --all added the dismissed one with its reason and ending");
});
