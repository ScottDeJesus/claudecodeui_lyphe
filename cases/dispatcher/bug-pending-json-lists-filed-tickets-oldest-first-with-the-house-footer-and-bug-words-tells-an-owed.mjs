// What CloudCLI and a chat read back from the ticket line. `bug pending --json` is the board's placing pass's whole
// input: the `filed` tickets oldest first, each with the description the card will carry (the words, then the footer
// line the house stamped: `Filed by a chat · <UTC>` or `Filed by the soul <agent> · <UTC>`), tags and lane, and the
// `unplaced` ones only with --unplaced. The reporter is read from the environment and never asked for. `bug list
// --mine` is one session's tickets, `bug stats --json` counts by source, and `bug words --session` prints a word owed
// back once and stamps it, so the second read prints nothing.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/scripts/bug
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, exec, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — /;
// The footer's moment: any UTC stamp that carries its date (`2026-11-19T20:15:00Z`, `2026-11-19 20:15 UTC`).
const UTC = "[^\\n]*\\d{4}-\\d{2}-\\d{2}[^\\n]*";

/** Every `id` found on an object anywhere in a JSON value: list and show answers are read by the ids they carry. */
function ids(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => ids(v, found));
  else if (value && typeof value === "object") {
    if (Number.isInteger(value.id)) found.add(value.id);
    Object.values(value).forEach((v) => ids(v, found));
  }
  return found;
}

