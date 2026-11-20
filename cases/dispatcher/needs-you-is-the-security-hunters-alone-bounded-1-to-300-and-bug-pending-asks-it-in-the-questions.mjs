// `bug file --needs-you SENTENCE` is the security hunter's one question to the operator: its fix changes who can get
// in, or a key something else depends on. It is refused from every other filer — a chat, a soul, a hunter of any
// other hunt — and outside 1..300 characters, each as one REFUSED line at exit 2 that writes no ticket. Filed, the
// sentence is kept in `needs_you`, and `bug pending --json` hands the placing pass the ticket in lane `questions` with
// the question CloudCLI asks on the card: the fixed head, the sentence, "Go ahead?", and the two options.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/bug_hunter.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, lines, rows, said } from "../lib/bug_house.mjs";
import { OPTIONS, QUESTION_HEAD, huntEnv, hunterHouse } from "../lib/hunter_tickets.mjs";

const FILED = /^FILED ticket (\d+) — /m;

async function count(house) {
  return (await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n;
}

runCase(async (t) => {
  const house = await hunterHouse(t, "needs-you-file");
  const wrong = [];
  const ok = `${"Staff will be asked to sign in again on every till; ".repeat(6)}`.slice(0, 299).trimEnd().padEnd(299, "x") + ".";
  const refusals = [
    ["a chat", "Staff will need to log in again.", { CLAUDE_CODE_SESSION_ID: "case-chat" }],
    ["a soul", "Staff will need to log in again.", { PLAN_RUNNER_CHILD: "1", CLAUDE_CODE_AGENT: "hephaestus" }],
    ["the code hunter", "Staff will need to log in again.", huntEnv("code")],
    ["the security hunter, blank", "   ", huntEnv("security")],
    ["the security hunter, 301 characters", `${ok}x`, huntEnv("security")],
  ];
  for (const [who, sentence, env] of refusals) {
    const before = await count(house);
    const ran = await bug(house, ["file", "--title", `Asked by ${who}`, "--needs-you", sentence], { input: "w", env });
    const said1 = lines(ran).filter((l) => !/^(bug|card) config: /.test(l));
    if (ran.code !== 2 || said1.length !== 1 || !said1[0].startsWith("REFUSED bug file: ")) wrong.push(`--needs-you from ${who} was not one REFUSED bug file line at exit 2 — ${said(ran)}`);
    if ((await count(house)) !== before) wrong.push(`the refused --needs-you from ${who} wrote a ticket`);
  }
  if (ok.length !== 300) wrong.push(`(the case's own 300-character sentence is ${ok.length})`);
  const filed = await bug(house, ["file", "--title", "Session keys never rotate", "--needs-you", ok], { input: "The key signing sessions is the one shipped.", env: huntEnv("security") });
  const m = filed.out.match(FILED);
  if (filed.code !== 0 || !m) wrong.push(`the security hunter's 300-character --needs-you was not FILED — ${said(filed)}`);
  else {
    const id = Number(m[1]);
    const [r] = await rows(house, "SELECT needs_you, source, hunt FROM tickets WHERE id = ?", [id]);
    if (r.needs_you !== ok || r.source !== "hunter" || r.hunt !== "security") wrong.push(`ticket ${id} stored ${JSON.stringify({ ...r, needs_you: r.needs_you?.length })}`);
    let p = null;
    try { p = JSON.parse((await bug(house, ["pending", "--json"])).out).place.find((x) => x.id === id); } catch { /* judged below */ }
    const text = `${QUESTION_HEAD} ${ok} Go ahead?`;
    if (!p) wrong.push(`bug pending --json does not list ticket ${id}`);
    else {
      if (p.lane !== "questions") wrong.push(`its lane is ${JSON.stringify(p.lane)}, not "questions"`);
      if (p.question?.text !== text) wrong.push(`its question.text reads ${JSON.stringify(p.question?.text?.slice(0, 120))}…`);
      if (JSON.stringify(p.question?.options) !== JSON.stringify(OPTIONS)) wrong.push(`its options are ${JSON.stringify(p.question?.options)}`);
      for (const tag of ["hunter:security", "needs-you"]) if (!p.tags.includes(tag)) wrong.push(`its tags ${JSON.stringify(p.tags)} lack ${tag}`);
    }
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("--needs-you from a chat, a soul, the code hunter, blank and at 301 characters was refused in one line at exit 2 writing nothing; the security hunter's 300-character sentence was FILED and pending in lane questions with its question, the two options and the tags hunter:security and needs-you");
});
