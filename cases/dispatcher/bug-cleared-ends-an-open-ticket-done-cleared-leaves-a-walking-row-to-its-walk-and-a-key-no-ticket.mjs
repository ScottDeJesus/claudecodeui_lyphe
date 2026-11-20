// `bug cleared --key K` is the detector saying the thing it filed went away on its own. A key no open ticket holds is
// said and is not a fault (exit 0). An open ticket whose card row is not being walked ends `cleared`, and its row is
// set `done` with outcome `cleared` and the notes that tell the board why. A row still `walking` (or `asking`) only
// takes the question `Still happening?`: the walk is that ticket's ending. A cleared ticket's key filed again reopens it.
//
// A scratch dispatcher home whose store is laid by `dispatcher cards`; two placed tickets and their card rows written
// straight into the store in the seam's columns (so the placing stamp is not leaned on): a Cerberus one on a queued
// row (key check:box/a) and a night's one on a walking row (key case:/r:x).
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_end.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/scripts/bug
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, dispatcher, exec, rows, said } from "../lib/bug_house.mjs";

const notesOf = async (house, cardId) => (await rows(house, "SELECT kind, key, payload FROM card_notes WHERE card_id = ? ORDER BY id", [cardId]))
  .map((n) => ({ kind: n.kind, key: n.key, payload: JSON.parse(n.payload) }));

runCase(async (t) => {
  const house = await bugHouse(t, "bug-cleared");
  const laid = await dispatcher(house, ["cards"]);
  if (laid.code !== 0) return cannotRun(`dispatcher cards would not lay the scratch store — ${said(laid)}`);
  try {
    const repos = JSON.stringify([house.repo]);
    await exec(house, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, sorted_by, told_at, queued_at)"
      + " VALUES (1, 'b-1', 'c-1', 'Case board', 'Disk is red', 'w', 'high', 'cerberus', ?, 'queued', 'bug', 'detector', '2026-11-19T10:00:00Z', '2026-11-19T10:00:00Z')", [repos]);
    await exec(house, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, sorted_by, chain_id, told_at, launched_at)"
      + " VALUES (2, 'b-1', 'c-2', 'Case board', 'A case broke', 'w', 'high', 'nightly', ?, 'walking', 'bug', 'detector', 'chain-case-cleared-walk', '2026-11-19T10:00:00Z', '2026-11-19T10:01:00Z')", [repos]);
    const tickets = [[1, "cerberus", "Disk is red", "c-1", "check:box/a"], [2, "nightly", "A case broke", "c-2", "case:/r:x"]];
    for (const [id, source, title, card, key] of tickets) {
      await exec(house, "INSERT INTO tickets (id, source, path, title, words, priority, reporter, state, board, card, card_row, times, filed_at, placed_at)"
        + " VALUES (?, ?, ?, ?, 'red for an hour', 'high', '{}', 'placed', 'b-1', ?, ?, 1, '2026-11-19T09:59:00Z', '2026-11-19T10:00:00Z')",
        [id, source, house.repo, title, card, id]);
      await exec(house, "INSERT INTO ticket_keys (ticket_id, key) VALUES (?, ?)", [id, key]);
    }
  } catch (error) {
    return broken(`the store has no ticket tables in the seam's columns: ${String(error.message).slice(0, 200)}`);
  }

  const wrong = [];
  const none = await bug(house, ["cleared", "--key", "nothing:here", "--note", "gone"]);
  if (none.code !== 0 || !/no open ticket holds nothing:here/.test(none.out)) wrong.push(`a key no ticket holds did not answer "no open ticket holds nothing:here" at exit 0 — ${said(none)}`);

  const cleared = await bug(house, ["cleared", "--key", "check:box/a", "--note", "green again after 12 minutes"]);
  if (cleared.code !== 0 || !/^CLEARED ticket 1 — Disk is red$/m.test(cleared.out)) wrong.push(`the queued ticket's key did not print CLEARED ticket 1 — Disk is red — ${said(cleared)}`);
  const [t1] = await rows(house, "SELECT state, ended_at FROM tickets WHERE id = 1");
  const [c1] = await rows(house, "SELECT state, outcome FROM cards WHERE id = 1");
  if (t1.state !== "cleared" || !t1.ended_at) wrong.push(`the cleared ticket reads ${JSON.stringify(t1)}, not cleared with an ended_at`);
  if (c1.state !== "done" || c1.outcome !== "cleared") wrong.push(`the cleared ticket's row reads ${JSON.stringify(c1)}, not done with outcome cleared`);
  const n1 = await notesOf(house, 1);
  if (!n1.some((n) => n.kind === "decision" && n.payload.question === "Still happening?" && n.payload.choice === "green again after 12 minutes")) wrong.push("the cleared row has no Still happening? decision carrying the note");
  if (!n1.some((n) => n.kind === "text" && n.payload.closing_remarks === "Cleared on its own: green again after 12 minutes")) wrong.push(`the cleared row has no closing_remarks "Cleared on its own: green again after 12 minutes" (notes: ${JSON.stringify(n1).slice(0, 300)})`);
  if (!n1.some((n) => n.kind === "status" && n.payload.status === "done")) wrong.push("the cleared row has no status done note");

  const twice = await bug(house, ["cleared", "--key", "check:box/a", "--note", "still green"]);
  if (twice.code !== 0 || !/no open ticket holds check:box\/a/.test(twice.out)) wrong.push(`clearing an already cleared key did not answer no open ticket holds it — ${said(twice)}`);

  const walking = await bug(house, ["cleared", "--key", "case:/r:x", "--note", "every case holds"]);
  if (walking.code !== 0) wrong.push(`clearing the walking ticket's key did not exit 0 — ${said(walking)}`);
  const [t2] = await rows(house, "SELECT state, ended_at FROM tickets WHERE id = 2");
  const [c2] = await rows(house, "SELECT state, outcome FROM cards WHERE id = 2");
  if (t2.state !== "placed" || t2.ended_at !== null) wrong.push(`the walking row's ticket reads ${JSON.stringify(t2)}, not still placed: the walk is its ending`);
  if (c2.state !== "walking") wrong.push(`the walking row reads ${JSON.stringify(c2)} after a clearing, not walking`);
  const n2 = await notesOf(house, 2);
  const asks = n2.filter((n) => n.kind === "decision" && n.payload.question === "Still happening?" && n.payload.choice === "every case holds");
  const others = n2.filter((n) => !(n.kind === "decision" && n.payload.question === "Still happening?"));
  if (asks.length !== 1 || others.length !== 0) wrong.push(`the walking row took ${JSON.stringify(n2).slice(0, 300)}, not only one Still happening? decision`);

  const again = await bug(house, ["file", "--title", "Disk is red", "--source", "cerberus", "--key", "check:box/a"], { input: "red again\n" });
  if (again.code !== 0 || !/^REOPENED ticket 1 — Disk is red — the 2nd time$/m.test(again.out)) wrong.push(`the cleared key filed again did not print REOPENED ticket 1 — Disk is red — the 2nd time — ${said(again)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("an unheld key said so at exit 0; the queued ticket cleared, its row done cleared with Still happening?, Cleared on its own and status done; the walking one kept open with one Still happening?; the key filed again reopened it the 2nd time");
});
