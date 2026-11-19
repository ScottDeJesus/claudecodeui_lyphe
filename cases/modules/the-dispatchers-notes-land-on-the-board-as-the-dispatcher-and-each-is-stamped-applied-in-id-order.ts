// APPLY: once the board-dispatch module starts it reads `dispatcher card notes --json` and applies each note, in id
// order, through the kanban barrel with actor `dispatcher`, then runs `dispatcher card applied <id> [--result]`:
// steps → the card's checklist set to those texts; step → the item found by its text; status → moveCard; tags →
// addTag/removeTag; text → plan or closing remarks; decision → noteDecision; question → addQuestion; tokens →
// addCardTokens; shot → the attachment by path; card → createCard in todo on the same board, answered {"card": <id>};
// board → answered on stdin with {"open": [{id,title,description,tags,status}], "done": [{id,title,tags,closing_remarks,
// description,done_at,archived}]}, every card of the board but this one, open leaving out archived, done every done card
// archived included, newest first, each description cut to 2,000 characters; link → addTag and noteDecision on the card
// the payload names; close → its closing remarks then moveCard to done. A note whose card is gone is stamped
// {"gone":true}. None of these writes is told back to the dispatcher.
//
// The dispatcher is a stand-in in this case's scratch folder (DISPATCHER_BIN) holding the fifteen notes and recording
// each call; every write lands in a database this case creates there.
//
// protects: server/modules/kanban-dispatch/, server/modules/kanban/index.ts, server/modules/kanban/kanban-cards.service.ts, server/modules/kanban/kanban-checklist.service.ts, server/modules/kanban/kanban-questions.service.ts, server/modules/kanban/kanban-attachments.service.ts, server/modules/dispatcher/dispatcher-ask.transport.ts
// writes: none

import { chmod, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("0000000d49484452000000010000000108060000001f15c489", "hex"),
]);
const STEPS = ["Sort", "Confirm the bug and find the root cause", "Write the scenario, failing before the fix"];

