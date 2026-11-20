// A hunter's ticket is tied to the sitting that filed it and lands on the board its folder belongs to. Every live
// ticket whose source is `hunter` must carry its hunt and a sitting_id naming a sitting of that same hunt, filed at or
// after that sitting started and no later than it ended (a sitting still out has no end yet). Once a ticket names a
// board and a card, the card is a row of that board in the live board's kanban_cards, and that board holds the
// ticket's path by the longest repo any open board holds it by (kanbanBoardsService.boardForPath's first rule).
// Both databases are opened read-only.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/bug_place.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/hunt_sitting.py, server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, server/modules/kanban/kanban-boards.service.ts
// writes: none

import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { LIVE_BOARD, LIVE_STORE, liveRows } from "../lib/hunting_live.mjs";

const at = (iso) => (iso ? Date.parse(iso) : NaN);

function repoHolds(repo, target) {
  const base = path.resolve(repo);
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep) ? base.length : -1;
}

runCase(async () => {
  const tickets = await liveRows(LIVE_STORE,
    "SELECT t.id, t.title, t.path, t.hunt, t.sitting_id, t.board, t.card, t.filed_at, s.hunt AS s_hunt, s.started_at, s.ended_at, s.state AS s_state, s.id AS s_id " +
    "FROM tickets t LEFT JOIN hunt_sittings s ON s.id = t.sitting_id WHERE t.source = 'hunter' ORDER BY t.id");
  if (tickets.length === 0) return held("the live store holds no hunter ticket yet");
  const boards = await liveRows(LIVE_BOARD, "SELECT id, name, repos, archived FROM kanban_boards");
  const wrong = [];
  let placed = 0;
  for (const t of tickets) {
    const name = `ticket ${t.id} "${t.title}"`;
    if (!t.hunt) wrong.push(`${name} carries no hunt`);
    if (t.s_id === null) { wrong.push(`${name} names sitting ${t.sitting_id}, which the store does not hold`); continue; }
    if (t.s_hunt !== t.hunt) wrong.push(`${name} is of the ${t.hunt} hunt but its sitting ${t.s_id} hunted ${t.s_hunt}`);
    const filed = at(t.filed_at);
    if (!(filed >= at(t.started_at) - 1000)) wrong.push(`${name} was filed at ${t.filed_at}, before its sitting started at ${t.started_at}`);
    if (t.s_state === "ended" && !(filed <= at(t.ended_at) + 1000)) wrong.push(`${name} was filed at ${t.filed_at}, after its sitting ended at ${t.ended_at}`);
    if (!t.board || !t.card) continue;
    placed += 1;
    const cards = await liveRows(LIVE_BOARD, "SELECT id, board_id FROM kanban_cards WHERE id = ?", [t.card]);
    if (cards.length !== 1 || cards[0].board_id !== t.board) wrong.push(`${name} names card ${t.card} on board ${t.board}, but the board holds ${JSON.stringify(cards)}`);
    const target = path.resolve(t.path);
    const reach = (b) => Math.max(-1, ...JSON.parse(b.repos || "[]").map((r) => repoHolds(r, target)));
    const own = boards.find((b) => b.id === t.board);
    const best = Math.max(-1, ...boards.filter((b) => !b.archived).map(reach));
    if (!own || reach(own) < 0 || reach(own) < best) wrong.push(`${name} at ${t.path} was placed on ${own ? own.name : t.board}, which does not hold that folder by the longest repo (${best})`);
  }
  if (wrong.length) return broken(wrong.slice(0, 8).join("; "));
  return held(`${tickets.length} hunter tickets each filed inside its own sitting of its own hunt; ${placed} placed, each card on the board of its folder`);
});
