// THE TELLER'S SKIP: `tellFor` answers null for a `card.created` whose actor is one of the four ticket sources
// (`TICKET_SOURCES`: chat, soul, nightly, cerberus), because the placing stamp already wrote that card's row in the
// dispatcher's store. Every other write of such a card is told as any card's is. The told record's `card` carries
// `status` (the card's lane at the tell) and `archived`, which `card_told.parse` reads (a ticket is closed when its
// card is told stopped from Done or archived).
//
// The dispatcher is the stand-in of lib/board_placing.mjs; the board lives in a database this case makes. Each stdin
// is also handed to the dispatcher's own parser, `card_told.parse`, which reads text and opens no store.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.tell.ts, server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, /home/lyphe/.claude/hooks/dispatcher/card_told.py
// writes: none

import { execFileSync } from "node:child_process";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { flag, gitFolder, mountBoardDispatch, placingRig, quietJournal } from "../lib/board_placing.mjs";

const SOURCES = ["chat", "soul", "nightly", "cerberus"];
const HOOKS = path.join(process.env.HOME ?? "", ".claude", "hooks");

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await placingRig(t, "teller-skip", {});
  const R = await gitFolder(path.join(rig.folder, "repo"));
  quietJournal(t);
  const { kanban } = await rig.open();
  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban as any;
  const board = boards.createBoard({ name: "Self-running board", repos: [R] });
  boards.updateBoard(board.id, { autonomy: true });
  if (!boards.getBoard(board.id)?.autonomy) return cannotRun("the scratch board's autonomy would not turn on");

  const mounted: any = await mountBoardDispatch(t);
  if (mounted.unmounted) return broken(mounted.unmounted);
  await rig.settle({ quietMs: 1500 });

  // Each write its own turn of the event loop, as each request is. A tell reads the card when it is SENT, so a write
  // that changes what the next tell carries waits until the stand-in has heard the tell before it.
  const turn = () => new Promise((r) => setImmediate(r));
  const heardAll = () => rig.settle({ quietMs: 1200 });
  const placed: Record<string, any> = {};
  for (const actor of SOURCES) {
    placed[actor] = cards.createCard(board.id, { title: `placed for ${actor}`, status: "todo" }, { actor });
    await turn();
  }
  const typed = cards.createCard(board.id, { title: "typed by him" });
  await turn();
  await heardAll();
  cards.moveCard(placed.chat.id, { status: "not_ready" });
  await heardAll();
  cards.moveCard(placed.chat.id, { status: "todo" });
  await heardAll();
  cards.updateCard(placed.soul.id, { title: "placed for soul, retitled" });
  await heardAll();
  cards.archiveCard(placed.chat.id);
  await rig.settle();

  const told = (await rig.calls()).filter((c: any) => c.argv[0] === "card" && c.argv[1] === "told");
  const wrong: string[] = [];
  const read = told.map((c: any) => {
    let body: any = {};
    try {
      body = JSON.parse(c.stdin ?? "");
    } catch {
      wrong.push(`a told stdin is not JSON: ${String(c.stdin).slice(0, 80)}`);
    }
    return { event: flag(c.argv, "--event"), card: body?.card, stdin: c.stdin };
  });
  const got = read.map((r) => `${r.event} ${r.card?.title}`).sort();
  const expected = [
    "created typed by him",
    "stopped placed for chat",
    "queued placed for chat",
    "stopped placed for chat",
    "updated placed for soul, retitled",
  ].sort();
  if (got.join("|") !== expected.join("|")) {
    const createdForTicket = got.filter((g) => /^created placed for /.test(g));
    if (createdForTicket.length > 0) wrong.push(`the dispatcher was told created for a card a ticket placed: [${createdForTicket.join(", ")}]`);
    wrong.push(`told [${got.join(", ")}], not [${expected.join(", ")}]`);
  }

  for (const r of read) {
    if (!r.card) continue;
    if (!("status" in r.card) || !("archived" in r.card)) {
      wrong.push(`the ${r.event} tell's card carries no ${!("status" in r.card) ? "status" : "archived"}`);
      continue;
    }
    if (typeof r.card.archived !== "boolean") wrong.push(`the ${r.event} tell's archived is ${JSON.stringify(r.card.archived)}, not a boolean`);
  }
  const queued = read.find((r) => r.event === "queued");
  if (queued?.card && (queued.card.status !== "todo" || queued.card.archived !== false)) wrong.push(`the queued tell reads status ${queued.card.status}, archived ${queued.card.archived}, not todo and false`);
  const created = read.find((r) => r.event === "created");
  if (created?.card && (created.card.status !== "not_ready" || created.card.archived !== false)) wrong.push(`the created tell reads status ${created.card.status}, archived ${created.card.archived}, not not_ready and false`);
  const archivedTell = read.filter((r) => r.event === "stopped" && r.card?.archived === true);
  if (read.some((r) => r.event === "stopped") && archivedTell.length !== 1) wrong.push(`${archivedTell.length} stopped tells say archived true, not the one the archive earned`);

  for (const r of read) {
    try {
      execFileSync("python3", ["-c", "import sys; from dispatcher import card_told; card_told.parse(sys.stdin.read(), sys.argv[1])", r.event ?? "?"], {
        input: r.stdin ?? "", env: { ...process.env, PYTHONPATH: HOOKS, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
      });
    } catch (error: any) {
      wrong.push(`card_told.parse refuses the ${r.event} tell: ${String(error?.stderr ?? error?.message ?? error).trim().split("\n").pop()}`);
    }
  }
  if (typed?.id === undefined) wrong.push("the operator's card was not made");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`no created tell for the four ticket sources' cards; ${read.length} other tells (created for his card, queued, stopped x2, updated), each card carrying status and archived, all read by card_told.parse`);
});
