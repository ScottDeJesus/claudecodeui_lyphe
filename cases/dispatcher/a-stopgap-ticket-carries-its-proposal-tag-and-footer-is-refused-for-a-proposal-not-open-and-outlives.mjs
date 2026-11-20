// A stopgap is the smallest ticket that stops a proposed feature's harm now, filed with `bug file --stopgap-for ID`.
// The proposal must be OPEN; the ticket names it (`proposal_id`), the placing pass reads it with the tag `stopgap` and a
// second footer line under "Filed by", `Stopgap for the proposed feature "<title>"`, and `bug proposals` lists it under
// the proposal's stopgaps. A stopgap ticket lives on as any ticket whatever its proposal's ending: dismissing the
// proposal leaves it open. A stopgap for a proposal that ended is refused by the proposal's title and files nothing.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/bug_propose.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, lines, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — /;

async function proposals(house) {
  const ran = await bug(house, ["proposals", "--all", "--json"]);
  try {
    return JSON.parse(ran.out).proposals;
  } catch {
    return null;
  }
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-stopgap");
  const wrong = [];
  for (const title of ["Rework the ticket line", "Ended by dismissal", "Ended by sending back"]) {
    const ran = await bug(house, ["propose", "--title", title, "--kind", "design"], { input: `why ${title}` });
    if (ran.code !== 0) return broken(`bug propose --title ${title} failed — ${said(ran)}`);
  }

  const stop = await bug(house, ["file", "--title", "Guard the double write", "--stopgap-for", "1"], { input: "The second write loses the first." });
  const m = stop.out.trim().match(FILED);
  if (stop.code !== 0 || !m) return broken(`bug file --stopgap-for 1 was not filed — ${said(stop)}`);
  const id = Number(m[1]);
  const [ticket] = await rows(house, "SELECT * FROM tickets WHERE id = ?", [id]);
  if (ticket.proposal_id !== 1) wrong.push(`the stopgap ticket's proposal_id is ${ticket.proposal_id}, not 1`);

  const pending = await bug(house, ["pending", "--json"]);
  let place = null;
  try { place = JSON.parse(pending.out).place.find((p) => p.id === id); } catch { /* judged below */ }
  if (!place) wrong.push(`bug pending --json does not hold the stopgap ticket — ${said(pending)}`);
  else {
    if (!place.tags.includes("stopgap")) wrong.push(`the stopgap's tags are ${JSON.stringify(place.tags)}, with no stopgap`);
    const tail = place.description.split("\n").slice(-2);
    if (!tail[0].startsWith("Filed by ") || tail[1] !== 'Stopgap for the proposed feature "Rework the ticket line"') {
      wrong.push(`the description does not end with the Filed by line then the stopgap line: ${JSON.stringify(tail)}`);
    }
  }
  const plain = await bug(house, ["file", "--title", "An ordinary ticket"], { input: "words" });
  const pm = plain.out.trim().match(FILED);
  const plainPlace = pm ? JSON.parse((await bug(house, ["pending", "--json"])).out).place.find((p) => p.id === Number(pm[1])) : null;
  if (!plainPlace) wrong.push(`an ordinary ticket was not filed — ${said(plain)}`);
  else if (plainPlace.tags.includes("stopgap") || plainPlace.description.includes("Stopgap for")) wrong.push("an ordinary ticket carries the stopgap tag or line");

  const listed = (await proposals(house))?.find((p) => p.id === 1);
  const sg = listed?.stopgaps?.find((s) => s.ticket === id);
  if (!sg) wrong.push(`bug proposals does not list ticket ${id} under its proposal's stopgaps: ${JSON.stringify(listed?.stopgaps)}`);
  else if (sg.title !== "Guard the double write" || sg.state !== ticket.state) wrong.push(`the stopgap entry reads ${JSON.stringify(sg)}`);

  const dismissed = await bug(house, ["proposal", "dismiss", "1", "--reason", "the stopgap is enough"]);
  if (dismissed.code !== 0) wrong.push(`bug proposal dismiss 1 failed — ${said(dismissed)}`);
  const [kept] = await rows(house, "SELECT state, ended_at, proposal_id FROM tickets WHERE id = ?", [id]);
  if (kept.state !== ticket.state || kept.ended_at !== null || kept.proposal_id !== 1) {
    wrong.push(`dismissing the proposal moved its stopgap ticket: ${ticket.state} → ${kept.state}, ended_at ${kept.ended_at}, proposal_id ${kept.proposal_id}`);
  }
  if (!(await proposals(house))?.find((p) => p.id === 1)?.stopgaps?.some((s) => s.ticket === id)) wrong.push("the dismissed proposal no longer lists its stopgap");

  const d2 = await bug(house, ["proposal", "dismiss", "2", "--reason", "no"]);
  const s3 = await bug(house, ["proposal", "send-back", "3"]);
  if (d2.code !== 0 || s3.code !== 0) wrong.push(`ending proposals 2 and 3 failed — ${said(d2)} / ${said(s3)}`);
  for (const [pid, title] of [[1, "Rework the ticket line"], [2, "Ended by dismissal"], [3, "Ended by sending back"], [99, null]]) {
    const before = (await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n;
    const ran = await bug(house, ["file", "--title", `Stopgap for ${pid}`, "--stopgap-for", String(pid)], { input: "words" });
    const said1 = lines(ran);
    if (ran.code !== 2 || said1.length !== 1 || !said1[0].startsWith("REFUSED bug file: ")) wrong.push(`a stopgap for proposal ${pid} was not one REFUSED bug file line at exit 2 — ${said(ran)}`);
    else if (title && !said1[0].includes(title)) wrong.push(`the refusal of a stopgap for proposal ${pid} does not name "${title}": ${said1[0]}`);
    const after = (await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n;
    if (after !== before) wrong.push(`the refused stopgap for proposal ${pid} wrote ${after - before} ticket(s)`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`ticket ${id}, filed --stopgap-for an open proposal, named it, carried the stopgap tag and the second footer line, and was listed under its stopgaps; dismissing the proposal left it ${kept.state} and listed; a stopgap for a dismissed, a sent-back or an unknown proposal was refused by name and filed nothing`);
});
