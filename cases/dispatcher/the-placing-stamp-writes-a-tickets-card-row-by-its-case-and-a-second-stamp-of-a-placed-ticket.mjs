// The placing stamp (`bug placed ID --result -`) is the one act that turns a filed ticket into a card row: CloudCLI made
// the card, and the stamp writes the ticket `placed` and its row in `cards` together, by the seam's cases. A Cerberus
// ticket on a board that runs itself is a bug by construction (no model asked); a ticket naming the night's walk is
// already walking as a `cure`; a board switched off gets a `withdrawn` row; `{"unplaced": …}` leaves no row and the
// ticket waits for a board, so a later stamp with one places it. A second stamp of a placed ticket changes nothing.
//
// A scratch dispatcher home; four tickets filed through the bug command from a scratch git folder; each stamped with a
// result written as CloudCLI writes it. No chat or soul ticket is stamped onto a board that runs itself: that path asks
// the sorting model, and a case never does.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_place.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/scripts/bug
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, rows, said } from "../lib/bug_house.mjs";

const FILED = /^FILED ticket (\d+) — /m;
const SORT_NOTE = "bug — filed by Cerberus's red watch";
const CURE_STEPS = ["Found by the night's run", "Cure the cause", "Confirm: each case holds"];
const WALK = "chain-case-placing-walk-1";

function board(repo, autonomy, name) {
  return { id: autonomy ? "b-on" : "b-off", name, repos: [repo], autonomy };
}

function stamp(house, id, result) {
  return bug(house, ["placed", String(id), "--result", "-"], { input: JSON.stringify(result) });
}

async function fileOne(house, args, words) {
  const ran = await bug(house, ["file", ...args], { input: words });
  const m = ran.out.match(FILED);
  return m && ran.code === 0 ? Number(m[1]) : { ran };
}

async function rowOf(house, ticketId) {
  const [ticket] = await rows(house, "SELECT * FROM tickets WHERE id = ?", [ticketId]);
  if (!ticket || ticket.card_row === null) return { ticket, card: null, notes: [] };
  const [card] = await rows(house, "SELECT * FROM cards WHERE id = ?", [ticket.card_row]);
  const notes = (await rows(house, "SELECT kind, key, payload FROM card_notes WHERE card_id = ? ORDER BY id", [ticket.card_row]))
    .map((n) => ({ ...n, payload: JSON.parse(n.payload) }));
  return { ticket, card, notes };
}