function json(ran) {
  try { return JSON.parse(ran.out); } catch { return undefined; }
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-reads");
  const shot = path.join(house.dir, "shot.png");
  fs.writeFileSync(shot, "not really a png");
  const S1 = "case-session-chat";
  const S2 = "case-session-soul";

  const a = await bug(house, ["file", "--title", "Chat's bug"], { input: "alpha words\nsecond line\n", env: { CLAUDE_CODE_SESSION_ID: S1 } });
  const b = await bug(house, ["file", "--title", "Soul's bug", "--priority", "high", "--shot", shot], {
    input: "beta words\n",
    env: { CLAUDE_CODE_SESSION_ID: S2, PLAN_RUNNER_CHILD: "1", CLAUDE_CODE_AGENT: "hephaestus", PLAN_RUNNER_RUN_ID: "run-case-1" },
  });
  const ia = Number(a.out.trim().match(FILED)?.[1]);
  const ib = Number(b.out.trim().match(FILED)?.[1]);
  if (a.code !== 0 || b.code !== 0 || !ia || !ib) return broken(`the two filings did not each print FILED — ${said(a)} / ${said(b)}`);

  const wrong = [];
  const pending = await bug(house, ["pending", "--json"]);
  const place = json(pending)?.place;
  if (pending.code !== 0 || !Array.isArray(place)) return broken(`bug pending --json is not {"place": […]} — ${said(pending)}`);
  if (place.map((p) => p.id).join(",") !== `${ia},${ib}`) wrong.push(`pending lists ${JSON.stringify(place.map((p) => p.id))}, not [${ia}, ${ib}] oldest first`);
  const keys = ["id", "source", "path", "title", "description", "priority", "shots", "tags", "lane"];
  for (const p of place) {
    const missing = keys.filter((k) => !(k in p));
    if (missing.length) wrong.push(`pending's ticket ${p.id} lacks ${missing.join(", ")}`);
  }
  const pa = place.find((p) => p.id === ia);
  const pb = place.find((p) => p.id === ib);
  if (pa) {
    if (pa.source !== "chat" || pa.priority !== "medium" || pa.path !== house.repo || pa.lane !== "todo" || JSON.stringify(pa.tags) !== "[]") {
      wrong.push(`the chat's ticket reads source ${pa.source}, priority ${pa.priority}, path ${pa.path}, lane ${pa.lane}, tags ${JSON.stringify(pa.tags)}`);
    }
    if (!String(pa.description).startsWith("alpha words") || !new RegExp(`\\nFiled by a chat · ${UTC}$`).test(String(pa.description).trimEnd())) {
      wrong.push(`the chat's description is ${JSON.stringify(pa.description)}, not its words then "Filed by a chat · <UTC>"`);
    }
  }
  if (pb) {
    if (pb.source !== "soul" || pb.priority !== "high" || JSON.stringify(pb.shots) !== JSON.stringify([shot])) {
      wrong.push(`the soul's ticket reads source ${pb.source}, priority ${pb.priority}, shots ${JSON.stringify(pb.shots)}`);
    }
    if (!new RegExp(`\\nFiled by the soul hephaestus · ${UTC}$`).test(String(pb.description).trimEnd())) {
      wrong.push(`the soul's description is ${JSON.stringify(pb.description)}, not its words then "Filed by the soul hephaestus · <UTC>"`);
    }
  }
  const [rep] = await rows(house, "SELECT reporter, session FROM tickets WHERE id = ?", [ib]);
  const reporter = JSON.parse(rep?.reporter ?? "{}");
  if (rep?.session !== S2 || reporter.session !== S2 || reporter.agent !== "hephaestus" || reporter.run !== "run-case-1" || reporter.cwd !== house.repo) {
    wrong.push(`the soul's reporter is ${rep?.reporter} with session column ${rep?.session}, not its session, agent, run and cwd`);
  }

  const mine = await bug(house, ["list", "--mine", "--json"], { env: { CLAUDE_CODE_SESSION_ID: S1 } });
  const mineIds = [...ids(json(mine) ?? [])];
  if (mine.code !== 0 || mineIds.join(",") !== String(ia)) wrong.push(`bug list --mine for the chat's session carries ids ${JSON.stringify(mineIds)}, not [${ia}] — ${said(mine)}`);

  await exec(house, "UPDATE tickets SET state = 'unplaced' WHERE id = ?", [ia]);
  const without = json(await bug(house, ["pending", "--json"]))?.place ?? [];
  const withU = json(await bug(house, ["pending", "--unplaced", "--json"]))?.place ?? [];
  if (without.some((p) => p.id === ia)) wrong.push("an unplaced ticket is listed by bug pending --json without --unplaced");
  if (!withU.some((p) => p.id === ia)) wrong.push("an unplaced ticket is missing from bug pending --unplaced --json");

  const word = 'Fixed: "Soul\'s bug" — it shows the right number now';
  await exec(house, "UPDATE tickets SET state = 'fixed', ended_at = ?, word = ?, word_told_at = NULL WHERE id = ?", [new Date().toISOString().slice(0, 19) + "Z", word, ib]);
  const stats = await bug(house, ["stats", "--json"]);
  const st = json(stats);
  const by = Object.fromEntries((st?.by_source ?? []).map((r) => [r.source, r]));
  if (stats.code !== 0 || st?.days !== 30 || !st?.came_back || !Array.isArray(st?.unplaced)) wrong.push(`bug stats --json is not the seam's shape — ${said(stats)}`);
  else {
    if (by.chat?.filed !== 1 || by.chat?.open !== 1 || by.soul?.filed !== 1 || by.soul?.fixed !== 1) wrong.push(`stats by source read ${JSON.stringify(st.by_source)}, not chat filed 1 open 1 and soul filed 1 fixed 1`);
    if (!st.unplaced.some((u) => u.id === ia)) wrong.push(`stats' unplaced ${JSON.stringify(st.unplaced)} does not hold ticket ${ia}`);
  }

  const told1 = await bug(house, ["words", "--session", S2]);
  const told2 = await bug(house, ["words", "--session", S2]);
  if (told1.code !== 0 || !told1.out.includes(word)) wrong.push(`the first bug words --session did not print the owed word — ${said(told1)}`);
  if (told2.code !== 0 || told2.out.includes(word)) wrong.push(`the second bug words --session printed the word again — ${said(told2)}`);
  const [stamped] = await rows(house, "SELECT word_told_at FROM tickets WHERE id = ?", [ib]);
  if (!stamped?.word_told_at) wrong.push("bug words left word_told_at empty");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`pending listed ${ia} and ${ib} oldest first with their footers; --unplaced alone carried the unplaced one; --mine one session's; stats counted by source; the owed word printed once`);
});
