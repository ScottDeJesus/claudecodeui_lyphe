// The `closed` ending: when CloudCLI tells `stopped` for a card and the told record says the card is in Done or
// archived, the person closed it by hand, and the open ticket on that card's row ends `closed`, owing its word back.
// A card stopped anywhere else (Backlog, To Do) keeps its ticket open. The told card's `status` and `archived` are
// OPTIONAL: a record from a CloudCLI that does not send them still reads, and closes nothing.
//
// The row's own state is not the test: a card on a board switched off has a `withdrawn` row, and a person who drags
// it to Done has still closed its ticket.
//
// A scratch dispatcher home whose store is laid by `dispatcher cards`; four placed tickets on four card rows written
// straight into the store (three queued, one withdrawn); one `dispatcher card told --event stopped` each.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_told.py, /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/cmd/card.py, /home/lyphe/.claude/scripts/dispatcher
// writes: none

import { spawn } from "node:child_process";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { DISPATCHER, bugHouse, dispatcher, exec, rows, said } from "../lib/bug_house.mjs";

// [row id, card, row state, what the told card adds, whether its ticket should close]
const CARDS = [
  [1, "c-done", "queued", { status: "done", archived: false }, true],
  [2, "c-archived", "withdrawn", { status: "todo", archived: true }, true],
  [3, "c-todo", "queued", { status: "todo", archived: false }, false],
  [4, "c-old", "queued", {}, false],
];

function told(house, record) {
  return new Promise((resolve) => {
    const child = spawn(DISPATCHER, ["card", "told", "--event", "stopped", "--by", "operator"], { env: house.env, cwd: house.dir, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(record));
  });
}

runCase(async (t) => {
  const house = await bugHouse(t, "told-closed");
  const laid = await dispatcher(house, ["cards"]);
  if (laid.code !== 0) return cannotRun(`dispatcher cards would not lay the scratch store — ${said(laid)}`);
  const repos = JSON.stringify([house.repo]);
  try {
    for (const [id, card, state] of CARDS) {
      await exec(house, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, told_at, outcome)"
        + " VALUES (?, 'b-1', ?, 'Case board', ?, 'w', 'medium', 'chat', ?, ?, 'bug', '2026-11-19T10:00:00Z', ?)",
        [id, card, `Card ${card}`, repos, state, state === "withdrawn" ? "board off" : null]);
      await exec(house, "INSERT INTO tickets (id, source, path, title, words, priority, reporter, session, state, board, card, card_row, times, filed_at, placed_at)"
        + " VALUES (?, 'chat', ?, ?, 'w', 'medium', '{}', 'case-session', 'placed', 'b-1', ?, ?, 1, '2026-11-19T09:59:00Z', '2026-11-19T10:00:00Z')",
        [id, house.repo, `Card ${card}`, card, id]);
    }
  } catch (error) {
    return broken(`the store has no ticket tables in the seam's columns: ${String(error.message).slice(0, 200)}`);
  }

  const wrong = [];
  for (const [id, card, , extra, closes] of CARDS) {
    const record = {
      board: { id: "b-1", name: "Case board", repos: [house.repo] },
      card: { id: card, title: `Card ${card}`, description: "", body: "", tags: [], priority: "medium", attachments: [], ...extra },
    };
    const ran = await told(house, record);
    if (ran.code !== 0 || !new RegExp(`^TOLD card b-1/${card} — `, "m").test(ran.out)) {
      wrong.push(`stopped for ${card} (${JSON.stringify(extra)}) did not print its TOLD line at exit 0 — ${said(ran)}`);
    }
    const [ticket] = await rows(house, "SELECT state, ended_at, word, word_told_at FROM tickets WHERE id = ?", [id]);
    if (closes && (ticket.state !== "closed" || !ticket.ended_at || !ticket.word || ticket.word_told_at !== null)) {
      wrong.push(`${card} (${JSON.stringify(extra)}) left its ticket ${JSON.stringify(ticket)}, not closed with an ended_at and a word owed`);
    }
    if (!closes && (ticket.state !== "placed" || ticket.ended_at !== null)) {
      wrong.push(`${card} (${JSON.stringify(extra)}) moved its ticket to ${ticket.state}: a card stopped outside Done keeps it open`);
    }
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("stopped from Done closed its ticket, stopped archived (on a withdrawn row) closed its ticket, stopped in To Do and an old-shaped record kept theirs open; every telling printed its TOLD line");
});
