// A ticket no board took (`unplaced`, or still `filed`) can be cleared by its detector, and its detector can see it
// again. Reopened, it must wait to be placed as it did before, so the placing pass offers it to the next board that names
// its folder. Read `placed` with no board, it is offered to none, ever, and every later filing of its key answers
// ALREADY FILED onto a ticket no card shows.
//
// In a scratch dispatcher home, from a scratch git folder: a ticket filed with a key, made `unplaced` and then `cleared`
// as the placing stamp and `bug cleared` write them (the store's own columns: no board, no card row), is REOPENED when the
// key is filed again; it then is listed by `bug pending --unplaced --json`, and does not read `placed` with no board.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, exec, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — /;
const REOPENED = /^REOPENED ticket (\d+) — .* — the 2nd time$/;

runCase(async (t) => {
  const house = await bugHouse(t, "bug-reopen-unplaced");
  const args = ["file", "--title", "shadow-connector health on node is red", "--key", "check:node/shadow-connector/health",
    "--source", "cerberus"];

  const first = await bug(house, args, { input: "red for 61 minutes\n" });
  const m1 = first.out.trim().match(FILED);
  if (first.code !== 0 || !m1) return broken(`the first filing did not print FILED ticket … — ${said(first)}`);
  const id = Number(m1[1]);

  // What `bug placed` writes for {"unplaced": …}, then what `bug cleared` writes for a ticket with no card row.
  await exec(house, "UPDATE tickets SET state = 'unplaced' WHERE id = ?", [id]);
  await exec(house, "UPDATE tickets SET state = 'cleared', ended_at = '2026-11-19T00:00:00Z', word = 'green again' WHERE id = ?", [id]);

  const again = await bug(house, args, { input: "red again\n" });
  const m2 = again.out.trim().match(REOPENED);
  if (again.code !== 0 || !m2 || Number(m2[1]) !== id) {
    return broken(`the cleared ticket's key filed again did not print REOPENED ticket ${id} … the 2nd time — ${said(again)}`);
  }
  const [row] = await rows(house, "SELECT state, board, card_row FROM tickets WHERE id = ?", [id]);
  const pending = await bug(house, ["pending", "--unplaced", "--json"]);
  let ids;
  try {
    ids = JSON.parse(pending.out).place.map((p) => p.id);
  } catch {
    return broken(`bug pending --unplaced --json did not print its JSON — ${said(pending)}`);
  }
  if (row.state === "placed" && row.board === null) {
    return broken(`the reopened ticket ${id} reads placed with no board and no card row, and pending --unplaced lists ${JSON.stringify(ids)}: no board will ever be offered it`);
  }
  if (!ids.includes(id)) {
    return broken(`the reopened ticket ${id} reads ${row.state} and is not listed by bug pending --unplaced --json (${JSON.stringify(ids)})`);
  }
  return held(`REOPENED ticket ${id} the 2nd time; it reads ${row.state} with no board and bug pending --unplaced lists it`);
});
