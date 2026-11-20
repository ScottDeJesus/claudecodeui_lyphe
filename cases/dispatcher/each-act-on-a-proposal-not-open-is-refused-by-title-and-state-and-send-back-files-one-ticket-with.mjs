// The operator ends a proposal one of three ways and changes its priority while it is open. Sending it back files ONE
// ticket through `bug file`'s own door, carrying the proposal's title, priority, words and findings, and prints that
// ticket's FILED line; the proposal then reads sent-back with the ticket's id. An ended proposal is never written
// again: every act on one is refused in exactly `REFUSED bug proposal <act>: "<title>" is already <state>` at exit 2,
// and a dismissal's reason is 1 to 500 characters.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_propose.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, lines, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — (.*) — for (.*)$/;

function exactly(ran, line) {
  const said1 = lines(ran);
  return ran.code === 2 && said1.length === 1 && said1[0] === line;
}

runCase(async (t) => {
  const house = await bugHouse(t, "bug-proposal-acts");
  const wrong = [];
  const p1 = await bug(house, ["propose", "--title", "Send me back", "--kind", "too-big", "--priority", "high"], { input: "The whole parser re-reads the file." });
  const p2 = await bug(house, ["propose", "--title", "Dismiss me", "--kind", "design"], { input: "words" });
  if (p1.code !== 0 || p2.code !== 0) return broken(`bug propose failed — ${said(p1)} / ${said(p2)}`);
  const join = await bug(house, ["propose", "--join", "1", "--unit", "parse.py"], { input: "It re-reads it on every line too." });
  if (join.code !== 0) wrong.push(`the join failed — ${said(join)}`);

  const back = await bug(house, ["proposal", "send-back", "1"]);
  const m = back.out.trim().match(FILED);
  if (back.code !== 0 || !m || lines(back).length !== 1) return broken(`bug proposal send-back 1 did not print one FILED line — ${said(back)}`);
  const id = Number(m[1]);
  if (m[2] !== "Send me back" || m[3] !== house.repo) wrong.push(`the FILED line names ${m[2]} for ${m[3]}`);
  const [ticket] = await rows(house, "SELECT * FROM tickets WHERE id = ?", [id]);
  if (!ticket) return broken(`send-back printed ticket ${id} but there is no such row`);
  if (ticket.priority !== "high") wrong.push(`the sent-back ticket's priority is ${ticket.priority}, not the proposal's high`);
  for (const part of ["The whole parser re-reads the file.", "It re-reads it on every line too."]) {
    if (!String(ticket.words).includes(part)) wrong.push(`the sent-back ticket's words do not hold "${part}"`);
  }
  if ((await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n !== 1) wrong.push("send-back filed more than one ticket");
  const [p] = await rows(house, "SELECT state, ticket_id, ended_at FROM proposals WHERE id = 1");
  if (p.state !== "sent-back" || p.ticket_id !== id || !p.ended_at) wrong.push(`the sent-back proposal reads ${JSON.stringify(p)}`);
  const listed = JSON.parse((await bug(house, ["proposals", "--all", "--json"])).out || "{}").proposals?.find((x) => x.id === 1);
  if (listed?.sent_back?.ticket !== id) wrong.push(`bug proposals reads sent_back ${JSON.stringify(listed?.sent_back)}, not ticket ${id}`);

  for (const reason of ["", "r".repeat(501)]) {
    const ran = await bug(house, ["proposal", "dismiss", "2", "--reason", reason]);
    const said1 = lines(ran);
    if (ran.code !== 2 || said1.length !== 1 || !said1[0].startsWith("REFUSED bug proposal dismiss: ")) wrong.push(`a dismissal reason of ${reason.length} characters was not refused in one line — ${said(ran)}`);
  }
  if ((await rows(house, "SELECT state FROM proposals WHERE id = 2"))[0].state !== "open") wrong.push("a refused dismissal ended the proposal");
  const dismiss = await bug(house, ["proposal", "dismiss", "2", "--reason", "r".repeat(500)]);
  if (dismiss.code !== 0) wrong.push(`a 500-character reason was refused — ${said(dismiss)}`);

  const acts = [
    [["proposal", "send-back", "1"], 'REFUSED bug proposal send-back: "Send me back" is already sent-back'],
    [["proposal", "dismiss", "1", "--reason", "late"], 'REFUSED bug proposal dismiss: "Send me back" is already sent-back'],
    [["proposal", "priority", "1", "low"], 'REFUSED bug proposal priority: "Send me back" is already sent-back'],
    [["proposal", "dismiss", "2", "--reason", "again"], 'REFUSED bug proposal dismiss: "Dismiss me" is already dismissed'],
    [["proposal", "send-back", "2"], 'REFUSED bug proposal send-back: "Dismiss me" is already dismissed'],
  ];
  for (const [args, line] of acts) {
    const ran = await bug(house, args);
    if (!exactly(ran, line)) wrong.push(`${args.join(" ")} did not print exactly ${line} at exit 2 — ${said(ran)}`);
  }
  if ((await rows(house, "SELECT count(*) AS n FROM tickets"))[0].n !== 1) wrong.push("a refused act filed a ticket");
  const [still] = await rows(house, "SELECT priority, reason FROM proposals WHERE id = 1");
  if (still.priority !== "high" || still.reason !== null) wrong.push(`a refused act wrote the ended proposal: ${JSON.stringify(still)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`send-back filed ticket ${id} holding the proposal's title, priority, words and finding and printed its FILED line; the proposal read sent-back with that ticket; a blank and a 501-character reason were refused and 500 was taken; ${acts.length} acts on ended proposals each printed REFUSED bug proposal <act>: "<title>" is already <state> and wrote nothing`);
});
