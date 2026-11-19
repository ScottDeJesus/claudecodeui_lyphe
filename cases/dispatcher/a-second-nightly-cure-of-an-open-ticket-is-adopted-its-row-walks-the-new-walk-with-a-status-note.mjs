// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/cases/cmd/cure.py
// writes: none
//
// The night's second cure of the same break meets the ticket the first one filed, still open: no new ticket is made, and
// the ticket ADOPTS the new walk. Its `walk` becomes the new walk, its card row walks it (state `walking`, `chain_id` the
// new walk, `ended_at` and `outcome` cleared) and the row is owed one `status active` note keyed on the new walk's id, a
// new note beside the first walk's, so the board shows the card active again.
//
// A scratch dispatcher home; the first cure's filing (`bug file --source nightly --walk W1 --key K`), its placing stamp
// onto a board that runs itself (the row walks W1 as a `cure`); the row then ended as the cure's settle ends a walk
// that did not cure (`handed-back`, outcome `cure ended`); then the second cure's filing with W2 and the same key. The
// dispatcher is run as its wrapper runs it (`python3 -m dispatcher bug …`).

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse, exec, rows, said } from "../lib/bug_house.mjs";
import { dispatch } from "../lib/cure_house.mjs";

const W1 = "chain-cure-case-adopt-20261119-000000-0001";
const W2 = "chain-cure-case-adopt-20261119-000000-0002";
const KEY = "case:/scratch/suite:adopt-one";
const CARD = "c-cure-1";

runCase(async (t) => {
  const h = await bugHouse(t, "cure-adopt");
  const fileArgs = (walk) => ["bug", "file", "--title", "Cure — the scratch case adopt-one holds", "--source", "nightly",
    "--walk", walk, "--key", KEY];
  const first = await dispatch(h, fileArgs(W1), { input: "## Goal\nThe case adopt-one broke at 03:00.\n" });
  const m = first.out.match(/^FILED ticket (\d+) — /m);
  if (first.code !== 0 || !m) return cannotRun(`the first cure's ticket could not be filed — ${said(first)}`);
  const id = Number(m[1]);
  const placed = await dispatch(h, ["bug", "placed", String(id), "--result", "-"], {
    input: JSON.stringify({ board: { id: "b-on", name: "Case board", repos: [h.repo], autonomy: true }, card: { id: CARD } }),
  });
  const [walking] = await rows(h, "SELECT id, state, flow, chain_id FROM cards WHERE card = ?", [CARD]);
  if (placed.code !== 0 || !walking || walking.state !== "walking" || walking.flow !== "cure" || walking.chain_id !== W1) {
    return cannotRun(`the stamp did not leave the row walking W1 as a cure (${JSON.stringify(walking)}) — ${said(placed)}`);
  }
  await exec(h, "UPDATE cards SET state = 'handed-back', outcome = 'cure ended', ended_at = '2026-11-19T05:00:00Z' WHERE id = ?", [walking.id]);
  const before = await rows(h, "SELECT kind, key, payload FROM card_notes WHERE card_id = ? ORDER BY id", [walking.id]);

  const second = await dispatch(h, fileArgs(W2), { input: "## Goal\nThe case adopt-one still breaks.\n" });
  const wrong = [];
  if (second.code !== 0 || !new RegExp(`^ALREADY FILED ticket ${id} — `, "m").test(second.out)) {
    wrong.push(`the second cure's filing did not answer ALREADY FILED ticket ${id} — ${said(second)}`);
  }
  const tickets = await rows(h, "SELECT id, walk, state FROM tickets ORDER BY id");
  if (tickets.length !== 1) wrong.push(`the store holds ${tickets.length} tickets, not the one`);
  if (tickets[0] && tickets[0].walk !== W2) wrong.push(`the ticket's walk is ${tickets[0].walk}, not the new walk`);
  const [row] = await rows(h, "SELECT state, flow, chain_id, ended_at, outcome FROM cards WHERE id = ?", [walking.id]);
  const want = { state: "walking", flow: "cure", chain_id: W2, ended_at: null, outcome: null };
  if (JSON.stringify(row) !== JSON.stringify(want)) wrong.push(`the row reads ${JSON.stringify(row)}, not ${JSON.stringify(want)}`);
  const after = await rows(h, "SELECT kind, key, payload FROM card_notes WHERE card_id = ? ORDER BY id", [walking.id]);
  const added = after.slice(before.length);
  const status = added.filter((n) => n.kind === "status");
  if (status.length !== 1 || JSON.parse(status[0].payload).status !== "active" || !String(status[0].key).includes(W2)) {
    wrong.push(`the adoption added the status notes ${JSON.stringify(status)}, not one {"status":"active"} keyed on ${W2}`);
  }
  const changed = before.filter((n, i) => JSON.stringify(n) !== JSON.stringify(after[i]));
  if (changed.length) wrong.push(`the first walk's notes were rewritten: ${JSON.stringify(changed)}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`the second cure answered ALREADY FILED ticket ${id}; the ticket and its row took ${W2}, the row walking with its ending cleared and one status active note keyed on the new walk`);
});
