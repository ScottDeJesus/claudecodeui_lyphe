// When no open ticket holds a filing's key, the NEWEST ended ticket holding it decides: a `cleared` one (it went away on
// its own) is reopened on its own card, a `fixed` one means the fix did not hold and a new ticket names that card as
// `regression_of`, and a `closed` one (or none) is simply a new ticket.
//
// A scratch dispatcher home, its schema laid by `dispatcher cards`, then four ended tickets written straight into the
// store in the seam's columns (so no ending verb is leaned on): one cleared with a card row (key case:clear), one fixed
// (case:fix), one closed (case:close), and case:both held by an older cleared and a newer fixed one. Each key is then
// filed once and the store read back.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/scripts/bug
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, dispatcher, exec, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — /;
const REOPENED = /^REOPENED ticket (\d+) — (.*) — the 2nd time$/;

// [ticket id, card id (null for none), state, ended_at, key]
const ENDED = [
  [1, "c-cleared", "cleared", "2026-11-10T10:00:00Z", "case:clear"],
  [2, "c-fixed", "fixed", "2026-11-10T10:00:00Z", "case:fix"],
  [3, "c-closed", "closed", "2026-11-10T10:00:00Z", "case:close"],
  [4, "c-old", "cleared", "2026-11-01T10:00:00Z", "case:both"],
  [5, "c-new", "fixed", "2026-11-12T10:00:00Z", "case:both"],
];

runCase(async (t) => {
  const house = await bugHouse(t, "bug-key-ended");
  const laid = await dispatcher(house, ["cards"]);
  if (laid.code !== 0) return cannotRun(`dispatcher cards would not lay the scratch store — ${said(laid)}`);

  try {
    await exec(house, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, told_at, ended_at, outcome)"
      + " VALUES (1, 'b-1', 'c-cleared', 'Case board', 'Went away', 'w', 'medium', 'chat', ?, 'done', 'bug', '2026-11-09T10:00:00Z', '2026-11-10T10:00:00Z', 'cleared')",
      [JSON.stringify([house.repo])]);
    for (const [id, card, state, ended, key] of ENDED) {
      await exec(house, "INSERT INTO tickets (id, source, path, title, words, priority, reporter, session, state, board, card, card_row, times, word, filed_at, placed_at, ended_at)"
        + " VALUES (?, 'chat', ?, ?, 'first line of the old words', 'medium', '{}', 'case-old-session', ?, 'b-1', ?, ?, 1, 'an owed word', '2026-11-09T09:00:00Z', '2026-11-09T09:01:00Z', ?)",
        [id, house.repo, `Ticket ${id}`, state, card, id === 1 ? 1 : null, ended]);
      await exec(house, "INSERT INTO ticket_keys (ticket_id, key) VALUES (?, ?)", [id, key]);
    }
  } catch (error) {
    return broken(`the store has no ticket tables in the seam's columns: ${String(error.message).slice(0, 200)}`);
  }

  const wrong = [];
  const reopen = await bug(house, ["file", "--title", "It is back", "--key", "case:clear"], { input: "it showed again today\nmore detail\n" });
  const mr = reopen.out.trim().match(REOPENED);
  if (reopen.code !== 0 || !mr || Number(mr[1]) !== 1) wrong.push(`the cleared ticket's key did not print REOPENED ticket 1 — … — the 2nd time — ${said(reopen)}`);
  const [t1] = await rows(house, "SELECT state, times, ended_at, word FROM tickets WHERE id = 1");
  if (t1.state !== "placed" || t1.times !== 2 || t1.ended_at !== null || t1.word !== null) {
    wrong.push(`the reopened ticket reads ${JSON.stringify(t1)}, not placed, times 2, no ended_at and no word`);
  }
  const notes = await rows(house, "SELECT kind, payload FROM card_notes WHERE card_id = 1");
  const decision = notes.find((n) => n.kind === "decision" && JSON.parse(n.payload).question === "Back again?");
  if (!decision) wrong.push(`the reopened ticket's card row has no Back again? decision note (notes: ${JSON.stringify(notes)})`);
  else if (!/ is back, for the 2nd time: /.test(JSON.parse(decision.payload).choice)) {
    wrong.push(`the Back again? choice is ${JSON.stringify(JSON.parse(decision.payload).choice)}, not "<title> is back, for the 2nd time: <first line>"`);
  }
  if (!notes.some((n) => n.kind === "status" && JSON.parse(n.payload).status === "todo")) wrong.push("the reopened ticket's card row has no status todo note");

  const expect = [["case:fix", "c-fixed"], ["case:close", null], ["case:both", "c-new"]];
  for (const [key, regressionOf] of expect) {
    const ran = await bug(house, ["file", "--title", `Again ${key}`, "--key", key], { input: "it is happening\n" });
    const m = ran.out.trim().match(FILED);
    if (ran.code !== 0 || !m) { wrong.push(`${key} did not print FILED ticket — ${said(ran)}`); continue; }
    const id = Number(m[1]);
    if (id <= 5) { wrong.push(`${key} filed onto the ended ticket ${id} instead of a new one`); continue; }
    const [row] = await rows(house, "SELECT regression_of, state FROM tickets WHERE id = ?", [id]);
    if (row.regression_of !== regressionOf) wrong.push(`${key}'s new ticket has regression_of ${JSON.stringify(row.regression_of)}, not ${JSON.stringify(regressionOf)}`);
  }
  const ended = await rows(house, "SELECT id, state FROM tickets WHERE id BETWEEN 2 AND 5 ORDER BY id");
  const states = ended.map((r) => r.state).join(",");
  if (states !== "fixed,closed,cleared,fixed") wrong.push(`the ended tickets moved: they read ${states}, not fixed,closed,cleared,fixed`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the cleared key reopened ticket 1 (placed, times 2) with Back again? and status todo on its card; the fixed key filed a regression of c-fixed, the closed key a plain ticket, the shared key followed the newer fixed ticket");
});
