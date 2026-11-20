// A proposal is put to the operator to be promoted, sent back or dismissed. `bug propose` takes `bug file`'s bounds
// (a title of at most 200 characters, words of at most 8,000) and `--join` adds findings to it night after night, so
// a proposal the door accepted must stay one the operator can promote and send back: promote writes through the
// roadmap's own bounds (a title of at most 120, a goal of at most 8,000) and send-back through `bug file`'s, and a
// proposal those bounds refuse can only be dismissed, with no act that could shorten it.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_propose.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/store_roadmap.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, dispatcher, rows, said } from "../lib/bug_house.mjs";

runCase(async (t) => {
  const house = await bugHouse(t, "bug-propose-bounds");
  for (const args of [["add", "roadmap", "case-rm", "--title", "Case roadmap"],
    ["add", "milestone", "case-ms", "--roadmap", "case-rm", "--title", "Case milestone"],
    ["add", "arc", "case-epic", "--milestone", "case-ms", "--title", "The case epic"]]) {
    const ran = await dispatcher(house, ["roadmap", ...args, "--by", "cli"]);
    if (ran.code !== 0) return broken(`dispatcher roadmap ${args.slice(0, 3).join(" ")} failed — ${said(ran)}`);
  }
  const longTitle = `${"Split the ticket store from the card store ".repeat(4)}`.slice(0, 150);
  const made = [
    await bug(house, ["propose", "--title", longTitle, "--kind", "design"], { input: "The two stores disagree." }),
    await bug(house, ["propose", "--title", "Long words to promote", "--kind", "too-big"], { input: "w".repeat(8000) }),
    await bug(house, ["propose", "--title", "Long words to send back", "--kind", "too-big"], { input: "w".repeat(8000) }),
  ];
  for (const [i, ran] of made.entries()) {
    if (ran.code !== 0 || !ran.out.startsWith(`PROPOSED proposal ${i + 1} `)) return broken(`proposal ${i + 1} was not proposed — ${said(ran)}`);
  }
  for (const id of ["2", "3"]) {
    const joined = await bug(house, ["propose", "--join", id, "--unit", "store_tickets.py"], { input: "Seen again in the settle." });
    if (joined.code !== 0) return broken(`the join of proposal ${id} failed — ${said(joined)}`);
  }

  const wrong = [];
  for (const [id, what] of [["1", "a 150-character title"], ["2", "8,000 characters of words and a joined finding"]]) {
    const ran = await bug(house, ["proposal", "promote", id, "--arc", "case-epic"]);
    if (ran.code !== 0 || !ran.out.startsWith(`PROMOTED proposal ${id} `)) wrong.push(`promote of the proposal with ${what} was not PROMOTED — ${said(ran)}`);
  }
  const sent = await bug(house, ["proposal", "send-back", "3"]);
  if (sent.code !== 0 || !sent.out.startsWith("FILED ticket ")) wrong.push(`send-back of the proposal with 8,000 characters of words and a joined finding was not FILED — ${said(sent)}`);

  const states = await rows(house, "SELECT id, state FROM proposals ORDER BY id");
  const ideas = (await rows(house, "SELECT count(*) AS n FROM plans WHERE state = 'idea'"))[0].n;
  const tickets = (await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n;
  if (wrong.length > 0) {
    return broken(`${wrong.join("; ")} — proposals now ${states.map((r) => `${r.id} ${r.state}`).join(", ")}; ${ideas} ideas, ${tickets} tickets`);
  }
  if (ideas !== 2 || tickets !== 1) return broken(`the acts answered but wrote ${ideas} ideas and ${tickets} tickets, not 2 and 1`);
  return held("the 150-character title and the 8,000 words with a joined finding were each promoted to one idea, and the long-worded one sent back as one ticket");
});
