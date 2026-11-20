// A bug hunter's filing is the fifth ticket source. `bug file` from a process carrying PLAN_RUNNER_HUNT (the hunt's
// read-only launch) stores `source = "hunter"`, `hunt` its kind and `sitting_id` from DISPATCHER_HUNT_SITTING; no one
// types that source. Its filings are not held to the bugs charter's `per_session` (the hunt's bound is the night's,
// kept by `hunt clock`), while a chat's still are. Its footer names the hunter by the soul the launch table gives
// that hunt — `Filed by the <kind> bug hunter (<Soul>) · <UTC>` — and `bug pending` tags it `hunter:<kind>`.
//
// A scratch dispatcher home whose charter caps per_session at 1, a night and sitting row, three filings as the
// security hunter in its own session, two as a chat in another.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/bug_hunter.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/hooks/launch_table/table.py
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, rows, said } from "../lib/bug_house.mjs";
import { SITTING, huntEnv, hunterHouse, huntSoul } from "../lib/hunter_tickets.mjs";

const FILED = /^FILED ticket (\d+) — /m;
const FOOTER = /^Filed by the security bug hunter \((\w+)\) · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/m;

runCase(async (t) => {
  const house = await hunterHouse(t, "hunter-source", { perSession: 1 });
  const soul = await huntSoul("security");
  if (!soul) return cannotRun("launch_table.hunt_of('security') did not answer a soul");
  const wrong = [];
  const ids = [];
  for (const n of [1, 2, 3]) {
    const ran = await bug(house, ["file", "--title", `Hunted defect ${n}`], { input: `what was found ${n}`, env: huntEnv("security") });
    const m = ran.out.match(FILED);
    if (ran.code !== 0 || !m) wrong.push(`the hunter's filing ${n} under per_session 1 was not FILED — ${said(ran)}`);
    else ids.push(Number(m[1]));
  }
  for (const id of ids) {
    const [r] = await rows(house, "SELECT source, hunt, sitting_id FROM tickets WHERE id = ?", [id]);
    if (r.source !== "hunter" || r.hunt !== "security" || r.sitting_id !== SITTING) wrong.push(`ticket ${id} stored ${JSON.stringify(r)}`);
  }
  if (ids.length) {
    const shown = await bug(house, ["show", String(ids[0])]);
    const f = shown.out.match(FOOTER);
    if (!f) wrong.push(`bug show ${ids[0]} prints no 'Filed by the security bug hunter (<Soul>) · <UTC>' line — ${said(shown)}`);
    else if (f[1] !== soul) wrong.push(`the footer names ${f[1]}, the launch table gives ${soul}`);
    let place = [];
    try { place = JSON.parse((await bug(house, ["pending", "--json"])).out).place; } catch { /* judged below */ }
    for (const id of ids) {
      const p = place.find((x) => x.id === id);
      if (!p) { wrong.push(`bug pending --json does not list ticket ${id}`); continue; }
      if (!p.tags.includes("hunter:security") || p.tags.includes("needs-you")) wrong.push(`ticket ${id}'s tags are ${JSON.stringify(p.tags)}`);
      if (p.lane !== "todo" || p.question !== null) wrong.push(`ticket ${id} is in lane ${p.lane} with question ${JSON.stringify(p.question)}`);
      if (!FOOTER.test(p.description.split("\n").pop())) wrong.push(`ticket ${id}'s description does not end with the hunter's footer: ${JSON.stringify(p.description.slice(-90))}`);
    }
  }
  const chat = { CLAUDE_CODE_SESSION_ID: "case-chat-session" };
  const c1 = await bug(house, ["file", "--title", "A chat's first"], { input: "w", env: chat });
  const c2 = await bug(house, ["file", "--title", "A chat's second"], { input: "w", env: chat });
  if (c1.code !== 0) wrong.push(`a chat's first filing failed — ${said(c1)}`);
  if (c2.code !== 2 || !/^REFUSED bug file: /m.test(c2.out + c2.err)) wrong.push(`a chat's second filing under per_session 1 was not refused — ${said(c2)}`);
  const [chatRow] = await rows(house, "SELECT source, hunt, sitting_id FROM tickets WHERE title = ?", ["A chat's first"]);
  if (chatRow && (chatRow.source !== "chat" || chatRow.hunt !== null || chatRow.sitting_id !== null)) wrong.push(`a chat's ticket stored ${JSON.stringify(chatRow)}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`three security-hunter filings under per_session 1 were FILED as source hunter with hunt security and sitting ${SITTING}, footed 'Filed by the security bug hunter (${soul})', tagged hunter:security in lane todo; a chat's second filing was still refused by the cap`);
});