// The stand-in: `card notes --json` prints notes.json less the notes already applied; `card applied <id> [--result
// X|-]` records the id and its result (stdin for `-`); every call is one line of calls.jsonl.
const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
const log = (o) => fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify(o) + "\\n");
const appliedFile = path.join(home, "applied.json");
const applied = () => (fs.existsSync(appliedFile) ? JSON.parse(fs.readFileSync(appliedFile, "utf8")) : []);
const finish = (stdin) => {
  log({ argv, stdin, at: Date.now() });
  if (argv[0] === "card" && argv[1] === "notes") {
    const done = new Set(applied());
    console.log(JSON.stringify(JSON.parse(fs.readFileSync(path.join(home, "notes.json"), "utf8")).filter((n) => !done.has(n.id))));
  } else if (argv[0] === "card" && argv[1] === "applied") {
    fs.writeFileSync(appliedFile, JSON.stringify([...applied(), Number(argv[2])]));
    console.log("APPLIED note " + argv[2]);
  } else if (argv[0] === "card" && argv[1] === "told") console.log("TOLD card x/y — queued");
  else if (argv[0] === "card" && argv[1] === "config") console.log(JSON.stringify({ width: 1, threshold: 0.8, path: "/nowhere" }));
};
const r = argv.indexOf("--result");
if ((argv[0] === "card" && argv[1] === "told") || (r >= 0 && argv[r + 1] === "-")) {
  let input = ""; process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", () => finish(input));
} else finish(undefined);
`;

type Call = { argv: string[]; stdin?: string; at: number };

// Every poke the module attaches to the store watch. A stamp (`card applied`) is a store write, which moves the board
// counter and pokes the watch, so a real apply is poked again while it is still applying: the case does the same.
const pokes: Array<() => void> = [];

async function mountDispatch(t: any, bin: string): Promise<string | null> {
  let mod: any;
  try {
    mod = await import("../../server/modules/kanban-dispatch/index.ts");
  } catch (error) {
    return `server/modules/kanban-dispatch/index.ts would not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`;
  }
  const factory =
    mod.createKanbanDispatchModule ??
    Object.values(mod).find((value: any) => typeof value === "function" && /^create/.test(value.name));
  if (typeof factory !== "function") return "the kanban-dispatch barrel exports no create… function to mount the module with";
  const storeWatch = {
    attach: (_lane: unknown, poke: () => void) => {
      pokes.push(poke);
      return () => {};
    },
    followChains: () => {},
    start: () => {},
    stop: () => {},
  };
  // The server hands the factory its store watch (`createKanbanDispatchModule(dispatcherStoreWatch)`); the dispatcher it
  // runs is DISPATCHER_BIN's, set before the import.
  const made: any = await factory(storeWatch);
  if (made && typeof made.start === "function") await made.start();
  t.defer(() => made?.stop?.());
  return null;
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "board-apply");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const bin = path.join(folder, "dispatcher");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  process.env.DISPATCHER_BIN = bin;
  const shot = path.join(folder, "before-desktop-board.png");
  await writeFile(shot, PNG);

  const { initializeDatabase, getConnection } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  const { kanbanBoardsService: boards, kanbanCardsService: cards, kanbanChecklistService: checklist } = kanban;
  const quiet = console.error;
  console.error = () => {};
  t.defer(() => {
    console.error = quiet;
  });

  const board = boards.createBoard({ name: "Case board" });
  boards.updateBoard(board.id, { repos: [REPO], autonomy: true });
  if (!boards.getBoard(board.id)?.autonomy) return cannotRun("the scratch board's autonomy would not turn on");
  const elsewhere = boards.createBoard({ name: "Another board" });
  cards.createCard(elsewhere.id, { title: "a card of another board" });
  const walked = cards.createCard(board.id, { title: "the walked card", status: "todo" });
  cards.addTag(walked.id, "tweak");
  checklist.addChecklistItem(walked.id, { text: "Old step" });
  const twin = cards.createCard(board.id, { title: "the duplicate", description: "x".repeat(2500) });
  const hidden = cards.createCard(board.id, { title: "an archived open card" });
  cards.archiveCard(hidden.id);
  const earlier = cards.createCard(board.id, { title: "done earlier", description: "y".repeat(3000) });
  cards.updateCard(earlier.id, { closingRemarks: "the earlier fix" });
  cards.moveCard(earlier.id, { status: "done" });
  await new Promise((r) => setTimeout(r, 1100));
  const later = cards.createCard(board.id, { title: "done later, archived" });
  cards.moveCard(later.id, { status: "done" });
  cards.archiveCard(later.id);
  const db = getConnection();
  const mark = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM kanban_events").get() as { n: number }).n;

  const on = (id: number, kind: string, key: string, payload: unknown, card = walked.id, row = 1) => ({
    id, board: board.id, card, title: card === walked.id ? "the walked card" : "gone", card_row: row, kind, key, payload, at: "2026-11-19T00:00:00Z",
  });
  const notes = [
    on(1, "steps", "bug", { steps: STEPS }),
    on(2, "step", "Sort:done", { text: "Sort", state: "done", note: "bug — Jev, 0.93 sure" }),
    on(3, "status", "active", { status: "active" }),
    on(4, "tags", "bug", { add: ["bug"], remove: ["tweak"] }),
    on(5, "text", "plan", { plan: "the diagnosis: the hint says its repo path" }),
    on(6, "decision", "1", { question: "How many decisions does the drawer show?", choice: "The newest five, with Show more" }),
    on(7, "question", "1", { text: "Which screen first?", options: ["Board", "Drawer"], free: false }),
    on(8, "tokens", "diagnose", { in: 10, out: 20, cache_read: 30, cache_create: 40 }),
    on(9, "shot", "before-desktop-board.png", { path: shot, name: "before-desktop-board.png" }),
    on(10, "card", "change", { title: "Change half", description: "the change half", tags: ["ui-change", `from:${walked.id}`], priority: "medium" }),
    on(11, "board", board.id, { board: board.id }),
    on(12, "link", twin.id, { card: twin.id, tags: [`duplicate-of:${walked.id}`], decision: { question: "Is this the same bug?", choice: "Yes: the same root cause" } }),
    on(13, "close", twin.id, { card: twin.id, closing_remarks: 'Fixed with "the walked card": the hint names an absolute path' }),
    on(14, "step", "Sort:done", { text: "Sort", state: "done", note: "bug" }, "c-gone-999999", 2),
    on(15, "text", "closing_remarks", { closing_remarks: "what landed" }),
  ];
  await writeFile(path.join(folder, "notes.json"), JSON.stringify(notes));

  const unmounted = await mountDispatch(t, bin);
  if (unmounted) return broken(unmounted);
  const callsFile = path.join(folder, "calls.jsonl");
  const calls = async (): Promise<Call[]> =>
    fs.existsSync(callsFile)
      ? (await readFile(callsFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Call)
      : [];
  const appliedCalls = async () => (await calls()).filter((c) => c.argv[0] === "card" && c.argv[1] === "applied");
  // The start applies on its own: pokes begin only once its first stamp is seen, then come every 100 ms until the
  // last note is stamped, as the stamps' own store writes would bring them.
  const deadline = Date.now() + 40000;
  while ((await appliedCalls()).length < notes.length && Date.now() < deadline) {
    if ((await appliedCalls()).length > 0) for (const poke of pokes) poke();
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const poke of pokes) poke();
  await new Promise((r) => setTimeout(r, 2000));

  const wrong: string[] = [];
  const stamps = await appliedCalls();
  const order = stamps.map((c) => Number(c.argv[2]));
  if (order.join(",") !== notes.map((n) => n.id).join(",")) wrong.push(`notes were stamped applied in the order [${order.join(", ")}], not 1 to 15 once each`);
  const result = (id: number): any => {
    const call = stamps.find((c) => Number(c.argv[2]) === id);
    if (!call) return undefined;
    const at = call.argv.indexOf("--result");
    if (at < 0) return undefined;
    const text = call.argv[at + 1] === "-" ? call.stdin ?? "" : call.argv[at + 1];
    try {
      return JSON.parse(text);
    } catch {
      return `not JSON: ${text.slice(0, 60)}`;
    }
  };
  if ((await calls()).some((c) => c.argv[1] === "told")) wrong.push("a note applied as the dispatcher was told back to it (card told ran)");

  const detail = cards.getCard(walked.id);
  const texts = detail.checklist.map((item: any) => item.text);
  if (texts.join("|") !== STEPS.join("|")) wrong.push(`the walked card's checklist reads [${texts.join(", ")}], not the three steps alone`);
  const sort = detail.checklist.find((item: any) => item.text === "Sort");
  if (sort?.state !== "done" || sort?.note !== "bug — Jev, 0.93 sure") wrong.push(`the Sort step reads ${sort?.state} with note ${JSON.stringify(sort?.note)}`);
  if (detail.status !== "active") wrong.push(`the walked card is in ${detail.status}, not active`);
  if (!detail.tags.includes("bug") || detail.tags.includes("tweak")) wrong.push(`the walked card's tags are [${detail.tags.join(", ")}]`);
  if (detail.plan !== "the diagnosis: the hint says its repo path") wrong.push(`the walked card's plan is ${JSON.stringify(detail.plan)}`);
  if (detail.closingRemarks !== "what landed") wrong.push(`the walked card's closing remarks are ${JSON.stringify(detail.closingRemarks)}`);
  const decided = (cardId: string, question: string, choice: string) =>
    db.prepare("SELECT COUNT(*) AS n FROM kanban_decisions WHERE card_id = ? AND question = ? AND choice LIKE ?").get(cardId, question, `%${choice}%`) as { n: number };
  if (decided(walked.id, "How many decisions does the drawer show?", "newest five").n !== 1) wrong.push("the decision note left no one decision on the walked card");
  if (!detail.questions.some((q: any) => q.text === "Which screen first?")) wrong.push("the question note left no question on the walked card");
  const tokens = [detail.buildTokensIn, detail.buildTokensOut, detail.buildTokensCacheRead, detail.buildTokensCacheCreate].join(",");
  if (tokens !== "10,20,30,40") wrong.push(`the walked card's four token counters read ${tokens}`);
  if (detail.attachments.length !== 1) wrong.push(`the shot note left ${detail.attachments.length} attachments on the walked card`);

  const half = db.prepare("SELECT id, status FROM kanban_cards WHERE board_id = ? AND title = 'Change half'").all(board.id) as Array<{ id: string; status: string }>;
  if (half.length !== 1 || half[0].status !== "todo") wrong.push(`the card note left ${half.length} "Change half" cards (${half.map((h) => h.status).join(", ")})`);
  else {
    const halfTags = cards.getCard(half[0].id).tags;
    if (!halfTags.includes("ui-change") || !halfTags.includes(`from:${walked.id}`)) wrong.push(`the change half's tags are [${halfTags.join(", ")}]`);
    if (JSON.stringify(result(10)) !== JSON.stringify({ card: half[0].id })) wrong.push(`the card note was answered ${JSON.stringify(result(10))}, not {"card":"${half[0].id}"}`);
  }

  const answer = result(11);
  const ids = (list: any) => (Array.isArray(list) ? list.map((c: any) => c?.id) : list);
  const open = answer?.open;
  const done = answer?.done;
  const wantOpen = [twin.id, half[0]?.id].sort();
  if (!Array.isArray(open) || [...ids(open)].sort().join(",") !== wantOpen.join(",")) wrong.push(`the board note's open is [${ids(open)}], not the duplicate and the change half`);
  if (!Array.isArray(done) || ids(done).join(",") !== [later.id, earlier.id].join(",")) wrong.push(`the board note's done is [${ids(done)}], not the archived later card then the earlier one`);
  const keysOf = (o: any) => Object.keys(o ?? {}).sort().join(",");
  if (Array.isArray(open) && open.some((c: any) => keysOf(c) !== "description,id,status,tags,title")) wrong.push(`an open card is answered with the keys ${keysOf(open[0])}`);
  if (Array.isArray(done) && done.some((c: any) => keysOf(c) !== "archived,closing_remarks,description,done_at,id,tags,title")) wrong.push(`a done card is answered with the keys ${keysOf(done[0])}`);
  const twinSaid = Array.isArray(open) ? open.find((c: any) => c.id === twin.id) : null;
  const earlierSaid = Array.isArray(done) ? done.find((c: any) => c.id === earlier.id) : null;
  if (twinSaid && twinSaid.description !== "x".repeat(2000)) wrong.push(`an open card's 2,500-character description is answered at ${String(twinSaid.description).length}`);
  if (earlierSaid && (earlierSaid.description !== "y".repeat(2000) || earlierSaid.closing_remarks !== "the earlier fix")) {
    wrong.push(`a done card is answered with a ${String(earlierSaid.description).length}-character description and remarks ${JSON.stringify(earlierSaid.closing_remarks)}`);
  }
  const laterSaid = Array.isArray(done) ? done.find((c: any) => c.id === later.id) : null;
  if (laterSaid && laterSaid.archived !== true) wrong.push(`the archived done card is answered archived ${JSON.stringify(laterSaid.archived)}`);

  const twinNow = cards.getCard(twin.id);
  if (!twinNow.tags.includes(`duplicate-of:${walked.id}`)) wrong.push(`the linked card's tags are [${twinNow.tags.join(", ")}]`);
  if (decided(twin.id, "Is this the same bug?", "same root cause").n !== 1) wrong.push("the link note left no decision on the linked card");
  if (twinNow.status !== "done" || !String(twinNow.closingRemarks).startsWith('Fixed with "the walked card"')) {
    wrong.push(`the closed card is in ${twinNow.status} with remarks ${JSON.stringify(twinNow.closingRemarks)}`);
  }
  if (JSON.stringify(result(14)) !== JSON.stringify({ gone: true })) wrong.push(`the gone card's note was stamped ${JSON.stringify(result(14))}, not {"gone":true}`);

  const actors = db.prepare("SELECT actor, COUNT(*) AS n FROM kanban_events WHERE id > ? GROUP BY actor").all(mark) as Array<{ actor: string; n: number }>;
  const others = actors.filter((a) => a.actor !== "dispatcher");
  if (others.length > 0 || actors.length === 0) wrong.push(`the notes wrote events as [${actors.map((a) => `${a.actor} ×${a.n}`).join(", ")}], not as dispatcher alone`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  const writes = actors.reduce((sum, a) => sum + a.n, 0);
  return held(`fifteen notes stamped once each in id order, ${writes} writes all as dispatcher; checklist set to the three steps, change half ${half[0].id} in To Do, the board answered open 2 / done 2 newest first cut to 2,000, the duplicate tagged and closed to Done, the gone note {"gone":true}, nothing told back`);
});
