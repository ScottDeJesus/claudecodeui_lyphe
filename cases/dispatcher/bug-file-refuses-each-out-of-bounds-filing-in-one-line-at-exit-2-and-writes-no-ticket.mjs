// `bug file` is the one door every way in files through (a chat, a soul, the night, Cerberus), and CloudCLI reads its
// answer as one line. Each bound the seam names is a refusal of exactly one `REFUSED bug file: <reason>` line at exit 2
// with nothing written: a title of 1 to 200 characters, words of at most 8,000, a key or a shot path of at most 300, a
// `--walk` only with `--source nightly`, a `--service` the charter names (`system` has no line on purpose), a folder
// that exists inside a git work tree, and no more than `per_session` open tickets in one session. The edges that are
// inside the bounds file.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/bug_config.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/scripts/bug
// writes: none

import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, lines, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — .* — for (.*)$/;

async function count(house) {
  try {
    return (await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n;
  } catch {
    return 0; // no store yet: nothing was written
  }
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-file-bounds", { perSession: 3 });
  const wrong = [];

  const edge = await bug(house, ["file", "--title", "t".repeat(200)], { input: "w".repeat(8000) });
  if (edge.code !== 0 || !FILED.test(edge.out.trim())) wrong.push(`a 200-character title with 8,000 words was not filed — ${said(edge)}`);

  const refusals = [
    ["an empty title", ["file", "--title", ""], "words"],
    ["a 201-character title", ["file", "--title", "t".repeat(201)], "words"],
    ["8,001 characters of words", ["file", "--title", "Too many words"], "w".repeat(8001)],
    ["a 301-character key", ["file", "--title", "Long key", "--key", "k".repeat(301)], "words"],
    ["a 301-character shot path", ["file", "--title", "Long shot", "--shot", `/${"s".repeat(300)}`], "words"],
    ["a --walk with no --source", ["file", "--title", "Walk", "--key", "case:w", "--walk", "chain-x"], "words"],
    ["a --walk from cerberus", ["file", "--title", "Walk", "--key", "case:w", "--walk", "chain-x", "--source", "cerberus"], "words"],
    ["--service system, which has no line", ["file", "--title", "Disk full", "--service", "system"], "words"],
    ["a folder outside any git work tree", ["file", "--title", "Loose", "--path", house.loose], "words"],
    ["a folder that does not exist", ["file", "--title", "Gone", "--path", path.join(house.dir, "nowhere")], "words"],
  ];
  for (const [what, args, input] of refusals) {
    const before = await count(house);
    const ran = await bug(house, args, { input });
    const said1 = lines(ran);
    if (ran.code !== 2 || said1.length !== 1 || !said1[0].startsWith("REFUSED bug file: ")) {
      wrong.push(`${what} was not one REFUSED bug file: line at exit 2 — ${said(ran)}`);
    } else if (what.startsWith("--service") && !said1[0].includes("system")) {
      wrong.push(`the refusal of --service system does not name it: ${said1[0]}`);
    }
    const after = await count(house);
    if (after !== before) wrong.push(`${what} wrote ${after - before} ticket(s)`);
  }

  const svc = await bug(house, ["file", "--title", "From the service", "--service", "scratchsvc"], { input: "words" });
  const ms = svc.out.trim().match(FILED);
  if (svc.code !== 0 || !ms) wrong.push(`--service scratchsvc was not filed — ${said(svc)}`);
  else if (ms[2] !== house.svc) wrong.push(`--service scratchsvc filed for ${ms[2]}, not its charter folder ${house.svc}`);

  // The session now holds two open tickets (the edge and the service's); per_session is 3.
  const third = await bug(house, ["file", "--title", "Third"], { input: "words" });
  if (third.code !== 0) wrong.push(`the session's third open ticket was refused — ${said(third)}`);
  const before = await count(house);
  const fourth = await bug(house, ["file", "--title", "Fourth"], { input: "words" });
  const l4 = lines(fourth);
  if (fourth.code !== 2 || l4.length !== 1 || !l4[0].startsWith("REFUSED bug file: ")) {
    wrong.push(`the session's fourth open ticket, past per_session 3, was not refused in one line — ${said(fourth)}`);
  }
  if ((await count(house)) !== before) wrong.push("the refused fourth ticket was written");
  const other = await bug(house, ["file", "--title", "Another session's"], { input: "words", env: { CLAUDE_CODE_SESSION_ID: "case-other-session" } });
  if (other.code !== 0) wrong.push(`another session's first ticket was refused — ${said(other)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the two inside edges filed; ${refusals.length} filings out of bounds were each one REFUSED line at exit 2 writing nothing; --service filed against its folder; the 4th open ticket of a session was refused and another session's was not`);
});
