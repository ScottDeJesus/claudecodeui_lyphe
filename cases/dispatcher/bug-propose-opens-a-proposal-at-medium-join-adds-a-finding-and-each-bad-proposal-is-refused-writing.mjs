// `bug propose` is the bug hunters' second door, beside `bug file`: a rework too big for one ticket, or a design that
// is wrong, is written as an OPEN proposal that nobody designs, and a later sighting of the same rework is joined to
// it (`--join`) instead of proposed twice. Its path, reporter and bounds are `bug file`'s own (a folder inside git, a
// one-line title of at most 200 characters, words of at most 8,000), its priority is medium when none is named, and a
// refusal is one line at exit 2 that writes nothing — a join of a proposal that is not open included.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_propose.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/scripts/bug
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, exec, lines, rows, said } from "../lib/bug_house.mjs";

async function count(house, table) {
  try {
    return (await rows(house, `SELECT count(*) AS n FROM ${table}`))[0].n;
  } catch {
    return 0; // no store yet: nothing was written
  }
}

function oneRefusal(ran) {
  const said1 = lines(ran);
  return ran.code === 2 && said1.length === 1 && said1[0].startsWith("REFUSED bug propose");
}

// a word outside a flag's choices is argparse's own refusal (cmd/bug.py's rule, as bug file's --priority is): exit 2
// with the flag named on stderr
function choiceRefusal(ran, flag) {
  return ran.code === 2 && ran.out.trim() === "" && ran.err.includes(`argument ${flag}: invalid choice`);
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-propose");
  const wrong = [];

  const words = "The ticket store and the card store each keep their own copy of a ticket's state.";
  const made = await bug(house, ["propose", "--title", "One state for a ticket", "--kind", "design"], { input: words });
  if (made.code !== 0 || made.out.trim() !== "PROPOSED proposal 1 — One state for a ticket") {
    return broken(`bug propose did not print PROPOSED proposal 1 — One state for a ticket — ${said(made)}`);
  }
  const [row] = await rows(house, "SELECT * FROM proposals WHERE id = 1");
  if (!row) return broken("bug propose printed PROPOSED but wrote no proposals row");
  if (row.state !== "open") wrong.push(`the new proposal is ${row.state}, not open`);
  if (row.priority !== "medium") wrong.push(`a proposal with no --priority is ${row.priority}, not medium`);
  if (row.kind !== "design") wrong.push(`--kind design was stored as ${row.kind}`);
  if (row.path !== house.repo) wrong.push(`the proposal's path is ${row.path}, not the folder it was proposed from (${house.repo})`);
  if (row.words !== words) wrong.push(`the proposal's words are ${JSON.stringify(row.words)}, not what stdin held`);
  if (!row.reporter || !String(row.reporter).includes(house.env.CLAUDE_CODE_SESSION_ID)) {
    wrong.push(`the reporter does not name the proposing session: ${row.reporter}`);
  }

  const joinWords = "The board's card row says done while the ticket still says open.";
  const joined = await bug(house, ["propose", "--join", "1", "--unit", "hooks/dispatcher/store_tickets.py"], { input: joinWords });
  if (joined.code !== 0 || joined.out.trim() !== "JOINED proposal 1 — One state for a ticket") {
    wrong.push(`bug propose --join 1 did not print JOINED proposal 1 — One state for a ticket — ${said(joined)}`);
  }
  const findings = await rows(house, "SELECT * FROM proposal_findings WHERE proposal_id = 1 AND words = ?", [joinWords]);
  if (findings.length !== 1) wrong.push(`the join wrote ${findings.length} findings holding its words, not 1`);
  else if (findings[0].unit !== "hooks/dispatcher/store_tickets.py") wrong.push(`the joined finding's unit is ${findings[0].unit}`);

  const high = await bug(house, ["propose", "--title", "Split the store", "--kind", "too-big", "--priority", "high"], { input: "words" });
  if (high.code !== 0 || !high.out.trim().startsWith("PROPOSED proposal 2 — ")) wrong.push(`a high too-big proposal was not proposed — ${said(high)}`);
  else if ((await rows(house, "SELECT priority FROM proposals WHERE id = 2"))[0]?.priority !== "high") wrong.push("--priority high was not stored");
  await exec(house, "UPDATE proposals SET state = 'dismissed', reason = 'case', ended_at = '2026-11-19T00:00:00Z' WHERE id = 2");

  {
    const before = [await count(house, "proposals"), await count(house, "proposal_findings")];
    const ran = await bug(house, ["propose", "--title", "Kind", "--kind", "small"], { input: "words" });
    if (!choiceRefusal(ran, "--kind")) wrong.push(`a kind that is neither too-big nor design was not refused at exit 2 naming --kind — ${said(ran)}`);
    const after = [await count(house, "proposals"), await count(house, "proposal_findings")];
    if (after[0] !== before[0] || after[1] !== before[1]) wrong.push(`a bad kind wrote rows (proposals ${before[0]}→${after[0]}, findings ${before[1]}→${after[1]})`);
  }
  const refusals = [
    ["8,001 characters of words", ["propose", "--title", "Long", "--kind", "design"], "w".repeat(8001)],
    ["a blank title", ["propose", "--title", "  ", "--kind", "design"], "words"],
    ["a 201-character title", ["propose", "--title", "t".repeat(201), "--kind", "design"], "words"],
    ["a folder outside any git work tree", ["propose", "--title", "Loose", "--kind", "design", "--path", house.loose], "words"],
    ["a join of a proposal that does not exist", ["propose", "--join", "99"], "words"],
    ["a join of a dismissed proposal", ["propose", "--join", "2"], "words"],
  ];
  for (const [what, args, input] of refusals) {
    const before = [await count(house, "proposals"), await count(house, "proposal_findings")];
    const ran = await bug(house, args, { input });
    if (!oneRefusal(ran)) wrong.push(`${what} was not one REFUSED bug propose line at exit 2 — ${said(ran)}`);
    const after = [await count(house, "proposals"), await count(house, "proposal_findings")];
    if (after[0] !== before[0] || after[1] !== before[1]) wrong.push(`${what} wrote rows (proposals ${before[0]}→${after[0]}, findings ${before[1]}→${after[1]})`);
  }
  const edge = await bug(house, ["propose", "--title", "t".repeat(200), "--kind", "too-big"], { input: "w".repeat(8000) });
  if (edge.code !== 0 || !edge.out.startsWith("PROPOSED proposal ")) wrong.push(`a 200-character title with 8,000 words was refused — ${said(edge)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`bug propose wrote an open medium proposal with its folder, words and session and printed PROPOSED; --join added one finding with its unit and printed JOINED; the two inside edges were proposed; a bad kind was argparse's exit 2 and ${refusals.length} bad proposals and joins were each one REFUSED line at exit 2, none writing a row`);
});
