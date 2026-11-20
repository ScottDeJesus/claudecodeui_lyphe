// STOP AFTER OFF: turning a board's switch off tells `board-off`, which withdraws its told and queued cards while a
// card already walking finishes on its own (`card_tell.py`, `_board_off`). The brief's showing says that walk "finishes
// or is stopped by moving the card to Backlog", so a person's Backlog move on a board whose switch is now off must still
// reach the dispatcher as `stopped`; it is the only press left that halts the walk. A `stopped` for a card the
// dispatcher never walked answers `untold` and changes nothing, so telling it costs one call and never starts work.
//
// The dispatcher is a stand-in written into this case's scratch folder (DISPATCHER_BIN), which records each call;
// every write lands in a database this case creates there. Nothing reaches the real dispatcher.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.tell.ts
// writes: none

import { chmod, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The stand-in: records argv (and stdin for `told`) as one JSON line; answers `card notes --json` with no notes.
const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
let input = ""; process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", () => {
  fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify({ argv, stdin: input }) + "\\n");
  if (argv[0] === "card" && argv[1] === "notes") console.log("[]");
  else console.log("TOLD card x/y — queued");
});
`;

type Call = { argv: string[]; stdin?: string };

const flag = (argv: string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "stop-after-off");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const bin = path.join(folder, "dispatcher");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  process.env.DISPATCHER_BIN = bin;
  const callsFile = path.join(folder, "calls.jsonl");
  const told = async (): Promise<Call[]> =>
    fs.existsSync(callsFile)
      ? (await readFile(callsFile, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Call)
          .filter((c) => c.argv[0] === "card" && c.argv[1] === "told")
      : [];
  const waitFor = async (pick: (calls: Call[]) => boolean, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (!pick(await told()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    return pick(await told());
  };

  const { initializeDatabase } = await import("../../server/modules/database/index.ts");
  await initializeDatabase();
  const kanban: any = await import("../../server/modules/kanban/index.ts");
  let mod: any;
  try {
    mod = await import("../../server/modules/kanban-dispatch/index.ts");
  } catch (error) {
    return broken(`server/modules/kanban-dispatch/index.ts would not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const quiet = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  t.defer(() => {
    console.log = quiet.log;
    console.error = quiet.error;
  });
  const storeWatch = { attach: () => () => {}, followChains: () => {}, start: () => {}, stop: () => {} };
  const made: any = mod.createKanbanDispatchModule(storeWatch);
  made.start();
  t.defer(() => made.stop());

  const { kanbanBoardsService: boards, kanbanCardsService: cards } = kanban;
  const board = boards.createBoard({ name: "Stop after off case board" });
  boards.updateBoard(board.id, { repos: [REPO], autonomy: true });
  if (!boards.getBoard(board.id)?.autonomy) return cannotRun("the scratch board's autonomy would not turn on");
  const card = cards.createCard(board.id, { title: "a card the dispatcher took", status: "todo" });
  if (!(await waitFor((calls) => calls.some((c) => flag(c.argv, "--event") === "created"), 10000))) {
    return cannotRun(`the card ${card.id} created on the self-running board was never told: the tell is not reaching the stand-in`);
  }

  // The header's switch, off: board-off. The walk the dispatcher started on this card goes on.
  boards.updateBoard(board.id, { autonomy: false });
  if (!(await waitFor((calls) => calls.some((c) => flag(c.argv, "--event") === "board-off"), 5000))) {
    return cannotRun(`turning ${board.id} off told no board-off, so this case cannot reach the stop that follows it`);
  }

  // The brief's own way to halt that walk: the card to Backlog.
  cards.moveCard(card.id, { status: "not_ready" });
  const stoppedFor = (calls: Call[]) =>
    calls.some((c) => flag(c.argv, "--event") === "stopped" && (c.stdin ?? "").includes(`"id":"${card.id}"`));
  const reached = await waitFor(stoppedFor, 5000);
  const events = (await told()).map((c) => flag(c.argv, "--event")).join(", ");
  if (!reached) {
    return broken(
      `moved ${board.id}/${card.id} to Backlog after the board's switch went off: the dispatcher was told [${events}] and no stopped, ` +
        `so a walk board-off left running cannot be stopped from the board`,
    );
  }
  return held(`a Backlog move after the switch went off told stopped for ${board.id}/${card.id} (told: ${events})`);
});