runCase(async (t) => {
  const house = await bugHouse(t, "placing-stamp");
  const ids = {
    cerberus: await fileOne(house, ["--title", "Disk check is red", "--source", "cerberus", "--key", "check:box/disk"], "red for 61 minutes\n"),
    night: await fileOne(house, ["--title", "A case broke overnight", "--source", "nightly", "--walk", WALK, "--key", "case:/r:c"], "the case c broke at 03:00\nmore words\n"),
    chat: await fileOne(house, ["--title", "A button does nothing"], "pressed it, nothing\n"),
    waits: await fileOne(house, ["--title", "No board names this folder"], "words\n"),
  };
  for (const [what, id] of Object.entries(ids)) {
    if (typeof id !== "number") return cannotRun(`the ${what} ticket could not be filed — ${said(id.ran)}`);
  }

  const wrong = [];
  const on = board(house.repo, true, "Case board");
  const off = board(house.repo, false, "Off board");

  // 1. A Cerberus ticket on a board that runs itself.
  const first = await stamp(house, ids.cerberus, { board: on, card: { id: "c-1" } });
  if (first.code !== 0 || !new RegExp(`^PLACED ticket ${ids.cerberus} — Case board — queued$`, "m").test(first.out)) {
    wrong.push(`the Cerberus stamp did not print PLACED ticket ${ids.cerberus} — Case board — queued — ${said(first)}`);
  }
  const c = await rowOf(house, ids.cerberus);
  if (c.ticket.state !== "placed" || c.ticket.board !== "b-on" || c.ticket.card !== "c-1" || !c.ticket.placed_at) {
    wrong.push(`the Cerberus ticket reads ${JSON.stringify({ state: c.ticket.state, board: c.ticket.board, card: c.ticket.card, placed_at: c.ticket.placed_at })}, not placed on b-on/c-1 with a placed_at`);
  }
  if (!c.card) wrong.push("the Cerberus ticket names no card row");
  else {
    const want = { board: "b-on", card: "c-1", state: "queued", flow: "bug", sorted_by: "detector", actor: "cerberus", title: "Disk check is red", priority: "high" };
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, c.card[k]]));
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`the Cerberus card row reads ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    if (!c.notes.some((n) => n.kind === "step" && n.payload.text === "Sort" && n.payload.state === "done" && n.payload.note === SORT_NOTE)) {
      wrong.push(`the Cerberus row has no Sort step done with the note "${SORT_NOTE}" (notes: ${JSON.stringify(c.notes).slice(0, 300)})`);
    }
  }

  // 2. A night's ticket naming its walk: walking as a cure, whatever the board's switch says.
  const second = await stamp(house, ids.night, { board: on, card: { id: "c-2" } });
  if (second.code !== 0 || !new RegExp(`^PLACED ticket ${ids.night} — Case board — walking$`, "m").test(second.out)) {
    wrong.push(`the night's stamp did not print PLACED ticket ${ids.night} — Case board — walking — ${said(second)}`);
  }
  const n = await rowOf(house, ids.night);
  if (!n.card) wrong.push("the night's ticket names no card row");
  else {
    const want = { state: "walking", flow: "cure", chain_id: WALK, sorted_by: "detector", actor: "nightly" };
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, n.card[k]]));
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`the night's card row reads ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    const steps = n.notes.find((x) => x.kind === "steps");
    if (!steps || JSON.stringify(steps.payload.steps) !== JSON.stringify(CURE_STEPS)) {
      wrong.push(`the night's row's steps note reads ${JSON.stringify(steps?.payload ?? null)}, not the cure's three steps`);
    }
    if (!n.notes.some((x) => x.kind === "step" && x.payload.text === CURE_STEPS[0] && x.payload.state === "done" && x.payload.note === "the case c broke at 03:00")) {
      wrong.push(`the night's row has no "${CURE_STEPS[0]}" step done carrying the words' first line`);
    }
  }

  // 3. A board switched off: the row is written withdrawn, its outcome `board off`.
  const third = await stamp(house, ids.chat, { board: off, card: { id: "c-3" } });
  if (third.code !== 0 || !new RegExp(`^PLACED ticket ${ids.chat} — Off board — withdrawn$`, "m").test(third.out)) {
    wrong.push(`the board-off stamp did not print PLACED ticket ${ids.chat} — Off board — withdrawn — ${said(third)}`);
  }
  const o = await rowOf(house, ids.chat);
  if (!o.card || o.card.state !== "withdrawn" || o.card.outcome !== "board off" || o.card.actor !== "chat") {
    wrong.push(`the board-off row reads ${JSON.stringify(o.card && { state: o.card.state, outcome: o.card.outcome, actor: o.card.actor })}, not withdrawn, board off, by chat`);
  }

  // 4. No board names its folder: unplaced, no row; a later stamp with a board places it.
  const fourth = await stamp(house, ids.waits, { unplaced: `no board names ${house.repo}` });
  const w = await rowOf(house, ids.waits);
  if (fourth.code !== 0 || w.ticket.state !== "unplaced" || w.ticket.card_row !== null) {
    wrong.push(`the unplaced stamp left the ticket ${JSON.stringify({ state: w.ticket.state, card_row: w.ticket.card_row })} — ${said(fourth)}`);
  }
  const later = await stamp(house, ids.waits, { board: off, card: { id: "c-4" } });
  const w2 = await rowOf(house, ids.waits);
  if (later.code !== 0 || w2.ticket.state !== "placed" || !w2.card || w2.card.card !== "c-4") {
    wrong.push(`an unplaced ticket stamped later with a board was not placed (${JSON.stringify({ state: w2.ticket.state, card: w2.card?.card ?? null })}) — ${said(later)}`);
  }

  // 5. The first ticket stamped again, with another card: nothing changes, and the command says something.
  const before = JSON.stringify([await rows(house, "SELECT * FROM tickets ORDER BY id"), await rows(house, "SELECT * FROM cards ORDER BY id"), await rows(house, "SELECT id FROM card_notes ORDER BY id")]);
  const again = await stamp(house, ids.cerberus, { board: on, card: { id: "c-9" } });
  const after = JSON.stringify([await rows(house, "SELECT * FROM tickets ORDER BY id"), await rows(house, "SELECT * FROM cards ORDER BY id"), await rows(house, "SELECT id FROM card_notes ORDER BY id")]);
  if (before !== after) wrong.push("a second stamp of a placed ticket changed the store");
  if (again.code === 1 || /Traceback/.test(again.err) || !`${again.out}${again.err}`.trim()) wrong.push(`a second stamp of a placed ticket did not say so in a line — ${said(again)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("Cerberus's ticket queued as a detector-sorted bug with its Sort note; the night's walking as a cure on its walk; the off board's withdrawn board off; the unplaced one placed by a later stamp; the repeat stamp changed nothing");
});
