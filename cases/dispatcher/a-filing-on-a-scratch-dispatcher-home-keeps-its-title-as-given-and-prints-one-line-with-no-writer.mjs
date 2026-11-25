// protects: /home/lyphe/.claude/hooks/dispatcher/plain_words.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py
// writes: none
//
// A scratch dispatcher home starts no plain-words writer (rnd-adopted-measures, phase 7, ruled after Accept): bug file
// sends every filing through plain_words.dress, which on the live home dresses it with a model child; on a scratch home,
// with DISPATCHER_SCRATCH_PLAIN unset, dress returns the filing as given and prints nothing. Two filings with rough
// titles each exit 0 and print one line, each ticket keeps its title as filed, and no ticket's words carry the dressed
// card's "For the fixer — as filed:" mark. Everything is in the case's own scratch home (lib/bug_house.mjs).
import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, lines, rows, said } from "../lib/bug_house.mjs";

const MARK = "For the fixer — as filed:";
const FILINGS = [
  ["zq widget thingy broke lol idk why", "the widget falls over when the thingy is clicked twice"],
  ["sidebar wat — numbers r wrong after reload??", "after a reload the sidebar counts are off by one"],
];

runCase(async (t) => {
  const house = await bugHouse(t, "scratch-plain");
  delete house.env.DISPATCHER_SCRATCH_PLAIN;
  const wrong = [];
  for (const [title, words] of FILINGS) {
    const ran = await bug(house, ["file", "--title", title], { input: words });
    if (ran.code !== 0) { wrong.push("filing " + JSON.stringify(title) + " " + said(ran)); continue; }
    const printed = lines(ran);
    if (printed.length !== 1) wrong.push("filing " + JSON.stringify(title) + " printed " + printed.length + " lines: " + said(ran));
  }
  if (wrong.length) return broken(wrong.join("; "));
  const tickets = await rows(house, "SELECT * FROM tickets");
  const texts = tickets.map((row) => Object.values(row).map((v) => String(v ?? "")));
  for (const [title] of FILINGS) {
    if (!texts.some((values) => values.includes(title))) wrong.push("no ticket's title is " + JSON.stringify(title) + "; titles: " + JSON.stringify(tickets.map((row) => row.title)));
  }
  if (texts.some((values) => values.some((v) => v.includes(MARK)))) wrong.push("a ticket's words carry the dressed card's mark");
  if (tickets.length !== FILINGS.length) wrong.push(tickets.length + " tickets for " + FILINGS.length + " filings");
  if (wrong.length) return broken(wrong.join("; "));
  return held(FILINGS.length + " scratch filings kept their titles as filed, one line each, no writer's mark");
});
